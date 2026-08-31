# Folder Terminal

> English summary below; 中文说明在下方。

**Folder Terminal** is an Obsidian plugin that adds a terminal icon to every folder in the file explorer. Hover over a folder and click the icon to open a **real shell (PTY)** at the bottom of Obsidian, with the working directory automatically set to that folder.

> ⚠️ Desktop-only (depends on Node's `child_process`); not available on mobile.

**Highlights**
- Hover-to-reveal terminal icon on folders (auto-hidden while renaming)
- Real PTY via an embedded Python proxy — `vim` / `ssh` / `htop` work normally, no native modules required
- Multi-tab sessions, drag-to-reorder, double-click rename, per-tab settings (shell / color scheme / font size)
- Cross-restart recovery, theme-aware GitHub-style colors, clickable URLs

**Platform notes**: macOS requires `python3` (Xcode Command Line Tools); Linux falls back to `script` when `python3` is missing; Windows uses winpty when available, otherwise `cmd.exe`.

---

Obsidian 插件：鼠标移到文件浏览器中的**文件夹**上时，标题右侧出现「终端」图标；点击后在 Obsidian 当前面板**下方**打开一个真实 Shell（PTY）窗口，工作目录自动切换为该文件夹。

> ⚠️ **仅支持桌面端**（依赖 Node 的 `child_process`），移动端不可用。

## 功能

- 🖱️ 文件夹悬浮图标：鼠标移入文件夹标题显示终端图标（右端悬浮，不占位不误触；重命名时自动隐藏）
- 📂 一键进入目录：点击图标，终端自动 `cd` 到该文件夹的**磁盘绝对路径**（含库根目录，`data-path=""`）
- 🗂️ **多标签会话**：每个文件夹一个标签页，各自独立 Shell；切换标签不丢滚动历史，关闭标签才结束会话
- 🧲 **标签拖拽排序**：直接拖动标签调整顺序
- ✏️ **双击重命名**：自定义标签名（不影响实际文件夹名）
- 🖱️ **右键菜单**：重命名 / 标签设置 / 重启会话 / 关闭标签
- 🎛️ **每标签独立设置**：可单独覆盖 Shell、配色、字号（弹窗配置，随布局持久化）
- 💾 **跨重启恢复**：标签列表随工作区布局持久化，重启 Obsidian 后自动恢复所有会话
- 🖥️ 真实 PTY：macOS / Linux 通过内嵌的 **Python PTY 代理**（`pty.fork`）创建真实伪终端，**vim / ssh / htop 等交互程序可正常工作**，无需任何原生模块
- 📐 自适应尺寸：面板大小变化时通过 `TIOCSWINSZ` 实时调整 PTY 尺寸，**vim 内全屏程序也能即时感知**
- ⚙️ 设置面板：默认 Shell、字号、配色方案（跟随主题/深色/浅色）、面板复用开关
- 🔗 链接可点：URL 自动高亮可点击（xterm web-links）
- 🎨 跟随主题：明暗主题下采用 GitHub 风格配色

## 安装

1. 构建：`npm install && npm run build`
2. 把插件目录（含 `main.js`、`manifest.json`、`styles.css`）复制到 vault 的 `.obsidian/plugins/folder-terminal/`
3. 在 Obsidian「设置 → 第三方插件」中启用 **Folder Terminal**

## 开发

```bash
npm install
npm run dev        # watch 模式（产出 main.js）
npm run build      # 生产构建（tsc 检查 + esbuild 打包）
npm run smoke:pty  # PTY 链路冒烟测试（不依赖 Obsidian，可直接跑）
```

## 命令

| 命令 | 说明 |
| :--- | :--- |
| 在库根目录打开终端 | 打开/聚焦底部终端，工作目录为 vault 根 |
| 在笔记所在文件夹打开终端 | 打开/聚焦底部终端，工作目录为当前笔记所在文件夹 |

## 设置

| 设置项 | 说明 |
| :--- | :--- |
| 默认 Shell | 留空使用 `$SHELL`（macOS 默认 /bin/zsh），可填 /bin/bash、/bin/fish 等 |
| 字号 | 终端字体大小（10–22px） |
| 配色方案 | 跟随 Obsidian 主题 / 强制深色 / 强制浅色 |
| 复用终端面板 | 开启后重复点击图标聚焦同一底部面板的对应标签（默认开） |

> 每个标签页还可以**单独覆盖** Shell / 配色 / 字号：右键标签 → 「标签设置…」。

## 标签操作

| 操作 | 方式 |
| :--- | :--- |
| 切换标签 | 单击 |
| 排序 | 按住拖到目标标签上（插到其前面） |
| 重命名 | 双击标签名，回车保存 / Esc 取消 |
| 重启会话 | 右键 → 「重启会话」 |
| 标签设置 | 右键 → 「标签设置…」（每标签 Shell / 配色 / 字号） |
| 关闭 | 标签上的 ×，或右键 → 「关闭标签」 |

## 实现原理

```
文件浏览器 .nav-folder-title（MutationObserver 持续补注入图标）
        │ 点击
        ▼
workspace.getLeaf('split', 'horizontal')  →  当前面板下方新开面板
        ▼
registerView 自定义视图  →  xterm.js 渲染终端
        ▼
child_process.spawn('python3', ['-u', '-c', <pty-proxy.py>, $SHELL])
        │  fd0/1 = 键盘输入 / 终端输出；fd3 = 尺寸控制通道
        ▼
pty.fork()  →  真实 PTY  →  /bin/zsh（或 $SHELL），工作目录 = vault 根 + 文件夹路径
```

关键点：

- **PTY 代理**：内嵌一段 Python 脚本（`src/pty-proxy.py`，构建时以字符串打包进 main.js），`pty.fork()` 创建真实伪终端后只做字节搬运。这样交互程序（vim/ssh）才能正常工作，且**对 stdio 类型无要求**。
- **为什么不用 `script` 命令？** macOS 上 Node/Electron 的 `child_process` 管道实际是 **socketpair**（libuv 行为），而 BSD 的 `script` 会对 stdin 做 `tcgetattr`，遇 socket 返回 `EOPNOTSUPP` 直接退出（已实测复现）。Python 代理没有这个检查。
- **不打包原生模块**：无需 node-pty / 编译 .node 二进制，esbuild 配置把 `child_process`、`path` 等 Node 内置模块标为 external，运行时由 Obsidian 桌面端提供。

## 已知限制

- **仅桌面端**：`isDesktopOnly: true`，移动端不加载。
- **macOS 依赖 python3**：需要 Xcode Command Line Tools（首次使用会提示安装，`xcode-select --install`）。
- **Linux 无 python3 时回退 `script`**：仍可交互，但尺寸同步降级为 stty（仅 shell 提示符下生效）。
- **Windows 尽力而为**：装了 [winpty](https://github.com/rprichard/winpty) 则有 PTY；否则 `cmd.exe` 无 PTY，交互程序受限。
- **首次打开是 50/50 分屏**：拖动分隔条调整高度后 Obsidian 会记住布局。
- **面板固定高度暂不可行**：Obsidian 未公开 Leaf 尺寸控制 API（CSS 硬改会破坏拖拽布局），等待官方布局 API 或后续用内部分裂配置实现。
- **快捷键冲突**：终端聚焦时，Obsidian 的全局快捷键（如 Cmd+P）仍可能被 Obsidian 拦截；Ctrl+C / 方向键等由 PTY 正常处理。
- **Obsidian 版本变动**：文件浏览器的 DOM 类名（`.nav-files-container` 等）随版本可能调整，若图标消失需按新版 DOM 更新 `folderIcons.ts`。
- **会话结束**：标签关闭 / 插件卸载会 kill 对应会话；Obsidian 直接退出时可能残留少量 python3/shell 子进程。

## 目录结构

```
src/
  main.ts              插件入口：视图注册、设置、图标挂载、命令
  folderIcons.ts       文件浏览器悬浮图标（MutationObserver + DOM 注入）
  terminalView.ts      多标签终端视图（xterm.js，标签/会话/拖拽/重命名管理）
  tabSettingsModal.ts  标签设置弹窗（每标签 Shell / 配色 / 字号覆盖）
  pty.ts               Shell 会话封装（python3 PTY 代理，Linux 回退 script，Windows winpty/cmd）
  pty-proxy.py         PTY 代理脚本（构建时打包进 main.js）
  settings.ts          全局设置面板（shell / 字号 / 配色 / 复用开关）
scripts/
  pty-smoke.js         PTY 链路冒烟测试（含尺寸控制通道验证）
```

## 后续路线（Roadmap）

- [x] 设置项：默认 shell、字号、配色、复用面板开关
- [x] 无 python3 环境回退（Linux 用 `script`，macOS 提示安装 CLT）
- [x] 多标签 / 按文件夹记忆会话（跨重启恢复）
- [x] 图标移出标题到文件夹右端（绝对定位，不产生布局位移）
- [x] Windows winpty 尽力而为（缺失自动回退 cmd.exe）
- [x] 标签拖拽排序 / 双击重命名 / 右键菜单
- [x] 每标签独立设置（shell / 配色 / 字号覆盖）
- [ ] 终端面板固定高度（需 Obsidian 布局 API，暂阻塞）

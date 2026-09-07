# Folder Terminal 1.1.0

新增终端内搜索功能，并补齐对应入口与快捷键。

## ✨ 新功能：终端内搜索

在终端缓冲区里检索历史输出，支持高亮全部匹配 + 当前匹配定位，无需把终端内容贴到外部编辑器再 `Ctrl+F`。

- **唤起方式（任选其一）**
  - 快捷键 `Ctrl/Cmd + F`
  - 右键终端区域 → 「搜索…」
  - 命令面板 → `Folder Terminal: 搜索`
- **交互**
  - 输入框实时增量搜索（输入即高亮，200ms 防抖）
  - `Enter` 跳到下一处，`Shift + Enter` 跳到上一处
  - 浮层上的 `↑` / `↓` 按钮等价切换
  - `Esc` 关闭并清空高亮，焦点自动回到终端
  - 右下角显示匹配计数 `当前/总数`（无匹配显示「无匹配」）
- **选项**
  - 区分大小写
  - 正则（把搜索词当作 JS 正则）
  - 全字匹配（仅匹配被非词字符包围的完整词）
- **主题适配**：搜索浮层按 Obsidian 当前深色 / 浅色主题自动着色（GitHub 风格），匹配高亮色与终端配色协调

## ⚙️ 依赖变更

- 新增 `@xterm/addon-search@^0.15.0`，提供搜索内核（`findNext` / `findPrevious` / 匹配高亮 decorations）
- 搜索浮层 UI 由插件自实现（未依赖 xterm 6.x 的 `Terminal.showSearch`，后者仍处于 beta，生态未稳），保证在 `@xterm/xterm@5.5.x` 上稳定运行

## 📦 安装 / 更新

- 社区市场更新，或从 [Releases](https://github.com/FIRSTKANG/folder-terminal/releases/tag/1.1.0) 下载 `main.js` / `manifest.json` / `styles.css` 三件套覆盖 `.obsidian/plugins/folder-terminal/`。
- BRAT 用户：指定 `1.1.0` tag 安装。

---

## Release assets（三个文件，分别拖拽上传）

- `main.js`
- `manifest.json`（版本 1.1.0）
- `styles.css`

# Folder Terminal 1.0.0

首个稳定版 🎉。本次更新彻底解决了 Windows 下终端「打不开 / 无法输入 / 中文乱码 / 输入残留」等一系列问题，**Windows 与 macOS 现在都能稳定使用**。

## ✨ 亮点

- 🪟 **Windows 终端全面可用**：弃用不稳定的 `winpty`，改为直连 `cmd.exe` 管道，启动即用，不再挂死在死进程上。
- 🔤 **中文输出不再乱码**：GBK / UTF-8 自适应解码，版权行、系统消息、中文回显全部正常显示。
- ⌨️ **输入所见即所得**：本地回显 + 带光标的整行缓冲，`Backspace` / `Delete` / `Ctrl+U` / `Ctrl+A` / `Ctrl+E` 全部正常，删除后再次输入不再残留。
- 🚀 **热更新可靠**：插件重载后自动关闭旧终端面板，确保新代码一定生效（告别「改了没反应」）。

## 🐛 主要修复

- **输入翻倍**：修复 `xterm.onData` 被重复注册导致每个按键触发两次（输入 `ps` 变成 `psps`）。
- **退格删不干净**：修复 `Delete` 键的 CSI/SS3 转义解析 bug，消除删除后再次输入出现残留字符的问题。
- **回车不执行命令**：Windows 管道模式下补全 `\r` → `\r\n`，回车真正提交命令。
- **打字无回显**：新增 `LocalEcho` 本地回显，管道模式下也能即时看到输入。
- **Backspace 报错**：`DEL(\x7F)` 转 `BS(\x08)`，消除 xterm.js 报 `Parsing error: code 127`。
- **GBK 乱码**：按 chunk 嗅探编码，严格 UTF-8 校验失败回退 GBK，无需引入 iconv-lite。

## ⚠️ 已知限制

- Windows 走管道模式（非真实 PTY），回车后命令行会**回显两次**（一次本地回显、一次 shell 回显），属正常现象；追求完整体验需引入 `node-pty` 走 ConPTY（已列入后续规划）。

## 📦 安装 / 更新

- 社区市场更新，或从 [Releases](https://github.com/FIRSTKANG/folder-terminal/releases/tag/1.0.0) 下载 `main.js` / `manifest.json` / `styles.css` 三件套覆盖 `.obsidian/plugins/folder-terminal/`。
- BRAT 用户：指定 `1.0.0` tag 安装。

---

## Release assets（三个文件，分别拖拽上传）

- `main.js`
- `manifest.json`（版本 1.0.0）
- `styles.css`

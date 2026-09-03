# Folder Terminal 0.4.9

## 🐛 Bug Fixes
- **Windows 上未找到 winpty 导致回退 cmd.exe（无 PTY）**
  直接 `spawn("winpty")` 只会在系统 PATH 中查找，而很多用户通过 **Git for Windows / MSYS2 / Scoop / WinGet** 安装的 `winpty.exe` 并不在 PATH 里。
  0.4.9 新增常见安装路径扫描，先定位到可用 winpty 再启动，显著减少无 PTY 回退。

## 🔧 Under the hood
- `src/pty.ts`：新增 `findWinpty()`，扫描 Git for Windows、MSYS2、Scoop、WinGet 等常见位置。
- Windows 分支优先使用扫描到的 winpty 完整路径，未扫描到时仍保持向后兼容（尝试 PATH 中的 `winpty`）。
- 修正 `proc.on("error")` 回调内的缩进。

## 📦 安装 / 更新
- 社区市场更新，或从 [Releases](https://github.com/FIRSTKANG/folder-terminal/releases/tag/0.4.9) 下载三件套手动覆盖。
- BRAT 用户：`folder-terminal` 仓库装 `0.4.9` tag。

---

## Release assets（三个文件，单文件分别拖拽上传）
- `main.js`
- `manifest.json`（版本 0.4.9）
- `styles.css`

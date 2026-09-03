# Folder Terminal 0.4.9

## 🐛 Bug Fixes
- **Windows 上未找到 winpty 导致回退 cmd.exe（无 PTY）**
  直接 `spawn("winpty")` 只会在系统 PATH 中查找，而很多用户通过 **Git for Windows / MSYS2 / Scoop / WinGet** 安装的 `winpty.exe` 并不在 PATH 里。
  0.4.9 新增常见安装路径扫描，先定位到可用 winpty 再启动，显著减少无 PTY 回退。

## 🔧 Under the hood
- `src/pty.ts`：新增 `findWinpty()`，扫描 Git for Windows、MSYS2、Scoop、WinGet 等常见位置。
- **补充**：若上述固定路径均未命中，`findWinpty()` 会遍历系统 PATH，从其中的 `git.exe` 反推 Git 安装根目录（兼容 `cmd` / `bin` / `mingw64\bin` 子目录），再定位 `<Git根>\usr\bin\winpty.exe`。
  这覆盖了 **Git 装在非标准路径（如 `D:\SoftwareDev\Tools\Git`）且只把 `cmd` 加进 PATH** 的实际情况——本机正是如此，原逻辑与固定路径扫描都找不到，现已可正确命中 `D:\SoftwareDev\Tools\Git\usr\bin\winpty.exe`。
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

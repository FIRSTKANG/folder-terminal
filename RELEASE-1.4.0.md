# Folder Terminal 1.4.0

文件夹行图标扩展升级：在原有「在此打开终端」图标旁新增一组辅助动作图标，并对系统管理器中展示 / 绝对路径计算做了共享抽取。

## ✨ 新增

- **文件夹行辅助动作图标**：悬停文件夹时，在「终端」图标左侧横向浮现一组动作（与文件图标同尺寸、同配色、同 hover 样式）
  - 在 Finder / 资源管理器中展示（`folder-open`，定位并选中该文件夹）
  - 复制 Wiki 文件路径（`route`，相对库根的路径，如 `wiki/ideas`）
  - 复制 Wiki 绝对路径（`link`，磁盘绝对路径）
- 库根文件夹特判：绝对路径复制库根本身（无尾部斜杠），展示功能定位库根目录

## 🔧 重构

- 抽取共享模块 `src/shellUtils.ts`：
  - `toAbsPath(app, relPath)`：文件/文件夹绝对路径计算，统一非桌面端适配器的退化逻辑
  - `revealInFileManager(absPath, linuxOpenDir)`：平台命令执行（macOS `open -R` / Windows `explorer /select` / Linux `xdg-open`）
- `folderIcons` 与 `fileCopyIcons` 同步改为调用共享函数，删除各自重复的本地实现（共约 90 行）

## 验证

- 悬停文件夹：终端图标左侧出现展示 / 文件路径 / 绝对路径三个图标，颜色与 hover 样式与文件图标一致
- 在 Finder 展示：macOS 弹出 Finder 并选中该文件夹
- 复制路径 / 绝对路径：剪贴板内容正确并弹出「已复制」
- 文件行复制与展示功能不受重构影响，回归正常
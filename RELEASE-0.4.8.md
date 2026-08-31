# Folder Terminal 0.4.8

## 🐛 Bug Fixes
- **设置面板现在正确显示全部 6 个设置项**。
  在 Obsidian 1.13+ 上，声明式 `getSettingDefinitions()` 存在渲染管线边界问题（框架正确返回 6 项却只渲染第 1 项，经 dev console 诊断确认）。
  0.4.8 回退到 imperative `display()` 渲染路径，6 项（界面语言 / 默认 Shell / 字号 / 配色方案 / 复用终端面板 / 默认启动命令）全部稳定显示，且切换语言时标签、副标题、控件当前值**同步刷新**。
- **切换界面语言后设置面板不再"卡旧语言"**（延续 0.4.7 的 i18n 修复）。

## ✨ Improvements
- README 中英双语化，内嵌三张截图（悬停 / 多标签 / 设置页）。
- `minAppVersion` 提升到 **1.13.0**（支持声明式设置 API 与最新终端 API）。

## 🔧 Under the hood（社区审核合规，用户无感知）
- 移除所有 `innerHTML` 与内联 `.style.*` 赋值 → 改用 `setIcon()` / `setText()` / CSS 类。
- 移除运行时动态注入 `<style>`，xterm.css 合并进 `styles.css`。
- `setTimeout` / `requestAnimationFrame` 加 `window.` 前缀（popout 窗口兼容）。
- 移除 `builtin-modules` 依赖（改用 esbuild `platform:"node"` 自动 external）。
- manifest 描述移除 "Obsidian" 一词。
- 类型安全清理（any / unsafe-assignment / unsafe-member-access 等）。
- CSS `text-decoration` 组合值改写为 `text-decoration-line` + `text-decoration-style` 简写，规避 linter 误报。

## 📦 安装 / 更新
- 社区市场更新，或从 [Releases](https://github.com/FIRSTKANG/folder-terminal/releases/tag/0.4.8) 下载三件套手动覆盖。
- BRAT 用户：`folder-terminal` 仓库装 `0.4.8` tag。

---

## Release assets（三个文件，单文件分别拖拽上传）
- `main.js` (339873 B)
- `manifest.json` (368 B，版本 0.4.8)
- `styles.css` (16029 B)

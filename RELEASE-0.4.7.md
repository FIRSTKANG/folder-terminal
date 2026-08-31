# Folder Terminal 0.4.7

> Hover over a folder in the file explorer to reveal a terminal icon; click it to open a real shell (PTY) docked at the bottom, rooted at that folder.

## 🐛 Bug Fixes / 修复

- **Language switch now updates the settings UI correctly (关键修复)**
  Switching the interface language in *Settings → Folder Terminal* now immediately refreshes all setting labels, descriptions **and** the current value shown on each control. (Previously the labels could get stuck on the language active at first open.)
  切换「界面语言」后，设置面板的标签、副标题以及每个控件的当前值会**同步刷新**，无需重开设置页。

## ✨ Improvements / 改进

- **Bilingual README + embedded screenshots**
  README is now available in Chinese and English, with hover / multi-tab / settings screenshots embedded directly (no more stale placeholder text).
  README 中英双语化，并内嵌悬停、多标签页、设置页三张截图。

## 🔧 Under the hood / 技术清理（社区审核合规）

The following changes were made to pass the Obsidian community-plugin automated review:

- Raised `minAppVersion` to **1.13.0** (uses `getLanguage`, `revealLeaf`, and the declarative settings API).
  最低版本要求提升至 1.13.0。
- Removed all direct `innerHTML` and inline `element.style.*` assignments → replaced with `setIcon()` / `setText()` / CSS classes (security / sandbox compliance).
  移除所有直接 `innerHTML` 与内联 `.style.*` 赋值，改用 `setIcon()` / `setText()` / CSS 类。
- Removed dynamically created `<style>` element → xterm.js CSS is now bundled into `styles.css`.
  移除运行时动态注入的 `<style>`，xterm.js 样式合并进 `styles.css`。
- Replaced bare `setTimeout` / `requestAnimationFrame` with `window.setTimeout` / `window.requestAnimationFrame` (popout-window compatibility).
  全局定时器改用 `window.` 前缀，兼容弹出窗口场景。
- Dropped the `builtin-modules` dependency (build now uses `platform: "node"` so Node built-ins stay external).
  移除 `builtin-modules` 依赖（构建改用 `platform: "node"` 自动 external 化 Node 内置模块）。
- Removed the word "Obsidian" from the manifest description (reviewer policy).
  从 manifest 描述中移除 "Obsidian" 一词（审核规范）。
- Type-safety cleanups: narrowed `any` / `unknown` usages flagged by the lint bot.
  收敛类型断言，清理 `any` / `unsafe` 告警。

## 📦 Installation / 安装

- **Community market**: search "Folder Terminal" and update.
  社区市场搜索 Folder Terminal 并更新。
- **BRAT**: add `FIRSTKANG/folder-terminal` and install the `0.4.7` release.
- Manual: download `main.js` / `manifest.json` / `styles.css` from this release and drop them into your vault's `.obsidian/plugins/folder-terminal/` folder.

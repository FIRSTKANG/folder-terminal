# Folder Terminal 1.1.1

Hotfix：修复 1.1.0 中终端内搜索导致的 `allowProposedApi` 运行时异常。

## 🐛 修复

- **搜索高亮报错**：xterm.js 的 `SearchAddon` 使用装饰（Decoration）API，需要在创建 `Terminal` 时启用 `allowProposedApi: true`。1.1.1 已补上该开关，搜索浮层现在可正常高亮匹配结果。

## 🚀 1.1.0 新增能力回顾

- 终端内搜索：输入框实时搜索、`Enter` 下一处 / `Shift+Enter` 上一处、匹配计数、大小写 / 正则 / 全字匹配
- 入口：`Ctrl/Cmd+F`、右键终端区域「搜索…」、命令面板 `Folder Terminal: 搜索`
- 主题适配：浮层自动跟随 Obsidian 深浅主题

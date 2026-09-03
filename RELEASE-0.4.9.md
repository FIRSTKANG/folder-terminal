# Folder Terminal 0.4.9

## 🐛 Bug Fixes

### 1. Windows 上终端"无法输入"（三个叠加原因）

#### 1a. winpty 挂在死进程上

原先 Windows 分支优先用 `winpty` 启动 shell。但 winpty 要求 **stdin 是真正的 tty**，
而 Node/Electron 的 `child_process` 只能提供管道，实测 winpty 会打印：

```
stdin is not a tty
```

随后直接 `exit 1`。这属于「启动成功但立刻失败」，**不会触发 `ENOENT` 回退逻辑**，
于是终端挂在一个死进程上（且不会提示任何回退信息）。

**修复**：Windows 改为直连 shell（默认 `cmd.exe`，支持自定义 shell），输入输出经管道转发。

#### 1b. 回车键不触发命令执行

xterm 在真实终端里按回车只发送 `\r`（CR），由 PTY 的 line discipline 做 ICRNL 转换变成 `\n`。
但 **Windows 管道模式下没有这一层**，cmd.exe 以 `\n` 作为行结束符，
于是收到单独的 `\r` 只是回显字符、并**不执行命令**。

实测（只发 `\r`）：命令被缓冲住，直到下一条 `\r\n` 到来才一起执行。

**修复**：Windows 管道模式下，写入 stdin 前把单独的 `\r` 补全为 `\r\n`
（`data.replace(/\r(?!\n)/g, "\r\n")`；已经是 `\r\n` 的保持不变）。
Unix 走真实 PTY，不做此转换。

#### 1c. 打字时屏幕不显示字符（本地无 PTY 回显）

这是用户觉得"无法输入"的直接原因。`xterm.onData -> session.write -> cmd.exe stdin`
整条链路其实是通的，按回车也能执行命令；但 Windows 管道模式**没有 PTY line discipline**，
cmd.exe 不会把用户按下的每个字符即时回显到屏幕上，所以打字时一片黑。

**修复**：新增 `LocalEcho` 辅助类。Windows 管道模式下，前端把可打印字符（含中文）
即时写回 xterm，Backspace/DEL 会擦除前一个字符，控制序列/方向键/Tab/回车则透传给 shell。

#### 1d. Backspace 删了显示但没删实际输入

在 1c 的基础上，Backspace 虽然擦除了屏幕上的字符，但原来的实现仍把 DEL (`\x7F`) 发给 cmd.exe；
cmd.exe 在管道模式下**不识别单个退格字节**做行内删除，于是出现：

```
屏幕显示：psi
实际执行：psir
```

**修复**：`LocalEcho` 改为维护**一整行输入缓冲区**：
- 可打印字符先进入缓冲区并本地显示，**不立即发给 shell**；
- Backspace 只修改前端缓冲区和屏幕显示；
- Enter 时把当前缓冲区的整行一次性发给 cmd.exe，然后清空缓冲区。

这样 Backspace 永远不会以单个字节形式到达 cmd.exe，删除结果完全一致。

**副作用**：回车之后 cmd.exe 会自己再打印一次 `提示符>命令`，
因此命令行会出现两次（一次本地回显、一次 shell 回显）。这是 pipe 模式没有真实 PTY 的必然结果；
若追求完美体验，需要引入 `node-pty` 走 ConPTY。

### 2. Windows 上中文输出乱码

cmd.exe 的输出是**混合编码**：

- 自身本地化消息（版权行、`活动代码页: 936`）走系统代码页 **GBK**；
- 用户输入的中文经 stdin 原样回显，是 **UTF-8** 字节。

原先统一按 UTF-8 解码，导致 cmd 自身的中文全部乱码（如 `活动` → `[�汾`）。

**修复**：新增 `createWindowsDecoder()`，按 chunk 嗅探编码——
先试严格 UTF-8（能识别被切断的多字节序列，留到下一个 chunk 补齐），
确认不是 UTF-8 再回退 **GBK**。stdout / stderr 各自维护解码状态，避免两条流交错时共用残缺缓冲。

Node 自带 full-icu，`TextDecoder` 原生支持 `gbk`，因此**无需引入 iconv-lite**。

实测结果（直连 `cmd.exe` + 新解码器）：

```
Microsoft Windows [版本 10.0.26200.9168]
(c) Microsoft Corporation。保留所有权利。
C:\...\wiki\work>chcp
活动代码页: 936
C:\...\wiki\work>echo 中文测试
中文测试
```

版权行、GBK 消息、UTF-8 回显均正常，无 U+FFFD。

## 🔧 Under the hood

- `src/pty.ts`：移除 `findWinpty()` / `WINPTY_CANDIDATES` / `spawnCmd()` 回退链
  （winpty 在管道 stdin 下必然失败，保留反而误导）。
- `src/pty.ts`：新增 `createWindowsDecoder()`，Windows 下替代原来的 `chunk.toString("utf8")`。
- `src/pty.ts`：`ShellSession.write()` 在 Windows 下把单独的 `\r` 补全为 `\r\n`，让回车真正提交命令。
- `src/pty.ts`：Windows 下把 xterm 发送的 Backspace `\x7F` (DEL) 转成 `\x08` (BS) 再写入 stdin，避免 cmd.exe 把 DEL 原样 echo 回 stdout 导致 xterm.js 报 `Parsing error: code: 127`。
- `src/pty.ts`：Windows 下对解码后的 stdout/stderr 过滤 `\x7F` 字节，作为防御性兜底。
- `src/pty.ts`：`ShellSession` 新增 `needsLocalEcho` 标志，Windows 分支设为 `true`。
- `src/terminalView.ts`：新增 `LocalEcho` 类，为无 PTY 会话即时回显用户输入到 xterm；后续改为整行缓冲，Backspace 只改前端缓冲区，Enter 才把整行发给 shell。
- `src/terminalView.ts`：`terminal.onData` 根据 `LocalEcho.feed()` 返回值决定是否转发给 `session.write`（`null` = 已本地消费）。
- `src/i18n.ts`：移除已失效的 `pty.fallbackWinpty` 文案（中/英）。

## 📦 安装 / 更新

- 社区市场更新，或从 [Releases](https://github.com/FIRSTKANG/folder-terminal/releases/tag/0.4.9) 下载三件套手动覆盖。
- BRAT 用户：`folder-terminal` 仓库装 `0.4.9` tag。

---

## Release assets（三个文件，单文件分别拖拽上传）

- `main.js`
- `manifest.json`（版本 0.4.9）
- `styles.css`

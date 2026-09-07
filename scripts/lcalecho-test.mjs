// 仿真测试：忠实复刻 src/terminalView.ts 的 LocalEcho.feed()
// 与 src/pty.ts 的 ShellSession.write() 逻辑，验证 Windows 管道模式下
// 行编辑（退格/Delete/Ctrl+U）、命令历史（↑/↓）与行内光标（←/→/Home/End）
// 只会向 cmd.exe 发送正确的行。
//
// 注意：本文件必须与 terminalView.ts 的 LocalEcho 保持同步。
// 若实现有改动，请同步更新此处的 LocalEcho。

const isWindows = true;

// ---- 复刻 LocalEcho ----
class LocalEcho {
	static MAX_HISTORY = 500;
	constructor(writer) {
		this.writer = writer;
		this.buffer = "";
		this.cursor = 0;
		this.escapeBuffer = "";
		this.history = [];
		this.historyIndex = 0;
		this.draft = "";
	}
	feed(data) {
		let toShell = "";
		for (const ch of data) {
			const code = ch.codePointAt(0) ?? 0;
			if (this.escapeBuffer.length > 0) {
				if (this.escapeBuffer.length > 16) {
					this.escapeBuffer = "";
				}
				if (this.escapeBuffer === "\x1b" && (ch === "[" || ch === "O")) {
					this.escapeBuffer += ch;
					continue;
				}
				this.escapeBuffer += ch;
				if (code >= 0x40 && code <= 0x7e) {
					const seq = this.escapeBuffer;
					this.escapeBuffer = "";
					if (seq === "\x1b[3~") {
						if (this.cursor < this.buffer.length) {
							this.buffer =
								this.buffer.slice(0, this.cursor) +
								this.buffer.slice(this.cursor + 1);
							this.redrawFromCursor();
						}
						continue;
					}
					if (seq === "\x1b[A" || seq === "\x1bOA") {
						this.historyPrev();
						continue;
					}
					if (seq === "\x1b[B" || seq === "\x1bOB") {
						this.historyNext();
						continue;
					}
					if (seq === "\x1b[D" || seq === "\x1bOD") {
						this.moveCursor(-1);
						continue;
					}
					if (seq === "\x1b[C" || seq === "\x1bOC") {
						this.moveCursor(1);
						continue;
					}
					if (seq === "\x1b[H" || seq === "\x1bOH" || seq === "\x1b[1~") {
						this.moveCursorTo(0);
						continue;
					}
					if (seq === "\x1b[F" || seq === "\x1bOF" || seq === "\x1b[4~") {
						this.moveCursorTo(this.buffer.length);
						continue;
					}
					toShell += seq;
				}
				continue;
			}
			if (code === 0x1b) {
				this.escapeBuffer = ch;
				continue;
			}
			if (code === 0x7f || code === 0x08) {
				if (this.cursor > 0) {
					this.buffer =
						this.buffer.slice(0, this.cursor - 1) +
						this.buffer.slice(this.cursor);
					this.cursor--;
					this.writer("\b");
					this.writer(this.buffer.slice(this.cursor));
					this.writer(" ");
					this.writer(`\x1b[${this.buffer.length - this.cursor + 1}D`);
				}
				continue;
			}
			if (code === 0x0d || code === 0x0a) {
				const line = this.buffer;
				if (
					line.trim().length > 0 &&
					this.history[this.history.length - 1] !== line
				) {
					this.history.push(line);
					if (this.history.length > LocalEcho.MAX_HISTORY) this.history.shift();
				}
				this.historyIndex = this.history.length;
				this.draft = "";
				this.buffer = "";
				this.cursor = 0;
				toShell += line + "\r\n";
				continue;
			}
			if (code === 0x09) {
				this.buffer =
					this.buffer.slice(0, this.cursor) + "\t" + this.buffer.slice(this.cursor);
				this.cursor++;
				this.writer("\t");
				continue;
			}
			if (code === 0x15) {
				this.clearLine();
				continue;
			}
			if (code === 0x03) {
				this.clearLine();
				toShell += "\x03";
				continue;
			}
			if (code === 0x01) {
				this.cursor = 0;
				continue;
			}
			if (code === 0x05) {
				this.cursor = this.buffer.length;
				continue;
			}
			if (code >= 0x20) {
				this.buffer =
					this.buffer.slice(0, this.cursor) + ch + this.buffer.slice(this.cursor);
				this.cursor++;
				this.writer(ch);
				if (this.cursor < this.buffer.length) {
					this.writer(this.buffer.slice(this.cursor));
					this.writer(`\x1b[${this.buffer.length - this.cursor}D`);
				}
				continue;
			}
			toShell += ch;
		}
		return toShell.length > 0 ? toShell : null;
	}
	clearLine() {
		const len = this.buffer.length;
		this.buffer = "";
		this.cursor = 0;
		this.historyIndex = this.history.length;
		if (len > 0) {
			this.writer(`\x1b[${len}D`);
			this.writer("\x1b[K");
		}
	}
	redrawFromCursor() {
		this.writer(this.buffer.slice(this.cursor));
		this.writer(" ");
		this.writer(`\x1b[${this.buffer.length - this.cursor + 1}D`);
	}
	setLine(text) {
		if (this.cursor > 0) this.writer(`\x1b[${this.cursor}D`);
		this.writer("\x1b[K");
		this.buffer = text;
		this.cursor = text.length;
		this.writer(text);
	}
	historyPrev() {
		if (this.history.length === 0) return;
		if (this.historyIndex === this.history.length) {
			this.draft = this.buffer;
		}
		if (this.historyIndex > 0) {
			this.historyIndex--;
			this.setLine(this.history[this.historyIndex]);
		}
	}
	historyNext() {
		if (this.historyIndex >= this.history.length) return;
		this.historyIndex++;
		if (this.historyIndex === this.history.length) {
			this.setLine(this.draft);
		} else {
			this.setLine(this.history[this.historyIndex]);
		}
	}
	moveCursor(delta) {
		this.moveCursorTo(this.cursor + delta);
	}
	moveCursorTo(pos) {
		const target = Math.max(0, Math.min(this.buffer.length, pos));
		const delta = target - this.cursor;
		if (delta === 0) return;
		this.writer(delta < 0 ? `\x1b[${-delta}D` : `\x1b[${delta}C`);
		this.cursor = target;
	}
	reset() {
		this.buffer = "";
		this.cursor = 0;
		this.escapeBuffer = "";
		this.historyIndex = this.history.length;
		this.draft = "";
	}
}

// ---- 复刻 pty.write 的 sanitize ----
function ptySanitize(data) {
	let sanitized = isWindows ? data.replace(/\r(?!\n)/g, "\r\n") : data;
	if (isWindows) sanitized = sanitized.replace(/\x7F/g, "\x08");
	return sanitized;
}

// ---- 测试运行器：只校验最终发给 shell 的字节 ----
function run(name, keystrokes, expect) {
	const echo = new LocalEcho(() => {});
	let toShell = "";
	for (const ks of keystrokes) {
		const f = echo.feed(ks);
		if (f) toShell += f;
	}
	const finalBytes = ptySanitize(toShell);
	const ok = finalBytes === expect;
	console.log(`[${ok ? "PASS" : "FAIL"}] ${name}`);
	console.log(`   keystrokes : ${JSON.stringify(keystrokes)}`);
	console.log(`   -> toShell : ${JSON.stringify(toShell)}`);
	if (!ok) {
		console.log(`   -> stdin   : ${JSON.stringify(finalBytes)}  (expect ${JSON.stringify(expect)})`);
		process.exitCode = 1;
	}
}

// ---- 测试运行器：逐步校验 buffer / cursor / 历史 ----
function runSteps(name, steps, expectations) {
	const echo = new LocalEcho(() => {});
	let toShell = "";
	let ok = true;
	const actual = [];
	for (const ks of steps) {
		const f = echo.feed(ks);
		if (f) toShell += f;
		actual.push({ input: ks, buffer: echo.buffer, cursor: echo.cursor });
	}
	// expectations: 每项为 [按键序号, 期望buffer, 期望cursor]
	for (const [idx, expBuf, expCur] of expectations) {
		const a = actual[idx];
		if (a.buffer !== expBuf || a.cursor !== expCur) {
			ok = false;
			console.log(
				`   步${idx + 1} 期望 buffer=${JSON.stringify(expBuf)} cursor=${expCur}，实际 buffer=${JSON.stringify(a.buffer)} cursor=${a.cursor}`,
			);
		}
	}
	console.log(`[${ok ? "PASS" : "FAIL"}] ${name}`);
	console.log(`   -> toShell : ${JSON.stringify(toShell)}`);
	if (!ok) process.exitCode = 1;
}

// xterm 按键编码
const BACKSPACE = "\x7f";
const ENTER = "\r";
const DEL = "\x1b[3~";
const CTRL_U = "\x15";
const UP = "\x1b[A";
const DOWN = "\x1b[B";
const LEFT = "\x1b[D";
const RIGHT = "\x1b[C";
const HOME = "\x1b[H";
const END = "\x1b[F";

console.log("=== 一、行编辑（回归）===");

run(
	"dir -> 删光(3xBS) -> ps -> Enter  => 应只发 ps",
	["d", "i", "r", BACKSPACE, BACKSPACE, BACKSPACE, "p", "s", ENTER],
	"ps\r\n",
);

run("ps -> Enter  => 应只发 ps", ["p", "s", ENTER], "ps\r\n");

run(
	"abc -> Ctrl+U -> xyz -> Enter  => 应只发 xyz",
	["a", "b", "c", CTRL_U, "x", "y", "z", ENTER],
	"xyz\r\n",
);

run(
	"dir -> Delete键(无效) -> Enter  => 应只发 dir",
	["d", "i", "r", DEL, ENTER],
	"dir\r\n",
);

console.log("\n=== 二、命令历史（↑ / ↓）===");

// 输入 dir 回车、ps 回车，然后 ↑↑ 应依次回填 ps、dir
runSteps(
	"dir(Enter) -> ps(Enter) -> ↑ -> ↑  => buffer 依次为 ps、dir",
	["d", "i", "r", ENTER, "p", "s", ENTER, UP, UP],
	[
		[7, "ps", 2], // 第 8 步（索引7）按第一次 ↑
		[8, "dir", 3], // 第 9 步按第二次 ↑
	],
);

// ↑ 到顶后继续 ↑ 应保持在最旧一条
runSteps(
	"↑ 到顶后再 ↑  => 停在最旧一条 dir",
	["d", "i", "r", ENTER, "p", "s", ENTER, UP, UP, UP],
	[
		[7, "ps", 2],
		[8, "dir", 3],
		[9, "dir", 3], // 已到顶，不变
	],
);

// ↓ 回到底部应恢复空行（草稿为空）
runSteps(
	"↑ -> ↓  => 回到空行",
	["d", "i", "r", ENTER, UP, DOWN],
	[
		[4, "dir", 3],
		[5, "", 0],
	],
);

// 草稿恢复：未提交的输入在按 ↑ 前保存，按 ↓ 应还原
runSteps(
	"dir(Enter) -> 输入 abc(不回车) -> ↑ -> ↓  => ↓ 应恢复 abc",
	["d", "i", "r", ENTER, "a", "b", "c", UP, DOWN],
	[
		[7, "dir", 3], // ↑ 显示历史
		[8, "abc", 3], // ↓ 还原草稿
	],
);

// 历史条目不应把 ↑↓ 本身发给 shell
run(
	"↑↓ 导航不应向 shell 发送任何字节",
	["d", "i", "r", ENTER, UP, DOWN, UP],
	"dir\r\n",
);

console.log("\n=== 三、行内光标（← / → / Home / End）===");

// hello -> ←← -> 输入 X => helXlo，光标在 X 后（位置4）
runSteps(
	"hello -> ←← -> X  => buffer=helXlo, cursor=4",
	["h", "e", "l", "l", "o", LEFT, LEFT, "X"],
	[[7, "helXlo", 4]],
);

// 行首继续 ← 应保持在 0
runSteps(
	"光标在行首继续 ←  => 不越界",
	["h", "i", LEFT, LEFT, LEFT],
	[
		[3, "hi", 0],
		[4, "hi", 0],
	],
);

// End / Home
runSteps(
	"hello -> Home -> End  => cursor 依次 0、5",
	["h", "e", "l", "l", "o", HOME, END],
	[
		[5, "hello", 0],
		[6, "hello", 5],
	],
);

// 光标移动后回车，整行内容仍完整发出
run(
	"hello -> ←← -> X -> Enter  => 发出 helXlo",
	["h", "e", "l", "l", "o", LEFT, LEFT, "X", ENTER],
	"helXlo\r\n",
);

console.log(
	process.exitCode
		? "\n>>> 存在失败用例"
		: "\n>>> 全部通过：行编辑 / 命令历史 / 光标移动 行为正确",
);

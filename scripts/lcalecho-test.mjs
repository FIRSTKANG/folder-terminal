// 仿真测试：忠实复刻 src/terminalView.ts 的 LocalEcho.feed()
// 与 src/pty.ts 的 ShellSession.write() 逻辑，验证 Windows 管道模式下
// "dir -> 删光 -> ps -> 回车" 等序列只会向 cmd.exe 发送正确的行。
//
// 注意：本文件必须与 terminalView.ts 的 LocalEcho.feed 保持同步。
// 若实现有改动，请同步更新此处的 LocalEcho。

const isWindows = true;

// ---- 复刻 LocalEcho ----
class LocalEcho {
	constructor(writer) {
		this.writer = writer;
		this.buffer = "";
		this.cursor = 0;
		this.escapeBuffer = "";
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
}

// ---- 复刻 pty.write 的 sanitize ----
function ptySanitize(data) {
	let sanitized = isWindows ? data.replace(/\r(?!\n)/g, "\r\n") : data;
	if (isWindows) sanitized = sanitized.replace(/\x7F/g, "\x08");
	return sanitized;
}

// ---- 测试运行器 ----
function run(name, keystrokes, expect) {
	const writes = [];
	const echo = new LocalEcho((d) => writes.push(d));
	let toShell = "";
	for (const ks of keystrokes) {
		const f = echo.feed(ks);
		if (f) toShell += f;
	}
	const finalBytes = ptySanitize(toShell);
	const ok = finalBytes === expect;
	console.log(`[${ok ? "PASS" : "FAIL"}] ${name}`);
	console.log(`   keystrokes : ${JSON.stringify(keystrokes)}`);
	console.log(`   buffer/echo: ${JSON.stringify(writes)}`);
	console.log(`   -> toShell : ${JSON.stringify(toShell)}`);
	console.log(`   -> stdin   : ${JSON.stringify(finalBytes)}  (expect ${JSON.stringify(expect)})`);
	if (!ok) process.exitCode = 1;
}

// xterm 按键编码：可打印字符即其本身，回车发 \r，退格发 \x7f，Delete 发 ESC[3~
const BACKSPACE = "\x7f";
const ENTER = "\r";
const DEL = "\x1b[3~";
const CTRL_U = "\x15";

run(
	"dir -> 删光(3xBS) -> ps -> Enter  => 应只发 ps",
	["d", "i", "r", BACKSPACE, BACKSPACE, BACKSPACE, "p", "s", ENTER],
	"ps\r\n",
);

run(
	"ps -> Enter  => 应只发 ps",
	["p", "s", ENTER],
	"ps\r\n",
);

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

console.log(process.exitCode ? "\n>>> 存在失败用例" : "\n>>> 全部通过：LocalEcho 不会把残留字符发给 shell");

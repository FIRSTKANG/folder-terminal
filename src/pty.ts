import { spawn, type ChildProcess } from "child_process";
import { existsSync } from "fs";
import type { Writable } from "stream";
import proxyCode from "./pty-proxy.py";
import { t } from "./i18n";

export interface ShellSession {
	/** 向 shell 写入输入（键盘 / 粘贴） */
	write(data: string): void;
	/** 终端尺寸变化：python 代理走 TIOCSWINSZ 控制通道，script 回退走 stty */
	resize(rows: number, cols: number): void;
	/** 结束会话 */
	kill(): void;
}

const isWindows = process.platform === "win32";

interface SpawnResult {
	proc: ChildProcess;
	/** fd 3 尺寸控制通道（仅 python 代理有） */
	control: Writable | null;
}

/**
 * Windows 下终端输出是「混合编码」：
 * - cmd.exe 自身的本地化消息（版权行、"活动代码页: 936"）走系统代码页 GBK；
 * - 用户输入的中文经 stdin 原样回显，是 UTF-8 字节。
 * 统一按 UTF-8 解前者会乱码，统一按 GBK 解后者会乱码，因此按 chunk 嗅探编码：
 * 先试严格 UTF-8（能识别被切断的多字节序列），确认不是 UTF-8 再回退 GBK。
 * Node 自带 full-icu，TextDecoder 原生支持 "gbk"，无需额外依赖。
 */
function createWindowsDecoder(): (chunk: Buffer) => string {
	let pending: Buffer | null = null;
	const utf8 = new TextDecoder("utf-8", { fatal: true });
	const gbk = new TextDecoder("gbk");

	const tryUtf8 = (buf: Buffer): string | null => {
		try {
			return utf8.decode(buf);
		} catch {
			return null;
		}
	};

	return (chunk: Buffer): string => {
		const buf = pending && pending.length ? Buffer.concat([pending, chunk]) : chunk;
		// 1) 完整 UTF-8
		const full = tryUtf8(buf);
		if (full !== null) {
			pending = null;
			return full;
		}
		// 2) 末尾可能是被切断的多字节序列，留到下一个 chunk 补齐
		for (let cut = 1; cut <= 3 && cut < buf.length; cut++) {
			const head = tryUtf8(buf.subarray(0, buf.length - cut));
			if (head !== null) {
				pending = buf.subarray(buf.length - cut);
				return head;
			}
		}
		// 3) 确实不是 UTF-8（cmd.exe 的 GBK 本地化消息）-> 按 GBK 解码
		pending = null;
		return gbk.decode(buf);
	};
}

function spawnPythonProxy(cwd: string, env: NodeJS.ProcessEnv, shell: string): SpawnResult {
	const proc = spawn("python3", ["-u", "-c", proxyCode, shell], {
		cwd,
		env,
		stdio: ["pipe", "pipe", "pipe", "pipe"], // fd 3 = 尺寸控制通道
	});
	return { proc, control: proc.stdio[3] as Writable | null };
}

/** Linux 兜底：util-linux 的 script 对管道/socket stdio 都兼容（macOS 的 BSD script 不行） */
function spawnScript(cwd: string, env: NodeJS.ProcessEnv, shell: string): SpawnResult {
	const proc = spawn("script", ["-q", "/dev/null", shell], { cwd, env });
	return { proc, control: null };
}

/**
 * 启动一个真实 Shell 会话。
 *
 * 平台策略：
 * - macOS / Linux：优先 python3 PTY 代理（pty.fork，真实伪终端，支持 TIOCSWINSZ 尺寸同步）
 * - Linux：python3 缺失时回退到 `script` 命令（仍可交互，尺寸同步降级为 stty）
 * - Windows：直连 shell（默认 cmd.exe），无 PTY。输入输出经管道转发，输入与方向键可用，
 *   但 vim / 进度条等依赖终端能力的程序受限；输出按 chunk 嗅探 UTF-8 / GBK 解码。
 *
 * 说明 1：macOS 上不用 `script`，因为 Node/Electron 的 child_process 管道是 socketpair（libuv），
 * BSD script 会对 stdin 做 tcgetattr 而直接失败（已实测复现）。
 * 说明 2：Windows 上不使用 winpty —— 它要求 stdin 是真正的 tty，而 Node 只能提供管道，
 * 实测 winpty 会打印 "stdin is not a tty" 后 exit 1。这是「启动成功但立刻失败」，
 * 不会触发 ENOENT 回退，终端会挂在死进程上导致无法输入，因此改为直连 shell。
 * 真正的 PTY 需要 ConPTY / node-pty 原生模块，暂不引入。
 */
export function spawnShell(
	cwd: string,
	shell: string,
	onData: (data: string) => void,
	onExit: (code: number | null) => void,
): ShellSession {
	const shellCmd = shell || (isWindows ? "cmd.exe" : "/bin/zsh");
	const env: NodeJS.ProcessEnv = { ...process.env };
	if (!isWindows) env.TERM = "xterm-256color";

	let proc: ChildProcess;
	let control: Writable | null = null;

	if (isWindows) {
		// 直连 shell（cmd.exe 或用户自定义），输入输出走管道
		proc = spawn(shellCmd, [], { cwd, env });
	} else {
		const r = spawnPythonProxy(cwd, env, shellCmd);
		proc = r.proc;
		control = r.control;
	}

	// stdout / stderr 各自维护解码状态，避免两条流交错时共用残缺缓冲
	const decodeOut = isWindows ? createWindowsDecoder() : (c: Buffer) => c.toString("utf8");
	const decodeErr = isWindows ? createWindowsDecoder() : (c: Buffer) => c.toString("utf8");

	const bind = (p: ChildProcess): void => {
		p.stdout?.on("data", (chunk: Buffer) => onData(decodeOut(chunk)));
		p.stderr?.on("data", (chunk: Buffer) => onData(decodeErr(chunk)));
		p.on("exit", (code) => onExit(code));
	};

	proc.on("error", (err) => {
		const code = (err as NodeJS.ErrnoException).code;
		if (code !== "ENOENT") {
			onData(`\r\n[Folder Terminal] ${t("pty.spawnFailed")}${err.message}\r\n`);
			return;
		}
		// ENOENT 无法区分「可执行文件缺失」和「工作目录无效」，先检查 cwd
		if (!existsSync(cwd)) {
			onData(`\r\n[Folder Terminal] ${t("pty.cwdMissing")}${cwd}\r\n`);
			return;
		}
		if (process.platform === "linux") {
			// python3 缺失 -> Linux 回退 script
			const fb = spawnScript(cwd, env, shellCmd);
			proc = fb.proc;
			control = fb.control;
			bind(proc);
			proc.on("error", (e) => onData(`\r\n[Folder Terminal] ${t("pty.spawnFailed")}${e.message}\r\n`));
			onData(`\r\n[Folder Terminal] ${t("pty.fallbackScript")}\r\n`);
			return;
		}
		if (process.platform === "darwin") {
			onData(`\r\n[Folder Terminal] ${t("pty.installXcode")}\r\n`);
			return;
		}
		onData(`\r\n[Folder Terminal] ${t("pty.spawnFailed")}${err.message}\r\n`);
	});
	bind(proc);

	let lastResizeKey = "";
	return {
		write(data: string): void {
			try {
				if (proc.stdin?.writable) {
					// Windows 管道模式下 cmd.exe 以 "\n" 作为行结束，而 xterm 的回车键只发送 "\r"
					// （真实 PTY 里由 line discipline 做 ICRNL 转换，管道模式没有这一层）。
					// 不补 "\n" 的话命令会被缓冲住不执行，表现为「打字有回显但回车没反应」。
					// 只补单独的 "\r"，已经是 "\r\n" 的保持不变，避免变成空行重复执行。
					proc.stdin.write(isWindows ? data.replace(/\r(?!\n)/g, "\r\n") : data);
				}
			} catch {
				// 会话已关闭，忽略
			}
		},
		resize(rows: number, cols: number): void {
			try {
				if (control) {
					control.write(`${rows} ${cols}\n`);
					return;
				}
				// script 回退：stty 尽力而为（仅 shell 提示符下生效）
				if (isWindows || !proc.stdin?.writable) return;
				const key = `${rows}x${cols}`;
				if (key === lastResizeKey) return;
				lastResizeKey = key;
				proc.stdin.write(`stty rows ${rows} cols ${cols}\n`);
			} catch {
				// 忽略
			}
		},
		kill(): void {
			try {
				proc.kill();
			} catch {
				// 已退出
			}
		},
	};
}


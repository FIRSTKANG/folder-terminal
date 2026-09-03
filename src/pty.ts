import { spawn, type ChildProcess } from "child_process";
import { existsSync } from "fs";
import { join } from "path";
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

/** Windows 常见 winpty 安装位置（Git for Windows / MSYS2 / Scoop / WinGet 等） */
const WINPTY_CANDIDATES: string[] = [
	"C:\\Program Files\\Git\\usr\\bin\\winpty.exe",
	"C:\\Program Files (x86)\\Git\\usr\\bin\\winpty.exe",
	"C:\\msys64\\usr\\bin\\winpty.exe",
	"C:\\msys32\\usr\\bin\\winpty.exe",
];

/**
 * 在 Windows 上定位可用的 winpty 可执行文件。
 * 很多用户装了 Git for Windows，但其 usr\\bin 不在系统 PATH 中，
 * 导致直接 spawn("winpty") 报 ENOENT。先扫描常见路径可大幅提升 PTY 可用率。
 */
function findWinpty(): string | null {
	if (!isWindows) return null;

	for (const p of WINPTY_CANDIDATES) {
		if (existsSync(p)) return p;
	}

	// scoop 用户级安装
	const userProfile = process.env.USERPROFILE;
	if (userProfile) {
		const scoopPath = join(userProfile, "scoop", "shims", "winpty.exe");
		if (existsSync(scoopPath)) return scoopPath;
	}

	// WinGet 默认链接目录
	const localAppData = process.env.LOCALAPPDATA;
	if (localAppData) {
		const wingetPath = join(localAppData, "Microsoft", "WinGet", "Links", "winpty.exe");
		if (existsSync(wingetPath)) return wingetPath;
	}

	// 留给 PATH 中直接可用的 winpty
	return null;
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
 * - Windows：优先 winpty（会先扫描 Git for Windows / MSYS2 / Scoop / WinGet 等常见路径，
 *   再在 PATH 中查找；若已安装则提供 PTY），缺失时回退 cmd.exe（无 PTY）
 *
 * 说明：macOS 上不用 `script`，因为 Node/Electron 的 child_process 管道是 socketpair（libuv），
 * BSD script 会对 stdin 做 tcgetattr 而直接失败（已实测复现）。
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
	let triedWinpty = false;

	if (isWindows) {
		// 先试 winpty（有 PTY）；ENOENT 时由 error 处理器回退 cmd.exe
		triedWinpty = true;
		const winptyPath = findWinpty();
		proc = spawn(winptyPath ?? "winpty", [shellCmd], { cwd, env });
	} else {
		const r = spawnPythonProxy(cwd, env, shellCmd);
		proc = r.proc;
		control = r.control;
	}

	const bind = (p: ChildProcess): void => {
		p.stdout?.on("data", (chunk: Buffer) => onData(chunk.toString("utf8")));
		p.stderr?.on("data", (chunk: Buffer) => onData(chunk.toString("utf8")));
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
		if (isWindows && triedWinpty) {
			// winpty 未安装 -> cmd.exe（无 PTY）
			triedWinpty = false;
			proc = spawnCmd(cwd, env).proc;
			bind(proc);
			proc.on("error", (e) => onData(`\r\n[Folder Terminal] ${t("pty.spawnFailed")}${e.message}\r\n`));
			onData(`\r\n[Folder Terminal] ${t("pty.fallbackWinpty")}\r\n`);
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
				if (proc.stdin?.writable) proc.stdin.write(data);
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

function spawnCmd(cwd: string, env: NodeJS.ProcessEnv): SpawnResult {
	const proc = spawn("cmd.exe", [], { cwd, env });
	return { proc, control: null };
}

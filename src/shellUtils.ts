import { App, FileSystemAdapter } from "obsidian";

/**
 * 计算文件/文件夹在磁盘上的绝对路径；非桌面端适配器（远程库等）时退化为相对路径。
 * 库根（relPath 为空串）时返回库根绝对路径，无尾部斜杠。
 */
export function toAbsPath(app: App, relPath: string): string {
	const adapter = app.vault.adapter;
	if (!(adapter instanceof FileSystemAdapter)) return relPath;
	const base = adapter.getBasePath();
	return relPath ? `${base}/${relPath}` : base;
}

/**
 * 在系统的文件管理器中定位并选中目标。
 *
 * @param absPath       目标的绝对路径（文件或文件夹）
 * @param linuxOpenDir  Linux 的 xdg-open 只能打开目录：目标为文件时传其所在目录，
 *                      目标为文件夹时传其自身（该差异由调用方区分）。
 * 用 child_process 调系统命令（插件渲染进程已依赖 Node 子进程）：
 * - macOS 用 `open -R` 在 Finder 中定位并选中
 * - Windows 用 `explorer /select,` 定位并选中
 * 通过 execFile（不经 shell、参数数组直传）避免命令注入。
 */
export function revealInFileManager(absPath: string, linuxOpenDir: string): Promise<void> {
	const win = window as unknown as {
		require?: (mod: string) => unknown;
		process?: { platform: string };
	};
	const requireFn = win.require;
	const platform = win.process?.platform;
	if (!requireFn || !platform) {
		return Promise.reject(new Error("当前环境不支持在系统文件管理器中展示"));
	}

	const proc = requireFn("child_process") as {
		execFile?: (cmd: string, args: string[], cb: (err: NodeJS.ErrnoException | null) => void) => void;
	};
	const execFile = proc.execFile;
	if (!execFile) return Promise.reject(new Error("child_process.execFile 不可用"));

	return new Promise<void>((resolve, reject) => {
		try {
			if (platform === "darwin") {
				execFile("open", ["-R", absPath], (err) => (err ? reject(err) : resolve()));
			} else if (platform === "win32") {
				execFile("explorer", [`/select,${absPath}`], (err) => (err ? reject(err) : resolve()));
			} else {
				execFile("xdg-open", [linuxOpenDir], (err) => (err ? reject(err) : resolve()));
			}
		} catch (err) {
			reject(err);
		}
	});
}
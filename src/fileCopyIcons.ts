import { App, FileSystemAdapter, Notice, setIcon, TFile } from "obsidian";
import { t } from "./i18n";
import { toAbsPath, revealInFileManager } from "./shellUtils";

/** 复制动作类型 */
type CopyAction = "title" | "path" | "content" | "file" | "abspath" | "reveal";

/**
 * 兼容多个 Obsidian 版本的文件行 DOM 结构。
 * 1.3 及以前：.tree-item.nav-file > .nav-file-title
 * 1.4+：      .tree-item.nav-file > .tree-item-self
 * 1.6+：      .tree-item-self.is-file（可能无 nav-file 包装）
 */
const FILE_SELECTORS = [
	".tree-item.nav-file > .nav-file-title",
	".tree-item.nav-file > .tree-item-self",
	".tree-item-self.is-file",
];

/** 每个图标的复制动作、Lucid icon 名与 i18n key（顺序即展示顺序） */
const ACTIONS: { action: CopyAction; icon: string; labelKey: string }[] = [
	{ action: "reveal", icon: "folder-open", labelKey: "icon.revealInFinder" },
	{ action: "path", icon: "route", labelKey: "icon.copyWikiPath" },
	{ action: "abspath", icon: "map-pin", labelKey: "icon.copyAbsPath" },
	{ action: "title", icon: "file-text", labelKey: "icon.copyTitle" },
	{ action: "content", icon: "copy", labelKey: "icon.copyContent" },
	{ action: "file", icon: "files", labelKey: "icon.copyFile" },
];

/**
 * 在文件浏览器的文件行上注入一组「复制」图标（标题 / Wiki 链接 / 内容 / 文件）。
 *
 * 与 FolderIconManager 相同的 MutationObserver 机制：鼠标移入文件行时
 * 一组图标淡入（opacity 0 -> 1），点击后执行对应复制动作。
 */
export class FileCopyIconManager {
	private container: HTMLElement | null = null;
	private observer: MutationObserver | null = null;

	constructor(private app: App) {}

	start(): void {
		this.attachObserver();
	}

	stop(): void {
		this.observer?.disconnect();
		this.observer = null;
		this.container?.querySelectorAll(".ft-copy-icons").forEach((el) => el.remove());
		this.container = null;
	}

	/** 通知语言变更后刷新已有图标的 title/aria-label */
	refreshLabels(): void {
		this.container
			?.querySelectorAll<HTMLElement>(".ft-copy-icons .ft-copy-icon")
			.forEach((btn) => {
				const action = btn.getAttribute("data-action") as CopyAction | null;
				if (!action) return;
				const label = t(this.labelKeyFor(action));
				btn.setAttribute("aria-label", label);
			});
	}

	private attachObserver(): void {
		const container = document.querySelector<HTMLElement>(".nav-files-container");
		if (!container) {
			this.container = null;
			return;
		}
		if (container === this.container) return;
		this.observer?.disconnect();
		this.container = container;
		this.observer = new MutationObserver(() => this.scan());
		this.observer.observe(container, { childList: true, subtree: true });
		this.scan();
	}

	private scan(): void {
		if (!this.container) return;
		for (const selector of FILE_SELECTORS) {
			this.container.querySelectorAll<HTMLElement>(selector).forEach((el) =>
				this.injectIfFile(el),
			);
		}
	}

	private injectIfFile(el: HTMLElement): void {
		const row = el.closest(".tree-item") ?? el;
		const isFile =
			row.classList.contains("nav-file") ||
			el.classList.contains("nav-file-title") ||
			el.classList.contains("is-file");
		const isFolder =
			row.classList.contains("nav-folder") ||
			el.classList.contains("nav-folder-title") ||
			el.classList.contains("is-folder");
		if (isFolder || !isFile) return;

		if (row.querySelector(".ft-copy-icons")) return;

		const path = this.resolveFilePath(el, row);

		const group = el.createEl("div", { cls: "ft-copy-icons" });
		for (const { action, icon, labelKey } of ACTIONS) {
			// 「复制文件」到系统剪贴板的通道在 Obsidian 渲染沙盒下不可用，暂时屏蔽该图标，
			// 功能实现保留（copyFile 的 file 分支与 copyFileToOs 仍在），便于将来开放。
			if (action === "file") continue;
			const label = t(labelKey);
			const btn = group.createEl("button", {
				cls: "ft-copy-icon",
				attr: {
					type: "button",
					"data-action": action,
					"aria-label": label,
				},
			});
			setIcon(btn, icon);
			btn.addEventListener("click", (evt) => {
				evt.stopPropagation();
				evt.preventDefault();
				// 点击后释放焦点，避免 :focus-within 让该行图标常驻、与悬停的其他行图标同时出现
				btn.blur();
				void this.copyFile(path, action);
			});
		}
		el.appendChild(group);
	}

	/**
	 * 解析文件相对库根的路径，逻辑与 FolderIconManager.resolveFolderPath 一致。
	 */
	private resolveFilePath(el: HTMLElement, row: Element): string {
		const direct =
			el.getAttribute("data-path") ??
			row.getAttribute("data-path") ??
			el.querySelector<HTMLElement>("[data-path]")?.getAttribute("data-path") ??
			row.querySelector<HTMLElement>("[data-path]")?.getAttribute("data-path");
		if (direct) return direct;

		try {
			const explorer = this.app.workspace.getLeavesOfType("file-explorer")[0];
			const view = explorer?.view as unknown as
				| { fileItems?: Record<string, { el?: HTMLElement }> }
				| undefined;
			const items = view?.fileItems;
			if (!items) return "";
			for (const [path, item] of Object.entries(items)) {
				if (item.el === el || item.el === row) return path;
			}
			for (const [path, item] of Object.entries(items)) {
				if (item.el && (item.el.contains(el) || row.contains(item.el))) return path;
			}
		} catch (err) {
			console.error("[Folder Terminal] 反查文件路径失败:", err);
		}
		return "";
	}

	private async copyFile(path: string, action: CopyAction): Promise<void> {
		const file = this.app.vault.getAbstractFileByPath(path);
		if (!(file instanceof TFile)) {
			new Notice(t("copy.fileNotFound"));
			return;
		}

		try {
			switch (action) {
				case "title":
					await navigator.clipboard.writeText(file.basename);
					break;
				case "path":
					// 文件系统相对路径，保留原始扩展名（如 wiki/ideas/xxx.md）
					await navigator.clipboard.writeText(file.path);
					break;
				case "content":
					await navigator.clipboard.writeText(await this.app.vault.read(file));
					break;
				case "abspath":
					await navigator.clipboard.writeText(toAbsPath(this.app, file.path));
					break;
				case "file":
					await this.copyFileToOs(file.path);
					break;
				case "reveal": {
					const abs = toAbsPath(this.app, file.path);
					// Linux 的 xdg-open 只能打开目录：文件在子目录则开其所在目录，否则开库根
					const dir = file.path.includes("/")
						? abs.slice(0, abs.lastIndexOf("/"))
						: abs;
					await revealInFileManager(abs, dir);
					new Notice(t("copy.revealed"));
					return;
				}
			}
			new Notice(t("copy.copied"));
		} catch (err) {
			console.error("[Folder Terminal] 复制到剪贴板失败:", err);
			new Notice(t("copy.failed"));
		}
	}

	/**
	 * 把文件「本身」放入系统剪贴板（可在 Finder / 资源管理器粘贴出真实文件）。
	 * 首选 Web Clipboard API 写 text/uri-list（Chromium 标准文件通道，对 Finder 可靠）；
	 * 失败再降级用 Electron clipboard（custom 需真实 Buffer）。
	 */
	private async copyFileToOs(relPath: string): Promise<void> {
		const adapter = this.app.vault.adapter;
		const absPath =
			adapter instanceof FileSystemAdapter ? `${adapter.getBasePath()}/${relPath}` : relPath;

		// 首选 Web Clipboard API 的 text/uri-list：Chromium/Electron 将其作为标准文件剪贴板
		// 通道，macOS Finder / Windows 资源管理器可据此粘贴出文件（writeText 已验证剪贴板可用）。
		try {
			await navigator.clipboard.write([
				new ClipboardItem({
					"text/uri-list": new Blob([`file://${absPath}\n`], { type: "text/uri-list" }),
					"text/plain": new Blob([absPath], { type: "text/plain" }),
				}),
			]);
			return;
		} catch (err) {
			console.error("[Folder Terminal] Web Clipboard 写文件失败:", err);
		}

		// 降级：Electron clipboard（custom 需真实 Buffer）
		const electron = this.getElectronClipboard();
		if (electron) {
			electron.clipboard.write({
				custom: {
					"public.file-url": this.clipboardBuffer(`file://${absPath}`),
					"text/uri-list": this.clipboardBuffer(`file://${absPath}\n`),
				},
			});
			return;
		}

		throw new Error("复制文件到剪贴板不可用");
	}

	/**
	 * 把文本转成剪贴板需要的二进制缓冲。
	 * Electron 的 clipboard.write custom 要求真正的 Node Buffer（而非 Uint8Array），
	 * 否则会被静默忽略。优先取全局 Buffer，或经 window.require("buffer") 获取，
	 * 兜底才用 Web TextEncoder。
	 */
	private getElectronClipboard(): {
		clipboard: { write: (data: Record<string, unknown>) => void };
	} | null {
		try {
			const win = window as unknown as { require?: (mod: string) => unknown };
			const requireFn = win.require;
			if (!requireFn) return null;
			const electron = requireFn("electron") as { clipboard?: unknown } | undefined;
			if (electron?.clipboard)
				return electron as { clipboard: { write: (data: Record<string, unknown>) => void } };
		} catch (err) {
			console.error("[Folder Terminal] 获取 Electron clipboard 失败:", err);
		}
		return null;
	}

	/**
	 * 把文本转成剪贴板需要的二进制缓冲。
	 * Electron 的 clipboard.write custom 要求真正的 Node Buffer（而非 Uint8Array），
	 * 否则会被静默忽略。优先取全局 Buffer，或经 window.require("buffer") 获取，
	 * 兜底才用 Web TextEncoder。
	 */
	private clipboardBuffer(s: string): Uint8Array {
		const buf = this.getNodeBuffer();
		if (buf) return buf(s, "utf-8");
		return new TextEncoder().encode(s);
	}

	/** 获取 Node Buffer 的 from 函数；拿不到时返回 null */
	private getNodeBuffer(): ((s: string, enc: string) => Uint8Array) | null {
		const g = globalThis as unknown as { Buffer?: { from?: unknown } };
		if (typeof g.Buffer?.from === "function") {
			return g.Buffer.from as (s: string, enc: string) => Uint8Array;
		}
		try {
			const mod = (window as unknown as { require?: (m: string) => unknown }).require?.("buffer") as
				| { Buffer?: { from?: unknown } }
				| undefined;
			if (!mod) return null;
			const BufferCtor = mod.Buffer;
			if (BufferCtor && typeof BufferCtor.from === "function") {
				return BufferCtor.from as (s: string, enc: string) => Uint8Array;
			}
		} catch (err) {
			console.info("[Folder Terminal] 获取 Node Buffer 失败:", err);
		}
		return null;
	}

	private labelKeyFor(action: CopyAction): string {
		switch (action) {
			case "title":
				return "icon.copyTitle";
			case "path":
				return "icon.copyWikiPath";
			case "content":
				return "icon.copyContent";
			case "abspath":
				return "icon.copyAbsPath";
			case "file":
				return "icon.copyFile";
			case "reveal":
				return "icon.revealInFinder";
		}
	}
}
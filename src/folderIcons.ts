import { App, Notice, setIcon } from "obsidian";
import { t } from "./i18n";
import { toAbsPath, revealInFileManager } from "./shellUtils";

export type OpenHandler = (folderPath: string) => void;

/** 文件夹行辅助动作类型 */
type FolderAction = "reveal" | "path" | "abspath";

/**
 * 兼容多个 Obsidian 版本的文件浏览器 DOM 结构。
 * 1.3 及以前：.tree-item.nav-folder > .nav-folder-title
 * 1.4+：      .tree-item.nav-folder > .tree-item-self.nav-folder-title
 * 1.6+：      .tree-item-self.is-folder（可能无 nav-folder 包装）
 */
const FOLDER_SELECTORS = [
	".tree-item.nav-folder > .nav-folder-title",
	".tree-item.nav-folder > .tree-item-self",
	".tree-item-self.is-folder",
];

/**
 * 在文件浏览器的文件夹标题上注入「终端」图标。
 *
 * 图标通过 CSS 控制显隐：鼠标移入文件夹行时出现（opacity 0 -> 1），
 * 点击后回调 onOpen(folderPath)。
 *
 * Obsidian 的文件树会随展开/收起/新建/重命名频繁重渲染，
 * 因此用 MutationObserver 监听容器并持续扫描补注入。
 */
export class FolderIconManager {
	private container: HTMLElement | null = null;
	private observer: MutationObserver | null = null;

	/** 点击图标时触发；folderPath 为相对库根的路径（空字符串 = 库根） */
	onOpen: OpenHandler = () => {};

	constructor(private app: App) {}

	start(): void {
		this.attachObserver();
	}

	stop(): void {
		this.observer?.disconnect();
		this.observer = null;
		this.container?.querySelectorAll(".ft-terminal-icon, .ft-folder-actions").forEach((el) =>
			el.remove(),
		);
		this.container = null;
	}

	private attachObserver(): void {
		const container = document.querySelector<HTMLElement>(".nav-files-container");
		if (!container) {
			// 文件浏览器尚未渲染（可能被关闭），等 layout-change 再次 start()
			this.container = null;
			return;
		}
		if (container === this.container) return; // 已挂载
		this.observer?.disconnect();
		this.container = container;
		this.observer = new MutationObserver(() => this.scan());
		this.observer.observe(container, { childList: true, subtree: true });
		this.scan();
	}

	private scan(): void {
		if (!this.container) return;
		for (const selector of FOLDER_SELECTORS) {
			this.container.querySelectorAll<HTMLElement>(selector).forEach((el) =>
				this.injectIfFolder(el),
			);
		}
	}

	private injectIfFolder(el: HTMLElement): void {
		const row = el.closest(".tree-item") ?? el;
		// 文件夹判定（任一命中）；文件行排除（任一命中）
		const isFolder =
			row.classList.contains("nav-folder") ||
			el.classList.contains("nav-folder-title") ||
			el.classList.contains("is-folder");
		const isFile =
			row.classList.contains("nav-file") ||
			el.classList.contains("nav-file-title") ||
			el.classList.contains("is-file");
		if (isFile || !isFolder) return;

		// 同一行只注入一次（多选择器可能重复命中）
		if (row.querySelector(".ft-terminal-icon") || row.querySelector(".ft-folder-actions"))
			return;

		// 1. 注入「在此打开终端」主图标
		const btn = el.createEl("button", {
			cls: "ft-terminal-icon",
			attr: {
				type: "button",
				"aria-label": t("icon.openHere"),
			},
		});
		setIcon(btn, "terminal");
		btn.addEventListener("click", (evt) => {
			// 阻止冒泡，避免触发展开/收起文件夹
			evt.stopPropagation();
			evt.preventDefault();
			// 点击后释放焦点，避免 :focus-visible 让该行图标常驻、与悬停的其他行图标同时出现
			btn.blur();
			// 点击时重新解析路径：Obsidian 新建文件夹默认名「未命名」，
			// 重命名后 DOM 节点不重建，注入时固化的 path 会过期
			this.onOpen(this.resolveFolderPath(el, row));
		});
		el.appendChild(btn);

		// 2. 注入 reveal/path/abspath 三个辅助动作（放在终端图标左侧）
		const group = el.createEl("div", { cls: "ft-folder-actions" });
		const actions: { action: FolderAction; icon: string; labelKey: string }[] = [
			{ action: "reveal", icon: "folder-open", labelKey: "icon.revealInFinder" },
			{ action: "path", icon: "route", labelKey: "icon.copyWikiPath" },
			{ action: "abspath", icon: "map-pin", labelKey: "icon.copyAbsPath" },
		];
		for (const { action, icon, labelKey } of actions) {
			const label = t(labelKey);
			const btnAction = group.createEl("button", {
				cls: "ft-copy-icon",
				attr: {
					type: "button",
					"data-action": action,
					"aria-label": label,
				},
			});
			setIcon(btnAction, icon);
			btnAction.addEventListener("click", (evt) => {
				evt.stopPropagation();
				evt.preventDefault();
				btnAction.blur();
				// 同终端图标：点击时重新解析路径，保证重命名后拿到最新路径
				void this.handleAction(this.resolveFolderPath(el, row), action);
			});
		}
		el.appendChild(group);
	}

	/**
	 * 解析文件夹相对库根的路径。
	 *
	 * 1. 优先文件浏览器视图的内部索引 fileItems（{ 路径: { el } }）：
	 *    新建/重命名/移动后该索引会同步，是权威数据；
	 *    而 DOM 上的 data-path 在重命名后可能未更新（如仍为「未命名」）。
	 * 2. 兜底读 DOM 上的 data-path（旧版本 Obsidian 提供）
	 */
	private resolveFolderPath(el: HTMLElement, row: Element): string {
		try {
			const explorer = this.app.workspace.getLeavesOfType("file-explorer")[0];
			const view = explorer?.view as unknown as
				| { fileItems?: Record<string, { el?: HTMLElement }> }
				| undefined;
			const items = view?.fileItems;
			if (items) {
				// 精确匹配
				for (const [path, item] of Object.entries(items)) {
					if (item.el === el || item.el === row) return path;
				}
				// 兜底：包含关系（某些情况下 el 被重新渲染）
				for (const [path, item] of Object.entries(items)) {
					if (item.el && (item.el.contains(el) || row.contains(item.el))) return path;
				}
			}
		} catch (err) {
			console.error("[Folder Terminal] 反查文件夹路径失败:", err);
		}

		// 兜底：DOM 上的 data-path（旧版本 Obsidian 提供）
		return (
			el.getAttribute("data-path") ??
			row.getAttribute("data-path") ??
			el.querySelector<HTMLElement>("[data-path]")?.getAttribute("data-path") ??
			row.querySelector<HTMLElement>("[data-path]")?.getAttribute("data-path") ??
			""
		);
	}

	/**
	 * 处理文件夹行的辅助动作。
	 *
	 * 关键：直接用文件树上解析出的 path，不依赖 vault.getAbstractFileByPath 反查。
	 * 因为手动新建的目录在文件树 DOM 已渲染、但 vault 抽象文件映射尚未同步时，
	 * 反查会拿不到对象而误报「目录不存在」。path 为空串即库根文件夹。
	 */
	private async handleAction(path: string, action: FolderAction): Promise<void> {
		try {
			switch (action) {
				case "path":
					// 库根（path 为空串）的相对路径即空字符串，直接复制
					await navigator.clipboard.writeText(path);
					break;
				case "abspath":
					await navigator.clipboard.writeText(toAbsPath(this.app, path));
					break;
				case "reveal": {
					const abs = toAbsPath(this.app, path);
					// Linux 的 xdg-open 只能打开目录：文件夹本身即目录，直接打开自身
					await revealInFileManager(abs, abs);
					new Notice(t("copy.revealed"));
					return;
				}
			}
			new Notice(t("copy.copied"));
		} catch (err) {
			console.error("[Folder Terminal] 文件夹操作失败:", err);
			new Notice(t("copy.failed"));
		}
	}
}

import { App, setIcon } from "obsidian";
import { t } from "./i18n";

export type OpenHandler = (folderPath: string) => void;

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
		this.container?.querySelectorAll(".ft-terminal-icon").forEach((el) => el.remove());
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
		if (row.querySelector(".ft-terminal-icon")) return;

		const path = this.resolveFolderPath(el, row);

		const btn = el.createEl("button", {
			cls: "ft-terminal-icon",
			attr: {
				type: "button",
				title: t("icon.openHere"),
				"aria-label": t("icon.openHere"),
			},
		});
		setIcon(btn, "terminal");
		btn.addEventListener("click", (evt) => {
			// 阻止冒泡，避免触发展开/收起文件夹
			evt.stopPropagation();
			evt.preventDefault();
			this.onOpen(path);
		});
		el.appendChild(btn);
	}

	/**
	 * 解析文件夹相对库根的路径。
	 *
	 * 1. 优先 DOM 上的 data-path（旧版本 Obsidian 提供）
	 * 2. Obsidian 1.13+ 移除了该属性：改用文件浏览器视图的内部索引
	 *    fileItems（{ 路径: { el } }），用我们命中的行元素反查路径
	 */
	private resolveFolderPath(el: HTMLElement, row: Element): string {
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
			// 精确匹配
			for (const [path, item] of Object.entries(items)) {
				if (item.el === el || item.el === row) return path;
			}
			// 兜底：包含关系（某些情况下 el 被重新渲染）
			for (const [path, item] of Object.entries(items)) {
				if (item.el && (item.el.contains(el) || row.contains(item.el))) return path;
			}
		} catch (err) {
			console.error("[Folder Terminal] 反查文件夹路径失败:", err);
		}
		return "";
	}
}

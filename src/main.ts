import { FileSystemAdapter, Plugin, TFolder, WorkspaceLeaf, getLanguage } from "obsidian";

declare const BUILD_STAMP: string;
import { FolderIconManager } from "./folderIcons";
import {
	DEFAULT_SETTINGS,
	FolderTerminalSettingTab,
	type FolderTerminalSettings,
} from "./settings";
import {
	FolderTerminalView,
	initialTerminalState,
	TERMINAL_VIEW_TYPE,
} from "./terminalView";
import { t, setLocale, resolveLocale } from "./i18n";

/**
 * Folder Terminal
 *
 * 鼠标移到文件浏览器的文件夹标题上时，右侧出现「终端」图标；
 * 点击后在 Obsidian 当前面板下方打开一个真实 Shell（PTY），
 * 工作目录自动切换为该文件夹。
 *
 * 仅支持桌面端（依赖 Node 的 child_process）。
 */
export default class FolderTerminalPlugin extends Plugin {
	settings: FolderTerminalSettings = DEFAULT_SETTINGS;
	private icons: FolderIconManager | null = null;
	private lastLeaf: WorkspaceLeaf | null = null;

	async onload(): Promise<void> {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, ((await this.loadData()) as Partial<FolderTerminalSettings> | null) ?? {});

		// 插件热更新时，旧代码创建的 TerminalView 实例仍会存活并继续使用旧的类定义。
		// 加载新代码后静默关闭所有已有 terminal panel，让用户从文件夹图标重新打开，
		// 确保每个 TerminalView 都使用当前 main.js 里的类。
		for (const leaf of this.app.workspace.getLeavesOfType(TERMINAL_VIEW_TYPE)) {
			leaf.detach();
		}
		// 应用已保存的界面语言（"system" 按 Obsidian 界面语言解析），让后续 t() 取词正确（命令名、初始渲染等）
		setLocale(resolveLocale(this.settings.language, getLanguage()));

		this.registerView(
			TERMINAL_VIEW_TYPE,
			(leaf) =>
				new FolderTerminalView(
					leaf,
					() => this.getVaultRoot(),
					() => this.settings,
					(tabs, activeId) => {
						// 把标签快照（含自定义设置）写回插件 data.json，
						// 即使 "Reload app without saving" 不写工作区布局也能保留。
						this.settings.savedTabs = tabs;
						this.settings.savedActiveTab = activeId;
						void this.saveSettings();
					},
				),
		);
		this.addSettingTab(new FolderTerminalSettingTab(this.app, this));

		// 在文件浏览器里注入悬浮图标
		this.icons = new FolderIconManager(this.app);
		this.icons.onOpen = (folderPath) => {
			void this.openTerminal(folderPath);
		};
		this.icons.start();

		// 布局变化（重新打开文件浏览器 / 切换工作区）后重新挂载图标
		this.registerEvent(this.app.workspace.on("layout-change", () => this.icons?.start()));

		// 文件浏览器右键菜单：在终端中打开（文件夹直接打开；文件取其所在目录）
		this.registerEvent(
			this.app.workspace.on("file-menu", (menu, file) => {
				if (!file) return;
				const folderPath = file instanceof TFolder ? file.path : (file.parent?.path ?? "");
				menu.addItem((item) =>
					item
						.setTitle(t("menu.openInTerminal"))
						.setIcon("terminal")
						.onClick(() => void this.openTerminal(folderPath)),
				);
			}),
		);

		// 文件夹被改名 / 移动（路径调整）时，自动迁移「按路径记忆」的标签设置缓存：
		// 把 tabSettingsByPath 里以旧路径为前缀的 key 整体重映射到新路径，
		// 并同步更新当前已打开的终端标签页 cwd，避免记忆丢失或落到旧路径。
		this.registerEvent(
			this.app.vault.on("rename", (file, oldPath) => {
				this.remapTabSettingsByPath(oldPath, file.path);
				for (const leaf of this.app.workspace.getLeavesOfType(TERMINAL_VIEW_TYPE)) {
					const view = leaf.view;
					if (view instanceof FolderTerminalView) view.onVaultRename(oldPath, file.path);
				}
			}),
		);

		this.addCommand({
			id: "open-terminal-at-vault-root",
			name: t("command.openAtVaultRoot"),
			callback: () => void this.openTerminal(""),
		});
		this.addCommand({
			id: "open-terminal-at-active-note-folder",
			name: t("command.openAtActiveNoteFolder"),
			checkCallback: (checking) => {
				const file = this.app.workspace.getActiveFile();
				if (!file) return false;
				if (!checking) void this.openTerminal(file.parent?.path ?? "");
				return true;
			},
		});
	}

	onunload(): void {
		this.icons?.stop();
		this.icons = null;
		document.getElementById("ft-xterm-css")?.remove();
		this.app.workspace.getLeavesOfType(TERMINAL_VIEW_TYPE).forEach((leaf) => leaf.detach());
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
	}

	/** 库在磁盘上的绝对路径（桌面端）。 */
	private getVaultRoot(): string {
		const adapter = this.app.vault.adapter;
		if (adapter instanceof FileSystemAdapter) {
			return adapter.getBasePath();
		}
		return "";
	}

	/**
	 * 当某个文件夹被改名 / 移动（路径调整）时，把「按路径记忆」缓存 tabSettingsByPath
	 * 中以旧路径为前缀的 key 整体重映射到新路径。
	 * - 精确命中（oldPath 本身是缓存 key）→ 整体搬过去
	 * - 前缀命中（oldPath 的子目录也被记忆过）→ 连同子目录一起搬（newPath + 原相对后缀）
	 * 与 Obsidian 触发 rename 事件的粒度（整文件夹一次 vs 逐子项多次）无关：
	 * 无论哪种顺序，前缀规则都能收敛到正确的最终 key，不会重复搬家。
	 */
	private remapTabSettingsByPath(oldPath: string, newPath: string): void {
		const store = this.settings.tabSettingsByPath;
		if (!store) return;
		let changed = false;
		for (const key of Object.keys(store)) {
			if (key === oldPath || key.startsWith(oldPath + "/")) {
				const newKey = newPath + key.slice(oldPath.length);
				store[newKey] = store[key];
				delete store[key];
				changed = true;
			}
		}
		if (changed) void this.saveSettings();
	}

	/** 判断 Leaf 是否仍挂在工作区中（用户可能已关闭它） */
	private isLeafAlive(leaf: WorkspaceLeaf): boolean {
		let alive = false;
		this.app.workspace.iterateAllLeaves((l) => {
			if (l === leaf) alive = true;
		});
		return alive;
	}

	/**
	 * 打开（或复用）底部的终端面板并切换到指定文件夹。
	 * @param folderPath 相对库根的路径；空字符串 = 库根目录
	 */
	private async openTerminal(folderPath: string): Promise<void> {
		// 复用策略：从「命中 lastLeaf cache」退到「命中工作区里已有的 terminal view」。
		// 两步都不能命中才新建（horizontal split）。这样 reload 后（Plugin 实例重建、
		// lastLeaf=null 但工作区里残留旧 panel）不会重复开第二个面板。
		let leaf: WorkspaceLeaf | null = this.lastLeaf;
		if (leaf && !this.isLeafAlive(leaf)) leaf = null;
		let canReuse =
			this.settings.reuseLeaf &&
			!!leaf &&
			leaf.getViewState().type === TERMINAL_VIEW_TYPE;

		if (!canReuse) {
			// 退一步：复用工作区里任意一个已存在的终端面板（reload 后的常见场景）
			const existing = this.app.workspace.getLeavesOfType(
				TERMINAL_VIEW_TYPE,
			)[0];
			if (existing) {
				leaf = existing;
				canReuse = this.settings.reuseLeaf;
			}
		}

		if (canReuse && leaf!.view instanceof FolderTerminalView) {
			// 复用面板：加入（或聚焦）该文件夹的标签页，会话保持
			leaf!.view.addTab(folderPath);
			this.lastLeaf = leaf;
			void this.app.workspace.revealLeaf(leaf!);
			return;
		}

		// 新建面板，拆分在下方（horizontal 分隔线 = 上下排列）
		const newLeaf = this.app.workspace.getLeaf("split", "horizontal");
		this.lastLeaf = newLeaf;
		await newLeaf.setViewState({
			type: TERMINAL_VIEW_TYPE,
			state: initialTerminalState(folderPath),
			active: true,
		});
		// 关键修复：不依赖 view 内部从 getViewState().state 解析 tabs（Obsidian 切换 view 时
		// state 传递不确定，会导致第一次点击只进 empty state、要点第二次才开终端）。
		// setViewState 已完成（onOpen 跑完）后显式 addTab 一定生效；若 setupView 已开过同名
		// tab 这里仅聚焦，不会重复创建。至此「点击一次图标即出终端」。
		const view = newLeaf.view;
		if (view instanceof FolderTerminalView) {
			view.addTab(folderPath);
		}
		void this.app.workspace.revealLeaf(newLeaf);
	}
}

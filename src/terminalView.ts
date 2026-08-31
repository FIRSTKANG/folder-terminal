import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { Terminal } from "@xterm/xterm";
import { ItemView, Menu, TFolder, TAbstractFile, WorkspaceLeaf, setIcon } from "obsidian";
import * as fs from "fs";
import * as path from "path";
import { spawnShell, type ShellSession } from "./pty";
import type { FolderTerminalSettings, PathTabOverrides } from "./settings";
import { TabSettingsModal } from "./tabSettingsModal";
import { t } from "./i18n";

export const TERMINAL_VIEW_TYPE = "folder-terminal-view";

export interface TerminalTab {
	id: string;
	/** 相对库根的文件夹路径；空字符串 = 库根 */
	cwd: string;
	/** 自定义标签名（双击重命名）；未设置时显示文件夹名 */
	label?: string;
	/** 每标签覆盖项 */
	shell?: string;
	colorScheme?: FolderTerminalSettings["colorScheme"];
	fontSize?: number;
	/** 打开标签时自动执行的命令（如 git status、npm run dev）；留空不执行 */
	initCommand?: string;
	/** 标签左侧色点颜色（十六进制），区分 dev/测试/日志 等用途；留空无色标 */
	color?: string;
}

/** main.ts 新建面板时用的初始视图状态 */
export function initialTerminalState(cwd: string): { tabs: TerminalTab[] } {
	return { tabs: [{ id: uid(), cwd }] };
}

interface TerminalViewState {
	tabs?: TerminalTab[];
	activeTab?: string;
	cwd?: string; // 兼容 v0.1/v0.2 的单标签状态
}

const FONT_FAMILY = 'ui-monospace, "SF Mono", Menlo, Consolas, monospace';

// GitHub 风格配色
const DARK_THEME = {
	background: "#0d1117",
	foreground: "#e6edf3",
	cursor: "#58a6ff",
	cursorAccent: "#0d1117",
	selectionBackground: "#264f78",
	black: "#484f58",
	red: "#ff7b72",
	green: "#3fb950",
	yellow: "#d29922",
	blue: "#58a6ff",
	magenta: "#bc8cff",
	cyan: "#39c5cf",
	white: "#b1bac4",
	brightBlack: "#6e7681",
	brightRed: "#ffa198",
	brightGreen: "#56d364",
	brightYellow: "#e3b341",
	brightBlue: "#79c0ff",
	brightMagenta: "#d2a8ff",
	brightCyan: "#56d4dd",
	brightWhite: "#f0f6fc",
};

const LIGHT_THEME = {
	background: "#ffffff",
	foreground: "#1f2328",
	cursor: "#0969da",
	cursorAccent: "#ffffff",
	selectionBackground: "#b6d3f5",
	black: "#1f2328",
	red: "#cf222e",
	green: "#1a7f37",
	yellow: "#9a6700",
	blue: "#0969da",
	magenta: "#8250df",
	cyan: "#1b7c83",
	white: "#6e7781",
	brightBlack: "#6e7781",
	brightRed: "#a40e26",
	brightGreen: "#1a7f37",
	brightYellow: "#633c01",
	brightBlue: "#0969da",
	brightMagenta: "#8250df",
	brightCyan: "#1b7c83",
	brightWhite: "#eff2f5",
};
/**
 * 承载 xterm.js 的多标签终端视图。
 *
 * - 每个文件夹一个标签页（tab），各自持有独立的 Terminal + PTY 会话
 * - 切换标签不销毁实例，滚动历史保留；标签页关闭才结束会话
 * - 标签支持：拖拽排序、双击重命名、右键菜单（重命名/标签设置/重启/关闭）
 * - 每标签可覆盖 Shell / 配色 / 字号（TabSettingsModal）
 * - 标签列表通过 getState() 持久化到 workspace 布局，重启 Obsidian 后自动恢复
 */
export class FolderTerminalView extends ItemView {
	private tabs: TerminalTab[] = [];
	private activeTabId: string | null = null;
	/** 标签拖拽排序的指针状态（纯 Pointer Events 实现，不依赖 HTML5 draggable）。 */
	private drag: { id: string; pointerId: number; startX: number; startY: number; moved: boolean; targetId: string | null } | null = null;
	/** 拖拽时的「插入位置指示线」DOM（懒创建，挂在 tabBar 内）。 */
	private dropIndicator: HTMLElement | null = null;
	/** 「▾ 更多标签」溢出下拉按钮（标签过多时显示）。 */
	private overflowBtn: HTMLElement | null = null;

	private tabBarEl: HTMLElement | null = null;
	private hostEl: HTMLElement | null = null;
	private emptyEl: HTMLElement | null = null;

	private readonly hosts = new Map<string, HTMLElement>();
	private readonly terminals = new Map<string, Terminal>();
	private readonly fitAddons = new Map<string, FitAddon>();
	private readonly sessions = new Map<string, ShellSession>();
	/** xterm 初始化失败时的纯文本降级输出 */
	private readonly fallbacks = new Map<string, HTMLElement>();
	private resizeObserver: ResizeObserver | null = null;
	/** view 是否已完成 setupView（hostEl 已就绪）；未完成时 addTab 先排队 */
	private ready = false;
	private pendingAdds: string[] = [];

	constructor(
		leaf: WorkspaceLeaf,
		private getVaultRoot: () => string,
		private getSettings: () => FolderTerminalSettings,
		private persistTabs: (tabs: TerminalTab[], activeId: string | null) => void,
	) {
		super(leaf);
	}

	getViewType(): string {
		return TERMINAL_VIEW_TYPE;
	}

	getDisplayText(): string {
		const active = this.activeTab();
		return active ? t("view.displayNameWith", { name: tabLabel(active) }) : t("view.displayName");
	}

	getIcon(): string {
		return "terminal";
	}

	/** 工作区布局保存时调用，用于重启后恢复标签 */
	getState(): any {
		return { tabs: this.tabs, activeTab: this.activeTabId };
	}

	/** 把当前标签快照（含自定义设置）写回插件 data.json，立即落盘、不依赖 workspace 保存时机 */
	private persist(): void {
		this.persistTabs(this.tabs, this.activeTabId);
	}

	/**
	 * 按文件夹路径（cwd）记忆/清除该标签的自定义设置。
	 * - 写入：把 tab 上所有自定义字段（label/shell/配色/字号/启动命令）按其 cwd 存到
	 *   settings.tabSettingsByPath，关掉标签后再重开同一文件夹也能恢复。
	 * - 清除：若该标签已无任何自定义设置（全部回退默认），则删掉该 cwd 的缓存条目。
	 * 注意：直接改动 this.getSettings() 返回的对象（即插件 settings 的实时引用），
	 * 随后 this.persist() 会随 savedTabs 一起通过 saveSettings() 落盘。
	 */
	private rememberPath(tab: TerminalTab): void {
		const settings = this.getSettings();
		if (!settings.tabSettingsByPath) settings.tabSettingsByPath = {};
		const store = settings.tabSettingsByPath;
		const ov: PathTabOverrides = {
			label: tab.label,
			shell: tab.shell,
			colorScheme: tab.colorScheme,
			fontSize: tab.fontSize,
			initCommand: tab.initCommand,
			color: tab.color,
		};
		const hasOverride =
			!!ov.label ||
			!!ov.shell ||
			(ov.colorScheme != null && ov.colorScheme !== "system") ||
			ov.fontSize != null ||
			!!ov.initCommand ||
			!!ov.color;
		if (hasOverride) {
			store[tab.cwd] = ov;
		} else {
			delete store[tab.cwd];
		}
	}

	async onOpen(): Promise<void> {
		try {
			await this.setupView();
		} catch (err) {
			console.error("[Folder Terminal] 视图初始化失败:", err);
			const msg = err instanceof Error ? err.stack || err.message : String(err);
			// 用 try/catch 兜住 containerEl 操作，避免样式炸掉后 empty 状态也炸
			try {
				this.containerEl.empty();
			} catch {
				/* ignore */
			}
			this.containerEl.createEl("pre", {
				cls: "ft-error",
				text: `[Folder Terminal] ${t("view.initFailed")}\n${msg}`,
			});
		}
	}

	private async setupView(): Promise<void> {
		this.containerEl.classList.add("ft-terminal-view");
		// xterm.css 已合并到全局 styles.css（Obsidian 禁止动态创建 <style> 元素）
		this.applyStatusBarHeight(); // 探测并写入真实状态栏高度，避免 view 底部被遮住

		// 【布局保底】containerEl 即 .workspace-leaf-content，其 containing block 是
		// .workspace-leaf（position:relative）。用 position:absolute + inset:0 即可精确
		// 填满整个 leaf，不依赖任何父级 height 链传递。
		// 底部留出 --status-bar-height（状态栏是 viewport-fixed overlay，会盖住 leaf 底部）。
// 容器样式完全由 styles.css 接管（.ft-terminal-view 等三选器规则）
	// 这里只设最低优先级兜底 class（避免被某些 Obsidian 版本下默认 class 覆盖）：
	this.containerEl.addClass("ft-terminal-view");

	// 诊断条已退役（之前 17 轮调试期的临时工具，布局稳定后即移除）。
	// 当前布局完全可依赖 CSS（position:absolute + inset:0 + 四角锚定），
	// 不再需要常驻 DOM 干扰视觉。

		this.tabBarEl = this.containerEl.createDiv({ cls: "ft-tab-bar" });
		this.hostEl = this.containerEl.createDiv({ cls: "ft-terminal-hosts" });

		// 拖拽文件夹/文件到终端区域 → 当前激活标签 cd 到目标目录
		this.hostEl.addEventListener("dragover", (e) => {
			if (e.dataTransfer) {
				e.dataTransfer.dropEffect = "copy";
				e.preventDefault();
			}
		});
		this.hostEl.addEventListener("drop", (e) => {
			e.preventDefault();
			const target = this.resolveDropPath(e);
			if (target) this.cdTo(target);
		});
		// 终端区域右键菜单：复制 / 粘贴 / 清屏
		this.hostEl.addEventListener("contextmenu", (e) => {
			e.preventDefault();
			e.stopPropagation();
			this.showTerminalMenu(e);
		});

		this.resizeObserver = new ResizeObserver(() => {
			this.forcePositioning();
			this.fitActive();
			this.scheduleOverflow();
		});
		this.resizeObserver.observe(this.hostEl);
		// 同时监听父级尺寸变化：layout 真正完成时（如 split resize / window resize）
		// 会触发 resize 事件 → 强制重新计算
		const parent = this.containerEl.parentElement;
		if (parent) this.resizeObserver.observe(parent);
		this.registerEvent(this.app.workspace.on("layout-change", () => {
			this.forcePositioning();
			this.fitActive();
			this.scheduleOverflow();
		}));
		// 用户切回终端面板时（如点了工作区里的终端标签）重新聚焦
		this.registerEvent(
			this.app.workspace.on("active-leaf-change", (leaf) => {
				if (leaf === this.leaf && this.activeTabId) this.focusTerminal(this.activeTabId);
			}),
		);

		// 标签恢复：优先从插件 data.json 的 savedTabs 读（由 persist() 即时落盘，
		// 即便 "Reload app without saving" 不写工作区布局也能保留自定义设置）；
		// 兜底再从 workspace 状态的 tabs 读（覆盖正常 reload 路径 + 兼容老版本）。
		const saved = this.getSettings().savedTabs;
		const wsState = this.leaf.getViewState().state as TerminalViewState | undefined;
		const fromData = saved && saved.length ? saved : null;
		const fromWs = wsState?.tabs && wsState.tabs.length ? wsState.tabs : null;
		// 兼容老 v0.1/v0.2 持久化：只存了 cwd
		const fromLegacyCwd =
			!fromData && !fromWs && wsState?.cwd != null ? [{ id: uid(), cwd: wsState.cwd }] : null;

		const tabs = fromData ?? fromWs ?? fromLegacyCwd ?? null;
		if (tabs) {
			const savedActive = this.getSettings().savedActiveTab;
			const activeId =
				savedActive && tabs.some((t) => t.id === savedActive)
					? savedActive
					: wsState?.activeTab && tabs.some((t) => t.id === wsState.activeTab)
						? wsState.activeTab
						: tabs[0].id;
			for (const tab of tabs) this.openTab(tab);
			this.activateTab(activeId);
			// 若本次是从 workspace/legacy 兜底恢复的，写回 data.json 固化，确保下次 without-saving 也能保留
			this.persist();
		} else {
			// state 完全空 → 直接进入 empty state（点击文件夹图标会调用 addTab）
			this.syncEmpty();
		}

		this.addAction("refresh-cw", t("view.restartSession"), () => this.restartActive());

		// 快捷键（capture 阶段拦截，避免被 xterm 吞掉）：见 onKeyDown
		this.registerDomEvent(
			this.containerEl,
			"keydown",
			(evt: KeyboardEvent) => this.onKeyDown(evt),
			true,
		);

		// 多次 fit 调度：Obsidian 在 view 刚 onOpen 时布局链还未完全就绪，
		// 单次 rAF 经常遇到 containerEl=0；多 schedule 几次等到 layout 真正完成
		this.forcePositioning();
		this.scheduleRepeatedFit();

		// 标记 ready 并 flush 排队的 addTab（如 openTerminal 在 view onOpen 前就调用了 addTab）。
		// 这样无论 Obsidian 是否在 setViewState 时 await onOpen，第一次点击图标都必开终端。
		this.ready = true;
		if (this.pendingAdds.length) {
			const pending = this.pendingAdds;
			this.pendingAdds = [];
			for (const cwd of pending) this.addTab(cwd);
		}
	}

	/**
	 * 确保 containerEl 填满其 containing block（.workspace-leaf）。
	 *
	 * 关键修正（2026-08-30 第十六次）：之前错误地用
	 * parent.getBoundingClientRect() 的【viewport 坐标】去写 top/left/width/height
	 * ——但 position:absolute 的偏移是相对 containing block（.workspace-leaf）的
	 * padding box，不是 viewport。把 viewport 坐标当偏移用 = 双重偏移，容器被推到
	 * leaf 之外（如 leaf 已在 viewport y=300，又写 top:300px => viewport y=600），
	 * 整个视图（含诊断条）被挤出可视区 => 表现为"空白"。
	 *
	 * 正确做法：containing block 就是 .workspace-leaf，inset:0 即可精确填满，
	 * 不需要任何坐标运算；底部用 var(--status-bar-height) 让出状态栏即可。
	 */
	private forcePositioning(): void {
		// 容器样式完全由 styles.css 接管（.ft-terminal-view 等三选器规则），
		// 此函数保留为 no-op，供 scheduleRepeatedFit 重复调用以兼容历史调用点。
	}

	/**
	 * 多次 fit + 多次 forcePositioning。
	 * 覆盖：layout 完成、字体加载、CSS 应用、内容流入导致高度变化这几种时机。
	 */
	private scheduleRepeatedFit(): void {
		this.forcePositioning();
		this.fitActive();

		const delays = [80, 200, 500, 1200];
		for (const d of delays) {
			setTimeout(() => {
				this.forcePositioning();
				this.fitActive();
			}, d);
		}
	}

	async onClose(): Promise<void> {
		this.resizeObserver?.disconnect();
		this.resizeObserver = null;
		for (const session of this.sessions.values()) session.kill();
		this.sessions.clear();
		for (const terminal of this.terminals.values()) terminal.dispose();
		this.terminals.clear();
		this.fitAddons.clear();
		this.fallbacks.clear();
		this.hosts.clear();
		this.tabs = [];
		this.activeTabId = null;
	}

	/** 供插件入口调用：为该文件夹加入（或聚焦）一个标签页 */
	addTab(cwd: string): void {
		if (!this.hostEl) {
			// view 尚未完成 onOpen（setupView 还没建好 hostEl），先排队，
			// setupView 末尾会 flush。防御 Obsidian 未在 setViewState 时 await onOpen 的极端情况
			if (!this.pendingAdds.includes(cwd)) this.pendingAdds.push(cwd);
			return;
		}
		const existing = this.tabs.find((t) => t.cwd === cwd);
		if (existing) {
			this.activateTab(existing.id);
			return;
		}
		const tab: TerminalTab = { id: uid(), cwd };
		// 按路径记忆：若该文件夹之前自定义过设置（关掉再开也保留），恢复到新标签
		const remembered = this.getSettings().tabSettingsByPath?.[cwd];
		if (remembered) {
			if (remembered.label !== undefined) tab.label = remembered.label;
			if (remembered.shell !== undefined) tab.shell = remembered.shell;
			if (remembered.colorScheme !== undefined) tab.colorScheme = remembered.colorScheme;
			if (remembered.fontSize !== undefined) tab.fontSize = remembered.fontSize;
			if (remembered.initCommand !== undefined) tab.initCommand = remembered.initCommand;
			if (remembered.color !== undefined) tab.color = remembered.color;
		}
		this.openTab(tab);
		this.activateTab(tab.id);
		// 加固：新开标签后写盘（data.json + workspace），避免 "Reload app without saving" 丢掉刚开的标签。
		this.persist();
		this.app.workspace.requestSaveLayout();
	}

	/**
	 * 在当前激活的标签页里执行 cd 切换目录。
	 * 触发源：把文件夹/文件拖拽到终端区域、右键菜单「在终端中打开」等。
	 * @param targetPath 相对库根的路径（文件夹）或文件绝对/相对路径；文件会自动取其所在目录
	 */
	cdTo(targetPath: string): void {
		const tab = this.activeTab();
		if (!tab) return;
		const absolute = resolveCwd(this.getVaultRoot(), targetPath);
		const session = this.sessions.get(tab.id);
		if (session) {
			try {
				// 双引号包裹以兼容含空格的路径；末尾 \r 模拟回车执行
				session.write(`cd "${absolute}"\r`);
			} catch {
				/* 会话已关闭，忽略 */
			}
			// 同步标签状态：更新 cwd 让标题与真实目录一致，并刷新标签栏
			tab.cwd = targetPath;
			this.renderTabBar();
			// 加固：cd 改了标签 cwd，立即写盘（data.json + workspace），避免 "Reload app without saving" 回退目录
			this.persist();
			this.app.workspace.requestSaveLayout();
		} else {
			// 纯文本降级模式没有真实 shell，cd 无意义
			const fb = this.fallbacks.get(tab.id);
			if (fb) {
				fb.textContent += `\r\n[Folder Terminal] ${t("view.cdUnsupported")}\r\n`;
				fb.scrollTop = fb.scrollHeight;
			}
		}
	}

	/**
	 * 从拖拽事件里解析出目标目录（相对库根路径）。
	 * 解析优先级：
	 *   1. 系统文件管理器拖入的本地文件/文件夹（dataTransfer.files[].path）
	 *   2. Obsidian 内部拖拽的 [[wikilink]] / 文件名（dataTransfer text/plain）
	 *   3. 兜底：Obsidian 内部 dragManager.draggables（最可靠的内部拖拽来源）
	 * 文件一律取其所在目录。
	 */
	private resolveDropPath(e: DragEvent): string | null {
		const dt = e.dataTransfer;
		// 1. 从 Finder / 资源管理器等系统文件管理器拖入
		const localFile = dt?.files?.[0] as (File & { path?: string }) | undefined;
		if (localFile && localFile.path) {
			const p = localFile.path;
			try {
				return fs.statSync(p).isDirectory() ? p : path.dirname(p);
			} catch {
				return path.dirname(p);
			}
		}
		// 2. Obsidian 内部拖拽：dataTransfer 常含 [[wikilink]] 或纯文件名
		const text = dt?.getData("text/plain")?.trim() ?? "";
		if (text) {
			const m = text.match(/^\[\[(.+?)\]\]$/);
			const name = (m ? m[1] : text).split("|")[0].split("#")[0].trim();
			if (name) {
				const af: TAbstractFile | null =
					this.app.vault.getAbstractFileByPath(name) ??
					this.app.metadataCache.getFirstLinkpathDest(name, "");
				if (af) return af instanceof TFolder ? af.path : (af.parent?.path ?? "");
			}
		}
		// 3. 兜底：Obsidian 内部拖拽的 draggables（dragManager 在拖拽进行中持有当前项）
		const draggables = (this.app as unknown as { dragManager?: { draggables?: any[] } })
			.dragManager?.draggables;
		if (Array.isArray(draggables) && draggables.length) {
			const d = draggables[0];
			const f = d.file ?? d.files?.[0] ?? d.folders?.[0];
			if (f) return f instanceof TFolder ? f.path : (f.parent?.path ?? "");
		}
		return null;
	}

	/**
	 * 文件夹被改名 / 移动时，把当前已打开的终端标签页的 cwd 同步到新路径，
	 * 让标签标题、拖拽 cd 目标、rememberPath 落盘都指向新路径（而非失配的旧路径）。
	 * 注意：只更新人类可见的 cwd 元数据；已运行的 shell 会话仍停留在原 inode 上，
	 * 用户如需让会话真正切到新目录，可手动 cd / 重启会话。
	 */
	onVaultRename(oldPath: string, newPath: string): void {
		let changed = false;
		for (const tab of this.tabs) {
			if (tab.cwd === oldPath || tab.cwd.startsWith(oldPath + "/")) {
				tab.cwd = newPath + tab.cwd.slice(oldPath.length);
				changed = true;
			}
		}
		if (changed) {
			this.renderTabBar();
			this.persist();
			this.app.workspace.requestSaveLayout();
		}
	}

	// ---------- 内部：标签生命周期 ----------

	private activeTab(): TerminalTab | undefined {
		return this.tabs.find((t) => t.id === this.activeTabId);
	}

	private openTab(tab: TerminalTab): void {
		this.tabs.push(tab);
		this.syncEmpty();

		const host = this.hostEl!.createDiv({ cls: "ft-terminal-host" });
		host.dataset.tabId = tab.id;
		this.hosts.set(tab.id, host);

		// 注意：必须在可见状态下 open xterm（display:none 中 open 可能渲染异常），
		// 之后再统一由 activateTab 隐藏非活动标签
		try {
			this.createTerminalRuntime(tab);
			this.startSession(tab);
		} catch (err) {
			console.error("[Folder Terminal] openTab 失败:", err);
			this.showRuntimeError(
				tab,
				err instanceof Error ? err.stack || err.message : String(err),
			);
		}
		this.renderTabBar();
	}

	/**
	 * 把 createTerminalRuntime / startSession 抛出的异常直接显示在 host 里。
	 *
	 * 为什么不依赖 xterm 的 fallback 路径？因为 xterm 本身能被创建（容器在）。
	 * 真正抛错的是 xterm.open(host) 这种 DOM 层错误，必须让用户**直接看到**——
	 * 否则他会以为 view 又是"沉默失败"，陷入我和你前几轮一样的反向优化循环。
	 */
	private showRuntimeError(tab: TerminalTab, msg: string): void {
		const host = this.hosts.get(tab.id);
		if (!host) return;
		host.empty();
		const pre = host.createEl("pre", {
			cls: "ft-fallback",
			text: `[Folder Terminal] ${t("view.createFailed", { cwd: tab.cwd || t("tab.root"), msg })}`,
		});
		this.fallbacks.set(tab.id, pre);
	}

	/** 为标签创建 xterm 运行时（配色/字号按「有效设置」= 全局 + 标签覆盖） */
	private createTerminalRuntime(tab: TerminalTab): void {
		const host = this.hosts.get(tab.id)!;
		try {
			const settings = this.effectiveSettings(tab);
			const isDark =
				settings.colorScheme === "dark" ||
				(settings.colorScheme === "system" && document.body.classList.contains("theme-dark"));
			const terminal = new Terminal({
				cursorBlink: true,
				fontSize: settings.fontSize,
				fontFamily: FONT_FAMILY,
				theme: isDark ? DARK_THEME : LIGHT_THEME,
				scrollback: 10000,
			});
			const fitAddon = new FitAddon();
			terminal.loadAddon(fitAddon);
			terminal.loadAddon(new WebLinksAddon());
			terminal.open(host);
			terminal.onData((data) => this.sessions.get(tab.id)?.write(data));
			this.terminals.set(tab.id, terminal);
			this.fitAddons.set(tab.id, fitAddon);

			// 保险：点击终端区域时把焦点交给 xterm 的隐藏输入框
			host.addEventListener("mousedown", () => {
				try {
					terminal.focus();
				} catch {
					// 忽略
				}
			});
		} catch (err) {
			// xterm 渲染不可用 → 降级为纯文本输出，错误直接展示
			console.error("[Folder Terminal] xterm 初始化失败，已降级为纯文本模式:", err);
			this.terminals.delete(tab.id);
			this.fitAddons.delete(tab.id);
			const pre = host.createEl("pre", {
				cls: "ft-fallback",
				text: `[Folder Terminal] ${t("view.xtermFallback", {
					msg: err instanceof Error ? err.message : String(err),
				})}`,
			});
			this.fallbacks.set(tab.id, pre);
		}
	}

	/** 销毁并重建标签的 xterm + 会话（修改设置后应用） */
	private recreateTabRuntime(tab: TerminalTab): void {
		this.sessions.get(tab.id)?.kill();
		this.sessions.delete(tab.id);
		this.terminals.get(tab.id)?.dispose();
		this.terminals.delete(tab.id);
		this.fitAddons.delete(tab.id);
		this.fallbacks.delete(tab.id);
		this.hosts.get(tab.id)?.empty();
		this.createTerminalRuntime(tab);
		this.startSession(tab);
		if (this.activeTabId === tab.id) {
			requestAnimationFrame(() => this.fitActive());
		}
	}

	private startSession(tab: TerminalTab): void {
		this.sessions.get(tab.id)?.kill();
		const cwd = resolveCwd(this.getVaultRoot(), tab.cwd);

		// 输出目标：xterm 正常则写 xterm，否则写纯文本降级面板
		const write = (data: string): void => {
			const terminal = this.terminals.get(tab.id);
			if (terminal) {
				terminal.write(data);
				return;
			}
			const fallback = this.fallbacks.get(tab.id);
			if (fallback) {
				fallback.textContent += data;
				fallback.scrollTop = fallback.scrollHeight;
			}
		};

		// 诊断横幅：让用户在终端里直接看到启动参数与错误原因
		write(`\r\n[Folder Terminal] ${t("view.bannerStarting")}\r\n`);
		write(`  vault    = ${this.getVaultRoot()}\r\n`);
		write(`  cwd      = ${cwd}\r\n`);
		write(`  shell    = ${this.effectiveSettings(tab).shell || "默认($SHELL)"}\r\n`);
		write(`  platform = ${process.platform}\r\n`);

		const session = spawnShell(
			cwd,
			this.effectiveSettings(tab).shell,
			(data) => write(data),
			(code) => {
				write(`\r\n[Folder Terminal] ${t("view.sessionEnded", { code: code ?? "signal" })}\r\n`);
				this.sessions.delete(tab.id);
			},
		);
		this.sessions.set(tab.id, session);
		const terminal = this.terminals.get(tab.id);
		session.resize(terminal?.rows ?? 24, terminal?.cols ?? 80);

		// 启动命令：shell 就绪后自动执行（如 git status / npm run dev / conda activate）。
		// 用 setTimeout 让 shell 提示符先出现，再写入命令 + 回车；write 内部有 guard，
		// 即使会话提前关闭也不会抛错。
		const init = this.effectiveSettings(tab).initCommand;
		if (init && init.trim()) {
			const cmd = init.trim();
			setTimeout(() => {
				try {
					session.write(cmd + "\r");
				} catch {
					// 会话已关闭，忽略
				}
			}, 200);
		}
	}

	activateTab(id: string): void {
		this.activeTabId = id;
		this.hosts.forEach((host, tabId) => {
			host.hidden = tabId !== id;
		});
		// 只切换激活态样式，不打碎 tabBar DOM：
		// 否则 click→renderTabBar 重建 label 节点会破坏 dblclick 必需的「同一目标节点」，
		// 导致双击重命名（以及任何依赖 label 节点的交互）永远触发不了。
		this.updateActiveClasses();
		this.syncEmpty();
		// 激活态也持久化，避免 "Reload without saving" 后激活标签漂移
		this.persist();
		// rAF 让样式应用完再 fit；之后用同样的多 schedule 覆盖 layout 滞后
		requestAnimationFrame(() => {
			this.fitActive();
			this.focusTerminal(id);
		});
		// 切 tab 时也调度几次，因为不同 tab 的容器尺寸可能不同
		const delays = [80, 200, 500];
		for (const d of delays) setTimeout(() => this.fitActive(), d);
	}

	/**
	 * 把键盘焦点交给 xterm 的输入框。
	 * Obsidian 在视图激活后可能抢占焦点，因此做几次延迟重试。
	 */
	private focusTerminal(id: string): void {
		const doFocus = (): void => {
			if (this.activeTabId !== id) return;
			// 正在重命名（标签栏存在 .ft-tab-rename 输入框）时，绝不把焦点抢回终端，
			// 否则会把刚聚焦的输入框抢走、触发 blur → 输入框一闪即逝。
			if (this.tabBarEl?.querySelector(".ft-tab-rename")) return;
			const terminal = this.terminals.get(id);
			if (!terminal) return;
			try {
				terminal.focus();
			} catch {
				// 忽略
			}
		};
		doFocus();
		setTimeout(doFocus, 100);
		setTimeout(doFocus, 300);
	}

	/** 销毁一个标签的运行时与 DOM（不重渲染、不持久化，由调用方统一处理）。 */
	private destroyTab(id: string): void {
		this.sessions.get(id)?.kill();
		this.sessions.delete(id);
		this.terminals.get(id)?.dispose();
		this.terminals.delete(id);
		this.fitAddons.delete(id);
		this.fallbacks.delete(id);
		this.hosts.get(id)?.remove();
		this.hosts.delete(id);
		this.tabs = this.tabs.filter((t) => t.id !== id);
	}

	private closeTab(id: string): void {
		const wasActive = this.activeTabId === id;
		this.destroyTab(id);
		// 无论关闭的是否激活标签，都必须重建 tabBar：
		// 之前 `if (!wasActive) renderTabBar()` 会让关闭激活标签后，
		// 旧标签的 DOM 还卡在 tabBar 里（数据已删除但 DOM 未销毁），导致用户看到「点击 X 没反应」。
		this.renderTabBar();
		if (wasActive) {
			this.activeTabId = this.tabs[this.tabs.length - 1]?.id ?? null;
			if (this.activeTabId) {
				this.activateTab(this.activeTabId);
			} else {
				this.syncEmpty();
			}
		}
		// 标签列表（及可能的激活态）已变，持久化到 data.json
		this.persist();
	}

	/** 复制标签：同目录、同自定义设置，另开一个标签（绕过 addTab 的同目录去重）。 */
	private duplicateTab(id: string): void {
		const src = this.tabs.find((t) => t.id === id);
		if (!src) return;
		// 新标签名称与原标签不同：基础名 + 副本后缀，并自动去重（避免与已有标签重名）
		const baseName = src.label || tabLabel(src);
		let newLabel = baseName + t("tab.copySuffix");
		let n = 2;
		while (this.tabs.some((tm) => tm.label === newLabel)) {
			newLabel = `${baseName}${t("tab.copySuffix")} ${n}`;
			n++;
		}
		const tab: TerminalTab = {
			id: uid(),
			cwd: src.cwd,
			label: newLabel,
			shell: src.shell,
			colorScheme: src.colorScheme,
			fontSize: src.fontSize,
			initCommand: src.initCommand,
			color: src.color,
		};
		this.openTab(tab);
		this.activateTab(tab.id);
		this.persist();
		this.app.workspace.requestSaveLayout();
	}

	/** 关闭除指定标签外的所有标签。 */
	private closeOthers(id: string): void {
		for (const t of this.tabs.slice()) {
			if (t.id !== id) this.destroyTab(t.id);
		}
		this.activeTabId = id;
		this.renderTabBar();
		this.persist();
	}

	/** 关闭全部标签。 */
	private closeAll(): void {
		for (const t of this.tabs.slice()) this.destroyTab(t.id);
		this.activeTabId = null;
		this.renderTabBar();
		this.syncEmpty();
		this.persist();
	}

	/** 把 fromId 标签移动到 toId 的位置（drop-on = 插到目标前） */
	private moveTab(fromId: string, toId: string): void {
		const from = this.tabs.findIndex((t) => t.id === fromId);
		const to = this.tabs.findIndex((t) => t.id === toId);
		if (from < 0 || to < 0 || from === to) return;
		const [moved] = this.tabs.splice(from, 1);
		this.tabs.splice(from < to ? to - 1 : to, 0, moved);
		this.renderTabBar();
		// 拖拽重排后持久化顺序
		this.persist();
	}

	/** 根据指针 X 坐标计算应插入到哪个 tab 之前（标签栏横排；返回该 tab 的 id；null=放到末尾）。
	 *  draggedId 用于跳过被拖元素自身，避免指示线/插入目标落在自己身上。 */
	private computeDropTarget(clientX: number, draggedId: string): string | null {
		if (!this.tabBarEl) return null;
		const els = Array.from(this.tabBarEl.querySelectorAll<HTMLElement>(".ft-tab"));
		for (const el of els) {
			if (el.dataset.tabId === draggedId) continue; // 跳过被拖元素本身
			const rect = el.getBoundingClientRect();
			const mid = rect.left + rect.width / 2;
			if (clientX < mid) return el.dataset.tabId ?? null;
		}
		return null; // 越过所有 tab 中心 → 末尾
	}

	/** 懒创建拖拽「插入位置指示线」（挂在 tabBar 内、绝对定位；renderTabBar 清空后会自动重建）。 */
	private ensureDropIndicator(): HTMLElement | null {
		if (!this.tabBarEl) return null;
		if (!this.dropIndicator || !this.dropIndicator.isConnected) {
			this.dropIndicator = this.tabBarEl.createDiv({ cls: "ft-drop-indicator" });
		}
		return this.dropIndicator;
	}

	/** 把指示线定位到 beforeId 标签的左侧（null=放到末尾，即 + 按钮左侧）。 */
	private positionDropIndicator(beforeId: string | null): void {
		const bar = this.tabBarEl;
		const ind = this.ensureDropIndicator();
		if (!bar || !ind) return;
		let x: number;
		if (beforeId) {
			const before = bar.querySelector<HTMLElement>(`.ft-tab[data-tab-id="${beforeId}"]`);
			if (!before) { ind.removeClass("is-visible"); return; }
			const barRect = bar.getBoundingClientRect();
			const r = before.getBoundingClientRect();
			x = r.left - barRect.left + bar.scrollLeft - 1;
		} else {
			const addBtn = bar.querySelector<HTMLElement>(".ft-tab-add");
			const barRect = bar.getBoundingClientRect();
			const r = addBtn?.getBoundingClientRect();
			x = r ? r.left - barRect.left + bar.scrollLeft - 1 : bar.clientWidth - 2;
		}
		ind.style.setProperty("--ft-drop-x", `${x}px`);
		ind.addClass("is-visible");
	}

	/** 隐藏插入位置指示线。 */
	private hideDropIndicator(): void {
		this.dropIndicator?.removeClass("is-visible");
	}

	private restartActive(): void {
		const tab = this.activeTab();
		if (tab) this.startSession(tab);
	}

	private effectiveSettings(tab: TerminalTab): FolderTerminalSettings {
		const g = this.getSettings();
		return {
			shell: tab.shell ?? g.shell,
			fontSize: tab.fontSize ?? g.fontSize,
			colorScheme: tab.colorScheme ?? g.colorScheme,
			reuseLeaf: g.reuseLeaf,
			language: g.language,
			initCommand: tab.initCommand ?? g.initCommand,
		};
	}

	// ---------- 内部：标签栏 DOM ----------

	/**
	 * 仅切换各标签的 is-active 样式类，不重建 tabBar DOM。
	 * 用于激活标签时（每次 click 都会走 activateTab），避免打碎 label 节点，
	 * 否则会破坏「双击重命名」等依赖同一 label 节点的交互（dblclick 要求两次点击目标节点一致）。
	 */
	private updateActiveClasses(): void {
		if (!this.tabBarEl) return;
		this.tabBarEl.querySelectorAll<HTMLElement>(".ft-tab").forEach((el) => {
			const tid = el.dataset.tabId;
			el.classList.toggle("is-active", !!tid && tid === this.activeTabId);
		});
	}

	private renderTabBar(): void {
		if (!this.tabBarEl) return;
		this.tabBarEl.empty();
		for (const tab of this.tabs) {
			this.tabBarEl.appendChild(this.createTabItem(tab));
		}
		// 尾部 + 按钮：在库根打开新终端（用户手动新增 tab 用，
		// 不依赖从 file explorer 的 folder icon 触发）
		const addBtn = this.tabBarEl.createEl("button", {
			cls: "ft-tab-add",
			attr: { type: "button", "aria-label": t("tab.newTerminalAria"), title: t("tab.newTerminalTitle") },
		});
		setIcon(addBtn, "plus");
		addBtn.addEventListener("click", (evt) => {
			evt.stopPropagation();
			this.addTab("");
		});

		// 「▾ 更多标签」溢出下拉：标签过多放不下时，把末尾标签收进此菜单
		const ovBtn = this.tabBarEl.createEl("button", {
			cls: "ft-overflow-btn",
			attr: { type: "button", "aria-label": t("tab.moreTabs"), title: t("tab.moreTabs") },
		});
		ovBtn.setText("▾");
		ovBtn.createSpan({ cls: "ft-overflow-count" });
		ovBtn.addEventListener("click", (evt) => {
			evt.stopPropagation();
			const menu = new Menu();
			const hidden = this.tabs.filter((t) => {
				const el = this.tabBarEl?.querySelector<HTMLElement>(
					`.ft-tab[data-tab-id="${t.id}"]`,
				);
				return el && el.hasClass("ft-hidden");
			});
			if (!hidden.length) return;
			for (const t of hidden) {
				menu.addItem((i) =>
					i.setTitle(tabLabel(t)).onClick(() => {
						this.activateTab(t.id);
						this.scheduleOverflow();
					}),
				);
			}
			menu.showAtMouseEvent(evt);
		});
		this.overflowBtn = ovBtn;

		this.scheduleOverflow();
	}

	private createTabItem(tab: TerminalTab): HTMLElement {
		const item = this.tabBarEl!.createDiv({
			cls: "ft-tab",
			attr: { title: tab.cwd || t("tab.overflowRoot") },
		});
		item.dataset.tabId = tab.id;
		item.classList.toggle("is-active", tab.id === this.activeTabId);

		// 色点：区分 dev / 测试 / 日志 等用途（背景色由内联 style 设置）
		if (tab.color) {
			const dot = item.createSpan({ cls: "ft-tab-dot" });
			dot.style.backgroundColor = tab.color;
		}

		item.createSpan({ cls: "ft-tab-label", text: tabLabel(tab) });

		const close = item.createEl("button", {
			cls: "ft-tab-close",
			attr: { type: "button", "aria-label": t("tab.closeSession"), title: t("tab.closeSession") },
		});
		setIcon(close, "x");
		close.addEventListener("click", (evt) => {
			evt.stopPropagation();
			this.closeTab(tab.id);
		});

		// 双击标签 = 重命名。Obsidian/Electron 在此环境下不派发 dblclick（被 workspace 层拦截），
		// 因此用「两次 click 计时」自实现双击检测，彻底绕开 dblclick 事件。
		let lastClickAt = 0;
		item.addEventListener("click", (evt) => {
			if ((evt.target as HTMLElement).closest(".ft-tab-close")) return;
			const now = Date.now();
			if (lastClickAt && now - lastClickAt < 350) {
				lastClickAt = 0;
				this.startRename(tab.id);
				return;
			}
			lastClickAt = now;
			this.activateTab(tab.id);
		});
		item.addEventListener("contextmenu", (evt) => {
			evt.preventDefault();
			evt.stopPropagation();
			this.showTabMenu(evt, tab);
		});

		// 拖拽排序：纯 Pointer Events 自实现（不依赖 HTML5 draggable，避免再次吞掉交互）。
		// 拖拽期间只显示「插入位置指示线」+ 被拖标签半透明，松手时一次性 moveTab，
		// 不实时挪动 DOM，避免标签在指针下乱跳、不跟手的糟糕体验。
		item.addEventListener("pointerdown", (e) => {
			if (e.button !== 0) return;
			// 点在关闭按钮等内部控件上时，不抢 pointer capture、不启动拖拽，
			// 否则浏览器会把随后的 click 重定向到 item 本身，导致关闭按钮的
			// click 永远收不到（表现为「点 X 没反应」）。
			if ((e.target as HTMLElement).closest(".ft-tab-close, .ft-tab-dot, .ft-tab-rename")) return;
			this.drag = { id: tab.id, pointerId: e.pointerId, startX: e.clientX, startY: e.clientY, moved: false, targetId: null };
			try { item.setPointerCapture(e.pointerId); } catch { /* 忽略 */ }
		});
		item.addEventListener("pointermove", (e) => {
			if (!this.drag || this.drag.id !== tab.id || e.pointerId !== this.drag.pointerId) return;
			if (!this.drag.moved) {
				const dist = Math.hypot(e.clientX - this.drag.startX, e.clientY - this.drag.startY);
				if (dist > 5) {
					this.drag.moved = true;
					item.classList.add("is-dragging");
				}
			}
			if (this.drag.moved) {
				const beforeId = this.computeDropTarget(e.clientX, tab.id);
				this.drag.targetId = beforeId;
				this.positionDropIndicator(beforeId);
			}
		});
		const endDrag = (e: PointerEvent): void => {
			if (!this.drag || this.drag.id !== tab.id || e.pointerId !== this.drag.pointerId) return;
			const wasMoved = this.drag.moved;
			const targetId = this.drag.targetId;
			this.drag = null;
			try { item.releasePointerCapture(e.pointerId); } catch { /* 忽略 */ }
			item.classList.remove("is-dragging");
			this.hideDropIndicator();
			if (wasMoved && targetId && targetId !== tab.id) {
				this.moveTab(tab.id, targetId);
			} else if (wasMoved) {
				this.renderTabBar();
			}
		};
		item.addEventListener("pointerup", endDrag);
		item.addEventListener("pointercancel", endDrag);

		return item;
	}

	private showTabMenu(evt: MouseEvent, tab: TerminalTab): void {
		const menu = new Menu();
		menu.addItem((i) =>
			i.setTitle(t("menu.renameTab")).setIcon("pencil").onClick(() => this.startRename(tab.id)),
		);
		menu.addItem((i) =>
			i.setTitle(t("menu.tabSettings")).setIcon("settings").onClick(() => this.openTabSettings(tab.id)),
		);
		menu.addItem((i) =>
			i.setTitle(t("menu.restartSession")).setIcon("refresh-cw").onClick(() => this.startSession(tab)),
		);
		menu.addItem((i) =>
			i.setTitle(t("menu.duplicateTab")).setIcon("copy").onClick(() => this.duplicateTab(tab.id)),
		);
		menu.addSeparator();
		// 三个「关闭…」放一块：主操作「关闭标签」在最上、避免误伤；
		// 「关闭其他 / 全部」为多次点选高风险操作放在最下，使用不同 icon 提示。
		menu.addItem((i) => i.setTitle(t("menu.closeTab")).setIcon("x").onClick(() => this.closeTab(tab.id)));
		menu.addItem((i) =>
			i.setTitle(t("menu.closeOtherTabs")).setIcon("x-circle").onClick(() => this.closeOthers(tab.id)),
		);
		menu.addItem((i) =>
			i.setTitle(t("menu.closeAllTabs")).setIcon("x-square").onClick(() => this.closeAll()),
		);
		menu.showAtMouseEvent(evt);
	}

	/** 终端区域右键菜单：复制选中 / 粘贴 / 清屏。 */
	private showTerminalMenu(evt: MouseEvent): void {
		const term = this.terminals.get(this.activeTabId ?? "");
		const session = this.sessions.get(this.activeTabId ?? "");
		const menu = new Menu();
		menu.addItem((i) =>
			i.setTitle(t("term.copy")).setIcon("copy").onClick(() => {
				const sel = term?.getSelection();
				if (sel) navigator.clipboard.writeText(sel).catch(() => {});
			}),
		);
		menu.addItem((i) =>
			i.setTitle(t("term.paste")).setIcon("clipboard").onClick(() => {
				if (!session) return;
				navigator.clipboard
					.readText()
					.then((text) => {
						try {
							session.write(text);
						} catch {
							/* 会话已关闭 */
						}
					})
					.catch(() => {});
			}),
		);
		menu.addSeparator();
		menu.addItem((i) => i.setTitle(t("term.clear")).setIcon("eraser").onClick(() => term?.clear()));
		menu.showAtMouseEvent(evt);
	}

	/**
	 * 快捷键（在 capture 阶段拦截，先于 xterm 拿到事件，避免被终端吞掉）：
	 * - Cmd/Ctrl+T：在「当前激活标签所在目录」新开一个标签
	 * - Cmd/Ctrl+W：关闭当前标签（并阻止 Obsidian 默认的关闭整个面板）
	 * - Ctrl+Tab / Ctrl+Shift+Tab：在标签间循环切换
	 * - Cmd/Ctrl+1..9：跳到第 N 个标签
	 * 正在重命名（焦点在 .ft-tab-rename 输入框）时全部放行，交给输入框自身处理。
	 */
	private onKeyDown(evt: KeyboardEvent): void {
		const target = evt.target as HTMLElement | null;
		if (target?.classList?.contains("ft-tab-rename")) return;

		const mod = evt.metaKey || evt.ctrlKey;
		if (mod && evt.key.toLowerCase() === "t") {
			evt.preventDefault();
			evt.stopPropagation();
			this.addTab(this.activeTab()?.cwd ?? "");
			return;
		}
		if (mod && evt.key.toLowerCase() === "w") {
			evt.preventDefault();
			evt.stopPropagation();
			if (this.activeTabId) this.closeTab(this.activeTabId);
			return;
		}
		if (evt.key === "Tab" && evt.ctrlKey && !evt.metaKey) {
			evt.preventDefault();
			evt.stopPropagation();
			this.cycleTab(evt.shiftKey ? -1 : 1);
			return;
		}
		if (mod && /^[1-9]$/.test(evt.key)) {
			evt.preventDefault();
			evt.stopPropagation();
			const t = this.tabs[parseInt(evt.key, 10) - 1];
			if (t) this.activateTab(t.id);
		}
	}

	/** 在标签间循环切换（dir=1 下一个，-1 上一个，带环绕）。 */
	private cycleTab(dir: number): void {
		if (!this.tabs.length) return;
		const idx = this.tabs.findIndex((t) => t.id === this.activeTabId);
		const next = (idx + dir + this.tabs.length) % this.tabs.length;
		this.activateTab(this.tabs[next].id);
	}

	/** 标签溢出时重算：把放不下的末尾标签隐藏，收进「▾」下拉。延迟到下一帧以拿到真实宽度。 */
	private scheduleOverflow(): void {
		requestAnimationFrame(() => this.layoutOverflow());
		setTimeout(() => this.layoutOverflow(), 60);
	}

	/** 根据标签栏可用宽度，隐藏放不下的末尾标签（始终保留激活标签可见），并更新「▾」徽标。 */
	private layoutOverflow(): void {
		const bar = this.tabBarEl;
		const ovBtn = this.overflowBtn;
		if (!bar) {
			ovBtn?.addClass("ft-hidden");
			return;
		}
		const tabs = Array.from(bar.querySelectorAll<HTMLElement>(".ft-tab"));
		if (!tabs.length) {
			ovBtn?.addClass("ft-hidden");
			return;
		}
		// 先全部显示再测量真实宽度
		tabs.forEach((t) => t.removeClass("ft-hidden"));
		ovBtn?.removeClass("ft-hidden");
		const addBtn = bar.querySelector<HTMLElement>(".ft-tab-add");
		const addW = addBtn ? addBtn.offsetWidth + 6 : 0;
		const ovW = ovBtn ? ovBtn.offsetWidth + 6 : 0;
		const avail = bar.clientWidth - addW - ovW - 12;
		const widths = new Map<string, number>();
		let total = 0;
		for (const t of tabs) {
			const w = t.getBoundingClientRect().width + 2; // +gap
			widths.set(t.dataset.tabId!, w);
			total += w;
		}
		if (total <= avail) {
			ovBtn?.addClass("ft-hidden");
			return;
		}
		// 从右往左隐藏，但激活标签始终保留可见
		let i = tabs.length - 1;
		const activeId = this.activeTabId;
		while (total > avail && i >= 0) {
			const t = tabs[i];
			const id = t.dataset.tabId!;
			if (id === activeId) {
				i--;
				continue;
			}
			t.addClass("ft-hidden");
			total -= widths.get(id)!;
			i--;
		}
		if (ovBtn) {
			const badge = ovBtn.querySelector<HTMLElement>(".ft-overflow-count");
			if (badge) {
				const hidden = tabs.filter((t) => t.hasClass("ft-hidden")).length;
				badge.textContent = String(hidden);
			}
		}
	}

	private openTabSettings(id: string): void {
		const tab = this.tabs.find((t) => t.id === id);
		if (!tab) return;
		new TabSettingsModal(
			this.app,
			tabLabel(tab),
			{ shell: tab.shell, colorScheme: tab.colorScheme, fontSize: tab.fontSize, initCommand: tab.initCommand, color: tab.color },
			this.getSettings(),
			(overrides) => {
			// 仅当影响运行时的设置（shell/配色/字号）变化时才重建会话，
			// 改颜色/启动命令不应打断正在跑的 shell。
			const needRecreate =
				tab.shell !== overrides.shell ||
				tab.colorScheme !== overrides.colorScheme ||
				tab.fontSize !== overrides.fontSize;
			tab.shell = overrides.shell;
			tab.colorScheme = overrides.colorScheme;
			tab.fontSize = overrides.fontSize;
			tab.initCommand = overrides.initCommand;
			tab.color = overrides.color;
			if (needRecreate) this.recreateTabRuntime(tab);
			this.renderTabBar();
			// 加固：立即把标签自定义设置写回 data.json（不依赖 workspace 保存时机），
			// 即使紧接着 "Reload app without saving" 也能保留本次标签自定义设置。
			this.rememberPath(tab);
			this.persist();
			this.app.workspace.requestSaveLayout();
		},
		).open();
	}

	private startRename(id: string): void {
		const tab = this.tabs.find((t) => t.id === id);
		const labelEl = this.tabBarEl?.querySelector<HTMLElement>(
			`.ft-tab[data-tab-id="${id}"] .ft-tab-label`,
		);
		if (!tab || !labelEl) return;

		// 双击触发点来自「两次 click 计时」，第二次 click 的事件流（mousedown/up/click）
		// 尚未结束。若此刻同步创建并聚焦输入框，紧随其后的鼠标事件会把焦点从新 input
		// 抢走并立即触发 blur → commit → 重建 → 输入框一闪即逝。
		// 延迟到下一帧再创建并聚焦，确保没有任何进行中的事件抢焦点，输入框才能稳定停留。
		requestAnimationFrame(() => {
			const tab2 = this.tabs.find((t) => t.id === id);
			const labelEl2 = this.tabBarEl?.querySelector<HTMLElement>(
				`.ft-tab[data-tab-id="${id}"] .ft-tab-label`,
			);
			if (!tab2 || !labelEl2) return;

			labelEl2.empty();
			const input = labelEl2.createEl("input", {
				cls: "ft-tab-rename",
				attr: { type: "text" },
			});
			input.value = tabLabel(tab2);
			input.focus();
			input.select();

			let done = false;
			const commit = (save: boolean): void => {
				if (done) return;
				done = true;
				const value = input.value.trim();
				tab2.label = save && value ? value : undefined;
				this.renderTabBar();
				if (save) {
					// 加固：重命名后立即写盘（data.json + workspace），避免 "Reload app without saving" 丢失该标签的 label。
					this.rememberPath(tab2);
					this.persist();
					this.app.workspace.requestSaveLayout();
				}
			};
			input.addEventListener("keydown", (evt) => {
				evt.stopPropagation();
				if (evt.key === "Enter") commit(true);
				else if (evt.key === "Escape") commit(false);
			});
			input.addEventListener("blur", () => commit(true));
		});
	}

	// ---------- 内部：尺寸 / 空状态 / 样式 ----------

	private fitActive(): void {
		if (!this.activeTabId || !this.containerEl.isConnected) return;
		const terminal = this.terminals.get(this.activeTabId);
		const fitAddon = this.fitAddons.get(this.activeTabId);
		const session = this.sessions.get(this.activeTabId);
		if (!terminal || !fitAddon) return;
		try {
			fitAddon.fit();
			session?.resize(terminal.rows, terminal.cols);
			// 关键：fit 后立即滚到底部，确保最后一行（光标）在可视区，
			// 否则 fitAddon rows 算多 1 行时，光标会出现在可视区外被状态栏遮住
			terminal.scrollToBottom();
		} catch {
			// 面板尚未渲染 / 尺寸为 0，忽略
		}
	}

	/** 无标签时显示占位提示 */
	private syncEmpty(): void {
		const show = this.tabs.length === 0;
		if (show && !this.emptyEl && this.hostEl) {
			this.emptyEl = this.hostEl.createDiv({ cls: "ft-empty" });
			this.emptyEl.createSpan({ text: t("empty.hint") });
			const btn = this.emptyEl.createEl("button", {
				cls: "ft-empty-btn",
				text: t("empty.openRoot"),
			});
			btn.addEventListener("click", () => this.addTab(""));
		}
		if (this.emptyEl) this.emptyEl.hidden = !show;
	}

	/**
	 * 界面语言切换后，重渲染受语言影响的动态文案（标签栏标题/按钮、空状态提示）。
	 * 由设置面板在 language 改变时调用；菜单类文案每次打开都实时取词，无需处理。
	 */
	onLocaleChanged(): void {
		if (this.emptyEl) {
			this.emptyEl.remove();
			this.emptyEl = null;
		}
		this.syncEmpty();
		this.renderTabBar();
	}

	// xterm.js 自带样式已合并到全局 styles.css（见 esbuild build 与 styles.css 末尾），
	// Obsidian 评审禁止插件运行时 document.createElement('style') + appendChild('head')。

	/**
	 * 探测 Obsidian 状态栏真实高度，写入 CSS 变量 `--status-bar-height`，
	 * 让 `.ft-terminal-view.view-content` 的 padding-bottom 让出准确空间，
	 * 避免终端最后一行被状态栏遮住。
	 *
	 * Obsidian 状态栏是 position: fixed overlay（不在文档流），
	 * view-content 的 `height: 100%` 实际等于全窗口高度，
	 * 因此需要从视图底部"挖出"状态栏高度。
	 */
	private applyStatusBarHeight(): void {
		const detect = (): number => {
			// 直接读 .status-bar 自己的高度（offsetHeight 含 padding / box-sizing: border-box 时 = 真实占用）
			const bar = document.querySelector<HTMLElement>(".status-bar");
			if (bar) {
				const h = Math.max(bar.offsetHeight, bar.getBoundingClientRect().height);
				if (h > 0 && h < 100) return h;
			}
			return 31; // Obsidian 默认状态栏 ~31px（含 padding + 图标行高）
		};

		const write = (): number => {
			const h = detect();
			document.documentElement.style.setProperty("--status-bar-height", `${h}px`);
			return h;
		};

		write();
		this.registerEvent(this.app.workspace.on("resize", () => {
			write();
			this.fitActive();
		}));
		this.registerEvent(this.app.workspace.on("layout-change", () => {
			write();
			this.fitActive();
		}));
		// 状态栏可能在 view 渲染后才完全加载，延迟再探测两次
		setTimeout(write, 200);
		setTimeout(write, 1000);
	}
}

function tabLabel(tab: TerminalTab): string {
	if (tab.label) return tab.label;
	const parts = tab.cwd.split("/").filter(Boolean);
	return parts.length ? parts[parts.length - 1] : t("tab.root");
}

/** 拼接库根路径与相对路径（处理尾部/首部斜杠） */
function resolveCwd(base: string, rel: string): string {
	if (base) {
		return rel ? joinPath(base, rel) : base;
	}
	return rel || process.env.HOME || "/";
}

function joinPath(base: string, rel: string): string {
	const sep = isWindows() ? "\\" : "/";
	return `${base.replace(/[\\/]+$/, "")}${sep}${rel.replace(/^[\\/]+/, "")}`;
}

function isWindows(): boolean {
	return process.platform === "win32";
}

function uid(): string {
	return Math.random().toString(36).slice(2, 10);
}

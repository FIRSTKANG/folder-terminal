/**
 * 设置面板（imperative 路径，绕开 Obsidian 1.13.x 声明式渲染管线在社区插件上下文只渲染首项的回归 bug）。
 *
 * 历史：曾迁到 `getSettingDefinitions()` 声明式 API（d.ts:6584），但实测在当前 Obsidian 1.13+
 * 版本下渲染管线对 6 项设置只渲染首项（已加 DIAG 日志两次确认 6 项均已返回）。暂退回 imperative
 * display() 路径作为最稳解；待 Obsidian 渲染管线 bug 修复后再切回声明式（届时 bot 报告
 * "does not implement getSettingDefinitions" 和 "display is deprecated" 两条非阻断 warning
 * 会自然消失）。
 *
 * 不变量：
 * - `display()` 每次重渲都从最新 `plugin.settings.X` 取值；控件当前值 100% 由 `setValue(this.plugin.settings.X)` 绑定。
 * - 切语言：syncSettings → setLocale → await saveSettings → this.display()（强制整 tab 重建）。
 * - 改字号：syncSettings → 持久化 → this.display()（让副标题 "current Xpx" 占位符跟随）。
 */
import { App, PluginSettingTab, Setting, getLanguage } from "obsidian";
import type FolderTerminalPlugin from "./main";
import type { TerminalTab } from "./terminalView";
import { t, setLocale, resolveLocale, type LanguageSetting } from "./i18n";

/**
 * 未自定义颜色时，取色器的默认展示色取当前主题的图标色（--icon-color），
 * 让取色器与「跟随主题」保持一致，而不是硬编码一个突兀的默认值。
 * 主题色可能是 rgb() 或 #hex，统一转成 input[type=color] 需要的 #rrggbb；解析失败回退中性灰。
 */
function themeIconColorFallback(): string {
	try {
		const css = getComputedStyle(document.documentElement).getPropertyValue("--icon-color").trim();
		const rgb = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/.exec(css);
		if (rgb) {
			const toHex = (n: number) => n.toString(16).padStart(2, "0");
			return `#${toHex(+rgb[1])}${toHex(+rgb[2])}${toHex(+rgb[3])}`;
		}
		if (/^#[0-9a-fA-F]{6}$/.test(css)) return css.toLowerCase();
	} catch (err) {
		console.warn("[Folder Terminal] 读取主题图标色失败:", err);
	}
	return "#8a8a8a";
}

/** 单个文件夹路径记忆的标签自定义设置（关掉再重开同一文件夹也能恢复） */
export interface PathTabOverrides {
	label?: string;
	shell?: string;
	colorScheme?: FolderTerminalSettings["colorScheme"];
	fontSize?: number;
	initCommand?: string;
	/** 标签左侧色点（区分 dev/测试/日志 等用途），十六进制色值；留空 = 无色标 */
	color?: string;
}

export interface FolderTerminalSettings {
	/** 默认 shell；留空 = 使用 $SHELL（macOS 默认 /bin/zsh） */
	shell: string;
	/** 终端字号 */
	fontSize: number;
	/** 配色：跟随 Obsidian 主题 / 强制深色 / 强制浅色 */
	colorScheme: "system" | "dark" | "light";
	/** 重复点击文件夹图标时复用底部面板，而非无限新开 */
	reuseLeaf: boolean;
	/** 界面语言；影响命令面板、设置项、弹窗、菜单、空状态等所有文案；"system" = 跟随 Obsidian 界面语言 */
	language: LanguageSetting;
	/** 新建终端标签时自动执行的启动命令；留空 = 不执行 */
	initCommand?: string;
	/**
	 * 每个终端标签的持久化快照（含自定义设置：shell/配色/字号/启动命令/重命名/目录）。
	 * 与 workspace.json 解耦——即便 "Reload app without saving" 不写工作区布局，
	 * 这里仍能通过插件 saveSettings() 立即落盘，保证标签自定义设置不丢。
	 */
	savedTabs?: TerminalTab[];
	/** 当前激活标签 id 的持久化快照 */
	savedActiveTab?: string | null;
	/**
	 * 按文件夹路径（cwd）长期缓存的标签自定义设置。
	 * 与 savedTabs 互补：savedTabs 只存「当前还开着的标签」，关掉就没了；
	 * 这里按 cwd 长期保留，关掉再重开同一文件夹也能恢复上次设置。
	 * 键为相对库根的路径（空字符串 = 库根）。
	 * 自动迁移：当文件夹在库内被改名 / 移动（vault rename 事件），main.ts 会把
	 * 以旧路径为前缀的 key 整体重映射到新路径，记忆不会因路径调整而丢失。
	 */
	tabSettingsByPath?: Record<string, PathTabOverrides>;
	/** 文件树图标颜色（十六进制）；同时作用于「终端」与「复制」图标组；留空 = 跟随主题 */
	terminalIconColor?: string;
}

export const DEFAULT_SETTINGS: FolderTerminalSettings = {
	shell: "",
	fontSize: 13,
	colorScheme: "system",
	reuseLeaf: true,
	language: "system",
	initCommand: "",
	savedTabs: [],
	savedActiveTab: null,
	tabSettingsByPath: {},
};

export class FolderTerminalSettingTab extends PluginSettingTab {
	constructor(app: App, private plugin: FolderTerminalPlugin) {
		super(app, plugin);
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		// ── 1) 界面语言 ──────────────────────────────────────────────────────
		new Setting(containerEl)
			.setName(t("settings.language.name"))
			.setDesc(t("settings.language.desc"))
			.addDropdown((cb) =>
				cb
					.addOption("system", t("settings.language.system"))
					.addOption("zh-CN", t("settings.language.zh"))
					.addOption("en", t("settings.language.en"))
					.setValue(this.plugin.settings.language)
					.onChange(async (v) => {
						const next = v as LanguageSetting;
						this.plugin.settings.language = next;
						await this.plugin.saveSettings();
						setLocale(resolveLocale(next, getLanguage()));
						// 强制整 tab 用新 locale 重建：所有 label/desc/控件值同步刷新
						this.display();
						for (const leaf of this.plugin.app.workspace.getLeavesOfType(
							"folder-terminal-view",
						)) {
							const vw = leaf.view as unknown as {
								onLocaleChanged?: () => void;
							};
							vw.onLocaleChanged?.();
						}
					}),
			);

		// ── 2) 默认 Shell ────────────────────────────────────────────────────
		new Setting(containerEl)
			.setName(t("settings.shell.name"))
			.setDesc(t("settings.shell.desc"))
			.addText((cb) =>
				cb
					.setPlaceholder("/bin/zsh")
					.setValue(this.plugin.settings.shell)
					.onChange(async (v) => {
						this.plugin.settings.shell = v.trim();
						await this.plugin.saveSettings();
					}),
			);

		// ── 3) 字号 ──────────────────────────────────────────────────────────
		new Setting(containerEl)
			.setName(t("settings.fontSize.name"))
			.setDesc(t("settings.fontSize.desc", { size: this.plugin.settings.fontSize }))
			.addSlider((cb) =>
				cb
					.setLimits(10, 22, 1)
					.setValue(this.plugin.settings.fontSize)
					.setDynamicTooltip()
					.onChange(async (v) => {
						this.plugin.settings.fontSize = v;
						await this.plugin.saveSettings();
						// 副标题里 "current Xpx" 需要跟随 — 重建整 tab
						this.display();
					}),
			);

		// ── 4) 配色方案 ──────────────────────────────────────────────────────
		new Setting(containerEl)
			.setName(t("settings.colorScheme.name"))
			.setDesc(t("settings.colorScheme.desc"))
			.addDropdown((cb) =>
				cb
					.addOption("system", t("settings.colorScheme.system"))
					.addOption("dark", t("settings.colorScheme.dark"))
					.addOption("light", t("settings.colorScheme.light"))
					.setValue(this.plugin.settings.colorScheme)
					.onChange(async (v) => {
						this.plugin.settings.colorScheme = v as FolderTerminalSettings["colorScheme"];
						await this.plugin.saveSettings();
					}),
			);

		// ── 5) 复用终端面板 ──────────────────────────────────────────────────
		new Setting(containerEl)
			.setName(t("settings.reuseLeaf.name"))
			.setDesc(t("settings.reuseLeaf.desc"))
			.addToggle((cb) =>
				cb
					.setValue(this.plugin.settings.reuseLeaf)
					.onChange(async (v) => {
						this.plugin.settings.reuseLeaf = v;
						await this.plugin.saveSettings();
					}),
			);

		// ── 6) 默认启动命令 ──────────────────────────────────────────────────
		new Setting(containerEl)
				.setName(t("settings.initCommand.name"))
				.setDesc(t("settings.initCommand.desc"))
				.addText((cb) =>
					cb
						.setPlaceholder(t("settings.initCommand.placeholder"))
						.setValue(this.plugin.settings.initCommand ?? "")
						.onChange(async (v) => {
							this.plugin.settings.initCommand = v.trim();
							await this.plugin.saveSettings();
						}),
				);

			// ── 7) 文件树图标颜色 ─────────────────────────────────────────────
			new Setting(containerEl)
				.setName(t("settings.iconColor.name"))
				.setDesc(t("settings.iconColor.desc"))
				.addColorPicker((cb) =>
					cb
						.setValue(this.plugin.settings.terminalIconColor ?? themeIconColorFallback())
						.onChange(async (v) => {
							// 用户主动取色 → 视为自定义颜色即时生效
							this.plugin.settings.terminalIconColor = v;
							await this.plugin.saveSettings();
							this.plugin.setTerminalIconColor(v);
						}),
				)
				.addExtraButton((btn) =>
					btn
						.setIcon("reset")
						.setTooltip(t("settings.iconColor.reset"))
						.onClick(async () => {
							this.plugin.settings.terminalIconColor = undefined;
							await this.plugin.saveSettings();
							this.plugin.setTerminalIconColor("");
							// 重建整 tab 让取色器回退到默认色
							this.display();
						}),
				);
	}
}

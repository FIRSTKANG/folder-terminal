import {
	App,
	PluginSettingTab,
	Setting,
	getLanguage,
} from "obsidian";
import type FolderTerminalPlugin from "./main";
import type { TerminalTab } from "./terminalView";
import { t, setLocale, resolveLocale, type LanguageSetting } from "./i18n";

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

/**
 * 设置面板。
 *
 * 设计决策：用 **imperative display()** 路径（每项用 `new Setting()` 显式构建，
 * 控件当前值显式 `.setValue(this.plugin.settings.X)`）。
 *
 * 为什么不走 Obsidian 1.13+ 的声明式 `getSettingDefinitions()`：
 * 1. 切语言场景下需要销毁整 tab 并用新 locale 重新求值每个 setting 的 name/desc；
 *    `update()` 不会重建已缓存的 setting 实例 label。
 * 2. `display()` 重建时，声明式 API 内部**不会**把 `plugin.settings` 的最新值
 *    重新绑回每个控件——dropdown 的当前值停留在旧 state，导致"切到中文后控件
 *    还显示 English"这种状态错位。
 * 退回 imperative 路径后，每个控件当前值都是显式 `.setValue(settings.X)`，
 * 切语言只需调 `this.display()` 即可同时刷新 5 个 setting 的 label + 控件当前值。
 *
 * bot 报告相关：
 * - "display is deprecated"：🔵 Recommendation 级别，不阻断 Publish。
 * - "does not implement getSettingDefinitions"：🟠 Warning 级别，不阻断 Publish。
 * - 失去的能力：Obsidian 设置搜索（在设置面板顶部搜索「界面语言」「Default shell」等）
 *   不会再匹配到本插件的设置项。如未来官方 API 修复上述两个问题，可再迁回声明式。
 */
export class FolderTerminalSettingTab extends PluginSettingTab {
	constructor(app: App, private plugin: FolderTerminalPlugin) {
		super(app, plugin);
	}

	override display(): void {
		const { containerEl } = this;
		containerEl.empty();

		// ---------- 界面语言 ----------
		new Setting(containerEl)
			.setName(t("settings.language.name"))
			.setDesc(t("settings.language.desc"))
			.addDropdown((dd) =>
				dd
					.addOption("system", t("settings.language.system"))
					.addOption("zh-CN", t("settings.language.zh"))
					.addOption("en", t("settings.language.en"))
					.setValue(this.plugin.settings.language)
					.onChange(async (v) => {
						const next = v as LanguageSetting;
						this.plugin.settings.language = next;
						await this.plugin.saveSettings();
						setLocale(resolveLocale(next, getLanguage()));
						// 切语言后整 tab 用新 locale + 最新 settings 重建：
						// 所有 5 个 setting 的 name/desc + 控件当前值都会被重渲
						this.display();
						for (const leaf of this.plugin.app.workspace.getLeavesOfType(
							"folder-terminal-view",
						)) {
							const vw = leaf.view as unknown as { onLocaleChanged?: () => void };
							vw.onLocaleChanged?.();
						}
					}),
			);

		// ---------- 默认 Shell ----------
		new Setting(containerEl)
			.setName(t("settings.shell.name"))
			.setDesc(t("settings.shell.desc"))
			.addText((text) =>
				text
					.setPlaceholder("/bin/zsh")
					.setValue(this.plugin.settings.shell)
					.onChange(async (v) => {
						this.plugin.settings.shell = v.trim();
						await this.plugin.saveSettings();
					}),
			);

		// ---------- 字号 ----------
		new Setting(containerEl)
			.setName(t("settings.fontSize.name"))
			.setDesc(t("settings.fontSize.desc", { size: this.plugin.settings.fontSize }))
			.addSlider((slider) =>
				slider
					.setLimits(10, 22, 1)
					.setValue(this.plugin.settings.fontSize)
					.setDynamicTooltip()
					.onChange(async (v) => {
						this.plugin.settings.fontSize = v;
						await this.plugin.saveSettings();
						// 让副标题里的 "current Xpx" 立即更新
						this.display();
					}),
			);

		// ---------- 配色方案 ----------
		new Setting(containerEl)
			.setName(t("settings.colorScheme.name"))
			.setDesc(t("settings.colorScheme.desc"))
			.addDropdown((dd) =>
				dd
					.addOption("system", t("settings.colorScheme.system"))
					.addOption("dark", t("settings.colorScheme.dark"))
					.addOption("light", t("settings.colorScheme.light"))
					.setValue(this.plugin.settings.colorScheme)
					.onChange(async (v) => {
						this.plugin.settings.colorScheme = v as FolderTerminalSettings["colorScheme"];
						await this.plugin.saveSettings();
					}),
			);

		// ---------- 复用终端面板 ----------
		new Setting(containerEl)
			.setName(t("settings.reuseLeaf.name"))
			.setDesc(t("settings.reuseLeaf.desc"))
			.addToggle((tg) =>
				tg
					.setValue(this.plugin.settings.reuseLeaf)
					.onChange(async (v) => {
						this.plugin.settings.reuseLeaf = v;
						await this.plugin.saveSettings();
					}),
			);

		// ---------- 默认启动命令 ----------
		new Setting(containerEl)
			.setName(t("settings.initCommand.name"))
			.setDesc(t("settings.initCommand.desc"))
			.addText((text) =>
				text
					.setPlaceholder(t("settings.initCommand.placeholder"))
					.setValue(this.plugin.settings.initCommand ?? "")
					.onChange(async (v) => {
						this.plugin.settings.initCommand = v.trim();
						await this.plugin.saveSettings();
					}),
			);
	}
}

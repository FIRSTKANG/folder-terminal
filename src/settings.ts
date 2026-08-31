import { App, PluginSettingTab, Setting, getLanguage } from "obsidian";
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

export class FolderTerminalSettingTab extends PluginSettingTab {
	constructor(app: App, private plugin: FolderTerminalPlugin) {
		super(app, plugin);
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		new Setting(containerEl)
			.setName(t("settings.language.name"))
			.setDesc(t("settings.language.desc"))
			.addDropdown((dropdown) =>
				dropdown
					.addOption("system", t("settings.language.system"))
					.addOption("zh-CN", t("settings.language.zh"))
					.addOption("en", t("settings.language.en"))
					.setValue(this.plugin.settings.language)
					.onChange(async (value: LanguageSetting) => {
						this.plugin.settings.language = value;
						await this.plugin.saveSettings();
						setLocale(resolveLocale(value, getLanguage()));
						// 实时刷新：重渲染设置面板 + 通知已打开的终端视图
						this.display();
						for (const leaf of this.plugin.app.workspace.getLeavesOfType(
							"folder-terminal-view",
						)) {
							const v = leaf.view as unknown as { onLocaleChanged?: () => void };
							v.onLocaleChanged?.();
						}
					}),
			);

		new Setting(containerEl)
			.setName(t("settings.shell.name"))
			.setDesc(t("settings.shell.desc"))
			.addText((text) =>
				text
					.setPlaceholder("/bin/zsh")
					.setValue(this.plugin.settings.shell)
					.onChange(async (value) => {
						this.plugin.settings.shell = value.trim();
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName(t("settings.fontSize.name"))
			.setDesc(t("settings.fontSize.desc", { size: this.plugin.settings.fontSize }))
			.addSlider((slider) =>
				slider
					.setLimits(10, 22, 1)
					.setValue(this.plugin.settings.fontSize)
					.onChange(async (value) => {
						this.plugin.settings.fontSize = value;
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName(t("settings.colorScheme.name"))
			.setDesc(t("settings.colorScheme.desc"))
			.addDropdown((dropdown) =>
				dropdown
					.addOption("system", t("settings.colorScheme.system"))
					.addOption("dark", t("settings.colorScheme.dark"))
					.addOption("light", t("settings.colorScheme.light"))
					.setValue(this.plugin.settings.colorScheme)
					.onChange(async (value: FolderTerminalSettings["colorScheme"]) => {
						this.plugin.settings.colorScheme = value;
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName(t("settings.reuseLeaf.name"))
			.setDesc(t("settings.reuseLeaf.desc"))
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.reuseLeaf)
					.onChange(async (value) => {
						this.plugin.settings.reuseLeaf = value;
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName(t("settings.initCommand.name"))
			.setDesc(t("settings.initCommand.desc"))
			.addText((text) =>
				text
					.setPlaceholder(t("settings.initCommand.placeholder"))
					.setValue(this.plugin.settings.initCommand ?? "")
					.onChange(async (value) => {
						this.plugin.settings.initCommand = value.trim();
						await this.plugin.saveSettings();
					}),
			);
	}
}

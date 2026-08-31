import {
	App,
	PluginSettingTab,
	getLanguage,
	type SettingDefinitionItem,
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
 * 设置面板（Obsidian 1.13+ declarative settings API）。
 *
 * - 正常路径不再重写 `display()` —— 框架读取 `getSettingDefinitions()` 自动渲染。
 * - 持久化走 `PluginSettingTab` 默认 `setControlValue` 钩子（写 `this.plugin.settings`
 *   并 `await this.plugin.saveData()`）。
 * - 仅对「需要后置副作用」的键（language / shell / initCommand）重写
 *   `setControlValue`：
 *   · language: 切语言时 setLocale + display() 重建整 tab（1.13.0 update() 不充分，
 *     已在源码注释中说明） + 通知已打开的 leaf
 *   · shell / initCommand: 入参需 trim（避免首尾空格）
 *   · 其它键一律委托默认实现
 */
export class FolderTerminalSettingTab extends PluginSettingTab {
	constructor(app: App, private plugin: FolderTerminalPlugin) {
		super(app, plugin);
	}

	override getSettingDefinitions(): SettingDefinitionItem[] {
		return [
			{
				name: t("settings.language.name"),
				desc: t("settings.language.desc"),
				control: {
					type: "dropdown",
					key: "language",
					options: {
						system: t("settings.language.system"),
						"zh-CN": t("settings.language.zh"),
						en: t("settings.language.en"),
					},
				},
			},
			{
				name: t("settings.shell.name"),
				desc: t("settings.shell.desc"),
				control: {
					type: "text",
					key: "shell",
					placeholder: "/bin/zsh",
				},
			},
			{
				name: t("settings.fontSize.name"),
				desc: t("settings.fontSize.desc", { size: this.plugin.settings.fontSize }),
				control: {
					type: "slider",
					key: "fontSize",
					min: 10,
					max: 22,
					step: 1,
				},
			},
			{
				name: t("settings.colorScheme.name"),
				desc: t("settings.colorScheme.desc"),
				control: {
					type: "dropdown",
					key: "colorScheme",
					options: {
						system: t("settings.colorScheme.system"),
						dark: t("settings.colorScheme.dark"),
						light: t("settings.colorScheme.light"),
					},
				},
			},
			{
				name: t("settings.reuseLeaf.name"),
				desc: t("settings.reuseLeaf.desc"),
				control: {
					type: "toggle",
					key: "reuseLeaf",
				},
			},
			{
				name: t("settings.initCommand.name"),
				desc: t("settings.initCommand.desc"),
				control: {
					type: "text",
					key: "initCommand",
					placeholder: t("settings.initCommand.placeholder"),
				},
			},
		];
	}

	/**
	 * 后置副作用钩子：
	 * - language: 改完要 setLocale + display() 重建整 tab（让所有 setting 的 name/desc
	 *   用新 locale 重新求值；1.13.0 的 update() 只刷控件不重渲已缓存的 label，因此
	 *   在切语言场景下必须退回 display() 才能让全部 5 项标签/副标题同步刷新）。
	 *   display() 在 1.13.0 是 deprecated，但仅用于这一处兜底，正常路径仍走
	 *   声明式 API（bot 仅 Recommendation 级别，不阻断 Publish）。
	 *   之后通知已打开的 leaf 触发 onLocaleChanged 重渲终端内部文案。
	 * - shell / initCommand: 入参需 trim（避免首尾空格）
	 * - 其余键直接走默认实现
	 */
	override async setControlValue(key: string, value: unknown): Promise<void> {
		switch (key) {
			case "language": {
				const v = value as LanguageSetting;
				this.plugin.settings.language = v;
				await this.plugin.saveSettings();
				setLocale(resolveLocale(v, getLanguage()));
				// display() 触发整 tab 销毁重建：5 个 setting 的 name/desc 重新走 t() 取词
				this.display();
				for (const leaf of this.plugin.app.workspace.getLeavesOfType(
					"folder-terminal-view",
				)) {
					const vw = leaf.view as unknown as { onLocaleChanged?: () => void };
					vw.onLocaleChanged?.();
				}
				return;
			}
			case "shell":
				this.plugin.settings.shell = String(value).trim();
				await this.plugin.saveSettings();
				return;
			case "initCommand":
				this.plugin.settings.initCommand = String(value).trim();
				await this.plugin.saveSettings();
				return;
			default:
				await super.setControlValue(key, value);
		}
	}
}

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
 * 设置面板（Obsidian 1.13+ 声明式 settings API）。
 *
 * 设计要点：
 * - `getSettingDefinitions()` 在每次 `update()` / 打开设置时都会**重新被调用**，
 *   因此其中所有 `name`/`desc`/`options` 都通过 `t()` 实时按当前 locale 求值。
 * - 切语言时，在 `setControlValue("language")` 里持久化后调 `this.update()`，
 *   框架会重新调用 `getSettingDefinitions()` 并以新 locale 重渲整 tab ——
 *   所有 setting 的标签、副标题、下拉项文案、控件当前值**同步刷新**。
 * - 控件当前值一律由 `getControlValue(key)` 从 `plugin.settings` 读取，
 *   用户改值走 `setControlValue(key, value)` 持久化，不依赖任何命令式 DOM 状态。
 * - 不重写 `display()`（1.13+ 声明式模式下 display() 不会被调用，且已弃用）。
 *
 * 注：本插件使用自建 i18n（`./i18n` + `t()`），不走 Obsidian 原生 i18n 文件夹，
 * 因此语言切换的实时刷新由上面的 `update()` 机制保证。
 */
export class FolderTerminalSettingTab extends PluginSettingTab {
	constructor(app: App, private plugin: FolderTerminalPlugin) {
		super(app, plugin);
	}

	/** 声明式设置定义；每次 update() / 打开设置都会被重新调用（故 t() 实时求值） */
	override getSettingDefinitions(): SettingDefinitionItem[] {
		return [
			{
				name: t("settings.language.name"),
				desc: t("settings.language.desc"),
				control: {
					key: "language",
					type: "dropdown",
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
					key: "shell",
					type: "text",
					placeholder: "/bin/zsh",
				},
			},
			{
				name: t("settings.fontSize.name"),
				desc: t("settings.fontSize.desc", { size: this.plugin.settings.fontSize }),
				control: {
					key: "fontSize",
					type: "slider",
					min: 10,
					max: 22,
					step: 1,
				},
			},
			{
				name: t("settings.colorScheme.name"),
				desc: t("settings.colorScheme.desc"),
				control: {
					key: "colorScheme",
					type: "dropdown",
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
					key: "reuseLeaf",
					type: "toggle",
				},
			},
			{
				name: t("settings.initCommand.name"),
				desc: t("settings.initCommand.desc"),
				control: {
					key: "initCommand",
					type: "text",
					placeholder: t("settings.initCommand.placeholder"),
				},
			},
		];
	}

	/** 读取控件当前值（每次渲染都被调用） */
	override getControlValue(key: string): unknown {
		switch (key) {
			case "language":
				return this.plugin.settings.language;
			case "shell":
				return this.plugin.settings.shell;
			case "fontSize":
				return this.plugin.settings.fontSize;
			case "colorScheme":
				return this.plugin.settings.colorScheme;
			case "reuseLeaf":
				return this.plugin.settings.reuseLeaf;
			case "initCommand":
				return this.plugin.settings.initCommand ?? "";
			default:
				return undefined;
		}
	}

	/** 用户改值时的持久化 + 后置副作用钩子 */
	override async setControlValue(key: string, value: unknown): Promise<void> {
		switch (key) {
			case "language": {
				const next = value as LanguageSetting;
				this.plugin.settings.language = next;
				await this.plugin.saveSettings();
				setLocale(resolveLocale(next, getLanguage()));
				// 整 tab 用新 locale 重渲：所有标签/副标题/下拉项/控件当前值同步刷新
				this.update();
				for (const leaf of this.plugin.app.workspace.getLeavesOfType(
					"folder-terminal-view",
				)) {
					const vw = leaf.view as unknown as { onLocaleChanged?: () => void };
					vw.onLocaleChanged?.();
				}
				return;
			}
			case "shell":
				this.plugin.settings.shell = (value as string).trim();
				break;
			case "fontSize":
				this.plugin.settings.fontSize = value as number;
				// 副标题里的 "current Xpx" 需要重渲，刷新整 tab
				this.update();
				break;
			case "colorScheme":
				this.plugin.settings.colorScheme = value as FolderTerminalSettings["colorScheme"];
				break;
			case "reuseLeaf":
				this.plugin.settings.reuseLeaf = value as boolean;
				break;
			case "initCommand":
				this.plugin.settings.initCommand = (value as string).trim();
				break;
		}
		await this.plugin.saveSettings();
	}
}

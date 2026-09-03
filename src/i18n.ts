/**
 * 多语言支持（i18n）。
 *
 * 插件所有面向用户的文案（命令、设置项、弹窗、菜单、空状态、终端诊断横幅等）
 * 一律通过 `t(key, params?)` 取词，不再硬编码在业务代码里。
 *
 * 当前支持两种语言：
 * - zh-CN（默认）
 * - en
 *
 * 语言由 settings.language 决定，main.ts 在 onload 时调用 setLocale() 应用，
 * 运行中切换语言时由设置面板回调 setLocale() 并通知视图重渲染。
 *
 * 注意：pty-proxy.py 运行在子进程里无法 import 本模块，其提示保持英文/中文混合。
 */

export type Locale = "zh-CN" | "en";

/** 语言设置项：具体语言，或「跟随系统」（运行时按 Obsidian 界面语言解析）。 */
export type LanguageSetting = "system" | Locale;

type Dict = Record<string, string>;

const zhCN: Dict = {
	// ---------- 命令 / 文件浏览器右键 ----------
	"command.openAtVaultRoot": "在库根目录打开终端",
	"command.openAtActiveNoteFolder": "在笔记所在文件夹打开终端",
	"menu.openInTerminal": "在终端中打开",

	// ---------- 设置面板 ----------
	"settings.language.name": "界面语言",
	"settings.language.desc": "插件的界面文字语言",
	"settings.language.zh": "中文",
	"settings.language.en": "English",
	"settings.language.system": "跟随系统",
	"settings.shell.name": "默认 Shell",
	"settings.shell.desc": "留空使用 $SHELL 环境变量（macOS 默认 /bin/zsh），如 /bin/bash、/bin/fish",
	"settings.fontSize.name": "字号",
	"settings.fontSize.desc": "终端字体大小（当前 {size}px）",
	"settings.colorScheme.name": "配色方案",
	"settings.colorScheme.desc": "跟随 Obsidian 主题，或强制深色 / 浅色",
	"settings.colorScheme.system": "跟随主题",
	"settings.colorScheme.dark": "深色",
	"settings.colorScheme.light": "浅色",
	"settings.reuseLeaf.name": "复用终端面板",
	"settings.reuseLeaf.desc": "重复点击文件夹图标时复用同一个底部终端面板；关闭则每次新开一个",
	"settings.initCommand.name": "默认启动命令",
	"settings.initCommand.desc": "新建终端标签时自动执行（如 git status、npm run dev、conda activate base）；留空不执行。每个标签可在「标签设置」单独覆盖",
	"settings.initCommand.placeholder": "如 git status",

	// ---------- 标签设置弹窗 ----------
	"modal.title": "标签设置 · {title}",
	"modal.customLabel": "自定义此标签",
	"modal.customDesc": "关闭则使用全局设置",
	"modal.apply": "应用",
	"modal.shell": "Shell",
	"modal.shellDesc": "留空使用全局 / 默认",
	"modal.shellPlaceholder": "如 /bin/fish",
	"modal.colorScheme": "配色",
	"modal.fontSize": "字号",
	"modal.tabColor": "标签颜色",
	"modal.tabColorDesc": "色点区分用途（如 开发 / 测试 / 日志）；点下方「无」可清除色标",
	"modal.presetColor": "预设色",
	"modal.clearColorTitle": "清除颜色（无色标）",
	"modal.clearColor": "无",
	"modal.preset.dev": "开发",
	"modal.preset.test": "测试",
	"modal.preset.log": "日志",
	"modal.preset.danger": "危险",
	"modal.initCommand": "启动命令",
	"modal.initCommandDesc": "打开此标签时自动执行（如 git status、npm run dev）；留空不执行",
	"modal.initCommandPlaceholder": "如 git status",

	// ---------- 终端视图 / 标签栏 ----------
	"view.displayName": "终端",
	"view.displayNameWith": "终端 · {name}",
	"view.initFailed": "视图初始化失败：",
	"view.restartSession": "重启当前会话",
	"view.createFailed": "创建终端失败（cwd=\"{cwd}\"）\n原因: {msg}\n\n检查项：\n  1. python3 是否可用（在 Obsidian 控制台执行 process.execPath 所在进程的 PATH）\n  2. 字体 xterm/css 是否成功注入（查看 <style id=\"ft-xterm-css\">）\n  3. FOLDER_TERMINAL_PYTHON 环境变量\n",
	"view.xtermFallback": "xterm 渲染不可用，已降级为纯文本模式。\n原因: {msg}\n",
	"view.cdUnsupported": "当前为纯文本降级模式，不支持 cd。",
	"view.bannerStarting": "正在启动会话 …",
	"view.sessionEnded": "会话已结束 (exit {code})",
	"tab.root": "库根",
	"tab.newTerminalAria": "新建终端",
	"tab.newTerminalTitle": "新建终端（库根）",
	"tab.moreTabs": "更多标签",
	"tab.closeSession": "关闭会话",
	"tab.overflowRoot": "（库根）",
	"tab.copySuffix": " (副本)",

	// ---------- 菜单 ----------
	"menu.renameTab": "重命名标签",
	"menu.tabSettings": "标签设置…",
	"menu.restartSession": "重启会话",
	"menu.duplicateTab": "复制标签",
	"menu.closeTab": "关闭标签",
	"menu.closeOtherTabs": "关闭其他标签",
	"menu.closeAllTabs": "关闭全部标签",
	"term.copy": "复制",
	"term.paste": "粘贴",
	"term.clear": "清屏",

	// ---------- 空状态 ----------
	"empty.hint": "点击左侧文件夹旁的终端图标打开会话，",
	"empty.openRoot": "或在库根目录打开终端",

	// ---------- 文件浏览器图标 ----------
	"icon.openHere": "在此文件夹打开终端",

	// ---------- pty 回退提示（终端内可见） ----------
	"pty.spawnFailed": "启动失败: ",
	"pty.cwdMissing": "工作目录不存在: ",
	"pty.fallbackScript": "未找到 python3，已回退到 script 模式（尺寸同步降级）",
	"pty.installXcode": "未找到 python3：请安装 Xcode Command Line Tools（xcode-select --install）后重试",
};

const en: Dict = {
	// ---------- Commands / file-explorer context menu ----------
	"command.openAtVaultRoot": "Open terminal at vault root",
	"command.openAtActiveNoteFolder": "Open terminal in active note's folder",
	"menu.openInTerminal": "Open in terminal",

	// ---------- Settings panel ----------
	"settings.language.name": "Interface language",
	"settings.language.desc": "Language for the plugin's interface text",
	"settings.language.zh": "Chinese",
	"settings.language.en": "English",
	"settings.language.system": "Follow system",
	"settings.shell.name": "Default shell",
	"settings.shell.desc": "Leave empty to use the $SHELL environment variable (macOS default /bin/zsh), e.g. /bin/bash, /bin/fish",
	"settings.fontSize.name": "Font size",
	"settings.fontSize.desc": "Terminal font size (current {size}px)",
	"settings.colorScheme.name": "Color scheme",
	"settings.colorScheme.desc": "Follow the Obsidian theme, or force dark / light",
	"settings.colorScheme.system": "Follow theme",
	"settings.colorScheme.dark": "Dark",
	"settings.colorScheme.light": "Light",
	"settings.reuseLeaf.name": "Reuse terminal panel",
	"settings.reuseLeaf.desc": "Reuse the same bottom terminal panel when clicking the folder icon repeatedly; turn off to open a new one each time",
	"settings.initCommand.name": "Default startup command",
	"settings.initCommand.desc": "Auto-run when a new terminal tab opens (e.g. git status, npm run dev, conda activate base); leave empty to skip. Each tab can override this in \"Tab settings\"",
	"settings.initCommand.placeholder": "e.g. git status",

	// ---------- Tab settings modal ----------
	"modal.title": "Tab settings · {title}",
	"modal.customLabel": "Customize this tab",
	"modal.customDesc": "Turn off to use global settings",
	"modal.apply": "Apply",
	"modal.shell": "Shell",
	"modal.shellDesc": "Leave empty to use global / default",
	"modal.shellPlaceholder": "e.g. /bin/fish",
	"modal.colorScheme": "Color scheme",
	"modal.fontSize": "Font size",
	"modal.tabColor": "Tab color",
	"modal.tabColorDesc": "Color dot to distinguish purpose (e.g. dev / test / log); click \"None\" below to clear",
	"modal.presetColor": "Preset colors",
	"modal.clearColorTitle": "Clear color (no dot)",
	"modal.clearColor": "None",
	"modal.preset.dev": "Dev",
	"modal.preset.test": "Test",
	"modal.preset.log": "Log",
	"modal.preset.danger": "Danger",
	"modal.initCommand": "Startup command",
	"modal.initCommandDesc": "Auto-run when this tab opens (e.g. git status, npm run dev); leave empty to skip",
	"modal.initCommandPlaceholder": "e.g. git status",

	// ---------- Terminal view / tab bar ----------
	"view.displayName": "Terminal",
	"view.displayNameWith": "Terminal · {name}",
	"view.initFailed": "View initialization failed:",
	"view.restartSession": "Restart current session",
	"view.createFailed": "Failed to create terminal (cwd=\"{cwd}\")\nReason: {msg}\n\nChecklist:\n  1. Is python3 available (PATH of the process running process.execPath, visible in the Obsidian console)\n  2. Is the xterm/css font injected (look for <style id=\"ft-xterm-css\">)\n  3. FOLDER_TERMINAL_PYTHON environment variable\n",
	"view.xtermFallback": "xterm rendering unavailable, fell back to plain-text mode.\nReason: {msg}\n",
	"view.cdUnsupported": "The current plain-text fallback mode does not support cd.",
	"view.bannerStarting": "Starting session …",
	"view.sessionEnded": "Session ended (exit {code})",
	"tab.root": "Vault root",
	"tab.newTerminalAria": "New terminal",
	"tab.newTerminalTitle": "New terminal (vault root)",
	"tab.moreTabs": "More tabs",
	"tab.closeSession": "Close session",
	"tab.overflowRoot": "(vault root)",
	"tab.copySuffix": " (copy)",

	// ---------- Menus ----------
	"menu.renameTab": "Rename tab",
	"menu.tabSettings": "Tab settings…",
	"menu.restartSession": "Restart session",
	"menu.duplicateTab": "Duplicate tab",
	"menu.closeTab": "Close tab",
	"menu.closeOtherTabs": "Close other tabs",
	"menu.closeAllTabs": "Close all tabs",
	"term.copy": "Copy",
	"term.paste": "Paste",
	"term.clear": "Clear screen",

	// ---------- Empty state ----------
	"empty.hint": "Click the terminal icon next to a folder in the file explorer to open a session, ",
	"empty.openRoot": "or open a terminal at the vault root",

	// ---------- File-explorer icon ----------
	"icon.openHere": "Open terminal in this folder",

	// ---------- pty fallback hints (visible in terminal) ----------
	"pty.spawnFailed": "Failed to start: ",
	"pty.cwdMissing": "Working directory does not exist: ",
	"pty.fallbackScript": "python3 not found, fell back to script mode (size sync degraded)",
	"pty.installXcode": "python3 not found: install Xcode Command Line Tools (xcode-select --install) and retry",
};

const dicts: Record<Locale, Dict> = { "zh-CN": zhCN, "en": en };

let currentLocale: Locale = "zh-CN";

export function setLocale(locale: Locale): void {
	currentLocale = locale;
}

export function getLocale(): Locale {
	return currentLocale;
}

/**
 * 把「语言设置项」解析成具体 Locale。
 * - "system" → 按 Obsidian 界面语言（app.getLanguage()）自动选：以 "zh" 开头 → 中文，否则英文。
 * - 具体语言 → 原样返回。
 * 保持本模块不依赖 obsidian，故由调用方传入 obsidianLang 字符串。
 */
export function resolveLocale(setting: LanguageSetting, obsidianLang: string): Locale {
	if (setting !== "system") return setting;
	return obsidianLang.toLowerCase().startsWith("zh") ? "zh-CN" : "en";
}

/**
 * 取词条。若当前语言缺失该 key，回退到中文；中文也缺失则返回 key 本身并打 console.warn（便于发现遗漏）。
 * @param params 占位符替换，如 { name: "foo" } 会把字符串中的 {name} 替换为 foo
 */
const warnedKeys = new Set<string>();
export function t(key: string, params?: Record<string, string | number>): string {
	const table = dicts[currentLocale] ?? dicts["zh-CN"];
	let s = table[key];
	if (s === undefined) {
		s = dicts["zh-CN"][key];
		if (s === undefined) {
			// 关键缺失：在 dev 控制台一次性告警，避免静默把 key 渲染到 UI 上
			if (!warnedKeys.has(key)) {
				warnedKeys.add(key);
				console.warn(`[folder-terminal] missing i18n key: "${key}"`);
			}
			s = key;
		}
	}
	if (params) {
		for (const [k, v] of Object.entries(params)) {
			s = s.replace(new RegExp(`\\{${k}\\}`, "g"), String(v));
		}
	}
	return s;
}

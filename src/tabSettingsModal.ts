import {
	App,
	ColorComponent,
	DropdownComponent,
	Modal,
	Setting,
	SliderComponent,
	TextComponent,
} from "obsidian";
import type { FolderTerminalSettings } from "./settings";
import { t } from "./i18n";

/** 单个标签页对全局设置的覆盖项 */
export interface TabOverrides {
	shell?: string;
	colorScheme?: FolderTerminalSettings["colorScheme"];
	fontSize?: number;
	initCommand?: string;
	color?: string;
}

interface Draft {
	enabled: boolean;
	shell: string;
	colorScheme: FolderTerminalSettings["colorScheme"];
	fontSize: number;
	initCommand: string;
	color: string;
}

/**
 * 「标签设置」弹窗：为单个标签页覆盖 Shell / 配色 / 字号。
 * 关闭「自定义此标签」则清除该标签的所有覆盖（回到全局设置）。
 */
export class TabSettingsModal extends Modal {
	private draft: Draft;
	private fieldsEl: HTMLElement | null = null;

	constructor(
		app: App,
		private tabTitle: string,
		private overrides: TabOverrides,
		private global: FolderTerminalSettings,
		private onSave: (overrides: TabOverrides) => void,
	) {
		super(app);
		this.draft = {
			enabled: !!(
				overrides.shell ||
				overrides.colorScheme ||
				overrides.fontSize ||
				overrides.initCommand ||
				overrides.color
			),
			shell: overrides.shell ?? global.shell,
			colorScheme: overrides.colorScheme ?? global.colorScheme,
			fontSize: overrides.fontSize ?? global.fontSize,
			initCommand: overrides.initCommand ?? global.initCommand ?? "",
			color: overrides.color ?? "",
		};
	}

	onOpen(): void {
		this.titleEl.setText(t("modal.title", { title: this.tabTitle }));
		const { contentEl } = this;
		contentEl.empty();

		new Setting(contentEl)
			.setName(t("modal.customLabel"))
			.setDesc(t("modal.customDesc"))
			.addToggle((toggle) =>
				toggle.setValue(this.draft.enabled).onChange((value) => {
					this.draft.enabled = value;
					this.renderFields();
				}),
			);

		this.fieldsEl = contentEl.createDiv();
		this.renderFields();

		new Setting(contentEl).addButton((button) =>
			button.setButtonText(t("modal.apply")).setCta().onClick(() => this.save()),
		);
	}

	onClose(): void {
		this.contentEl.empty();
	}

	private renderFields(): void {
		const el = this.fieldsEl!;
		let colorPicker: ColorComponent | undefined;
		el.empty();
		if (!this.draft.enabled) return;

		new Setting(el).setName(t("modal.shell")).setDesc(t("modal.shellDesc")).addText((text: TextComponent) => {
			text.setPlaceholder(t("modal.shellPlaceholder")).setValue(this.draft.shell);
			text.onChange((value) => (this.draft.shell = value.trim()));
		});

		new Setting(el).setName(t("modal.colorScheme")).addDropdown((dropdown: DropdownComponent) => {
			dropdown
				.addOption("system", t("settings.colorScheme.system"))
				.addOption("dark", t("settings.colorScheme.dark"))
				.addOption("light", t("settings.colorScheme.light"))
				.setValue(this.draft.colorScheme);
			dropdown.onChange(
				(value) => (this.draft.colorScheme = value as FolderTerminalSettings["colorScheme"]),
			);
		});

		new Setting(el).setName(t("modal.fontSize")).addSlider((slider: SliderComponent) => {
			slider.setLimits(10, 22, 1).setValue(this.draft.fontSize);
			slider.onChange((value) => (this.draft.fontSize = value));
		});

		new Setting(el)
			.setName(t("modal.tabColor"))
			.setDesc(t("modal.tabColorDesc"))
			.addColorPicker((picker: ColorComponent) => {
				colorPicker = picker;
				picker.setValue(this.draft.color || "#3fb950").onChange((value) => {
					this.draft.color = value;
				});
			});
		const presets: ReadonlyArray<[string, string]> = [
			[t("modal.preset.dev"), "#3fb950"],
			[t("modal.preset.test"), "#58a6ff"],
			[t("modal.preset.log"), "#d29922"],
			[t("modal.preset.danger"), "#ff7b72"],
		];
		const pset = new Setting(el).setName(t("modal.presetColor"));
		// 「无」= 清除色标（标签左侧回到无色点）
		const clearBtn = pset.settingEl.createEl("button", {
			cls: "ft-color-preset ft-color-clear",
			attr: { type: "button", title: t("modal.clearColorTitle") },
			text: "",
		});
		const clearSwatch = clearBtn.createSpan({ cls: "ft-color-preset-swatch" });
		// 斜杠样式由 .ft-color-clear .ft-color-preset-swatch 的 linear-gradient 绘制，不在此塞文字
		void clearSwatch;
		clearBtn.createSpan({ text: t("modal.clearColor") });
		clearBtn.addEventListener("click", (evt) => {
			evt.preventDefault();
			this.draft.color = "";
			colorPicker?.setValue("#3fb950");
		});
		for (const [name, hex] of presets) {
			const btn = pset.settingEl.createEl("button", {
				cls: "ft-color-preset",
				attr: { type: "button", title: `${name} · ${hex}` },
				text: "",
			});
			const swatch = btn.createSpan({ cls: "ft-color-preset-swatch" });
			swatch.style.backgroundColor = hex;
			btn.createSpan({ text: name });
			btn.addEventListener("click", (evt) => {
				evt.preventDefault();
				colorPicker?.setValue(hex);
				this.draft.color = hex;
			});
		}

		new Setting(el)
			.setName(t("modal.initCommand"))
			.setDesc(t("modal.initCommandDesc"))
			.addText((text: TextComponent) => {
				text.setPlaceholder(t("modal.initCommandPlaceholder")).setValue(this.draft.initCommand);
				text.onChange((value) => (this.draft.initCommand = value.trim()));
			});
	}

	private save(): void {
		this.onSave(
			this.draft.enabled
				? {
						shell: this.draft.shell || undefined,
						colorScheme: this.draft.colorScheme,
						fontSize: this.draft.fontSize,
						initCommand: this.draft.initCommand || undefined,
						color: this.draft.color || undefined,
					}
				: {},
		);
		this.close();
	}
}

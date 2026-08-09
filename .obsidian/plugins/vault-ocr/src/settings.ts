import { App, PluginSettingTab, Setting } from "obsidian";
import type VaultOcrPlugin from "./main";

export interface VaultOcrSettings {
	/** Absolute path to the `claude` executable. Empty = auto-detect. */
	claudeBinary: string;
	/** Model alias passed to `claude --model`. */
	model: string;
	/** Run extraction automatically when an image is pasted or dropped. */
	autoExtractOnPaste: boolean;
	/** How many `claude` processes may run at once. */
	maxConcurrent: number;
	/** Per-job timeout in seconds. */
	timeoutSeconds: number;
	/** Label shown on a completed callout. */
	calloutLabel: string;
	/** Ask the agent to describe diagrams/charts, not just transcribe text. */
	describeDiagrams: boolean;
	/** "Delete image, keep text" also deletes the attachment file from disk. */
	deleteAttachmentFile: boolean;
	/** "Delete image, keep text" unfolds the callout into plain text. */
	unfoldOnImageDelete: boolean;
}

export const DEFAULT_SETTINGS: VaultOcrSettings = {
	claudeBinary: "",
	model: "sonnet",
	autoExtractOnPaste: true,
	maxConcurrent: 2,
	timeoutSeconds: 120,
	calloutLabel: "Extracted text",
	describeDiagrams: true,
	deleteAttachmentFile: false,
	unfoldOnImageDelete: false,
};

export class VaultOcrSettingTab extends PluginSettingTab {
	plugin: VaultOcrPlugin;

	constructor(app: App, plugin: VaultOcrPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		new Setting(containerEl)
			.setName("Claude Code binary")
			.setDesc(
				"Absolute path to the `claude` executable. Leave empty to auto-detect from PATH and the usual install locations.",
			)
			.addText((text) =>
				text
					.setPlaceholder(this.plugin.runner.detectBinary() ?? "claude")
					.setValue(this.plugin.settings.claudeBinary)
					.onChange(async (value) => {
						this.plugin.settings.claudeBinary = value.trim();
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName("Model")
			.setDesc(
				"Model alias for extraction. Sonnet is fast and accurate for screenshots; switch to Opus for dense handwriting or messy scans.",
			)
			.addDropdown((dd) =>
				dd
					.addOption("sonnet", "Sonnet (default)")
					.addOption("opus", "Opus")
					.addOption("haiku", "Haiku (fastest, least accurate)")
					.setValue(this.plugin.settings.model)
					.onChange(async (value) => {
						this.plugin.settings.model = value;
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName("Extract automatically on paste")
			.setDesc(
				"Off means images get a placeholder you can fill later with the batch commands.",
			)
			.addToggle((t) =>
				t
					.setValue(this.plugin.settings.autoExtractOnPaste)
					.onChange(async (value) => {
						this.plugin.settings.autoExtractOnPaste = value;
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName("Describe diagrams")
			.setDesc(
				"Have the agent describe diagrams and charts in prose (and emit Mermaid where it fits) so they become searchable too.",
			)
			.addToggle((t) =>
				t
					.setValue(this.plugin.settings.describeDiagrams)
					.onChange(async (value) => {
						this.plugin.settings.describeDiagrams = value;
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName("Max concurrent extractions")
			.setDesc(
				"Each extraction is one short Claude Code session. Keep this low so pasting a stack of slides doesn't burn through your quota at once.",
			)
			.addSlider((s) =>
				s
					.setLimits(1, 6, 1)
					.setValue(this.plugin.settings.maxConcurrent)
					.setDynamicTooltip()
					.onChange(async (value) => {
						this.plugin.settings.maxConcurrent = value;
						this.plugin.queue.setConcurrency(value);
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName("Timeout per image (seconds)")
			.addSlider((s) =>
				s
					.setLimits(30, 600, 30)
					.setValue(this.plugin.settings.timeoutSeconds)
					.setDynamicTooltip()
					.onChange(async (value) => {
						this.plugin.settings.timeoutSeconds = value;
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName("Callout label")
			.setDesc("Title shown on the folded callout once text is extracted.")
			.addText((text) =>
				text
					.setValue(this.plugin.settings.calloutLabel)
					.onChange(async (value) => {
						this.plugin.settings.calloutLabel =
							value.trim() || DEFAULT_SETTINGS.calloutLabel;
						await this.plugin.saveSettings();
					}),
			);

		containerEl.createEl("h3", { text: "Deleting images" });

		new Setting(containerEl)
			.setName("Also delete the attachment file")
			.setDesc(
				'When you run "Delete image, keep text", also remove the image file from the vault. Off keeps the file on disk so nothing is lost.',
			)
			.addToggle((t) =>
				t
					.setValue(this.plugin.settings.deleteAttachmentFile)
					.onChange(async (value) => {
						this.plugin.settings.deleteAttachmentFile = value;
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName("Unfold callout when image is deleted")
			.setDesc(
				"Turn the folded callout into an expanded one, so the note still reads normally without the picture.",
			)
			.addToggle((t) =>
				t
					.setValue(this.plugin.settings.unfoldOnImageDelete)
					.onChange(async (value) => {
						this.plugin.settings.unfoldOnImageDelete = value;
						await this.plugin.saveSettings();
					}),
			);
	}
}

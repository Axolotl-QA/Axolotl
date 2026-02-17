export interface SlashCommand {
	name: string;
	description?: string;
	section?: "default" | "custom";
	cliCompatible?: boolean;
}

export const BASE_SLASH_COMMANDS: SlashCommand[] = [
	{
		name: "newtask",
		description: "Create a new task with context from the current task",
		section: "default",
		cliCompatible: true,
	},
	{
		name: "reportbug",
		description: "Report a bug with Axolotl",
		section: "default",
		cliCompatible: true,
	},
];

// VS Code-only slash commands
export const VSCODE_ONLY_COMMANDS: SlashCommand[] = [];

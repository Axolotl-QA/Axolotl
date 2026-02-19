import fs from "node:fs/promises";
import path from "node:path";
import { formatResponse } from "@core/prompts/responses";
import { GlobalFileNames } from "@core/storage/disk";
import { fileExistsAtPath } from "@utils/fs";

export async function getAxolotlMdInstructions(cwd: string): Promise<string> {
	const filePath = path.resolve(cwd, GlobalFileNames.axolotlMd);

	if (await fileExistsAtPath(filePath)) {
		try {
			const content = (await fs.readFile(filePath, "utf8")).trim();
			if (content) {
				return formatResponse.axolotlMdInstructions(cwd, content);
			}
		} catch {
			console.error(`Failed to read axolotl.md at ${filePath}`);
		}
	}

	return formatResponse.axolotlMdEmptyInstructions(cwd);
}

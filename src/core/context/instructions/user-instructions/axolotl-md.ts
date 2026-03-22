import fs from "node:fs/promises";
import path from "node:path";
import { formatResponse } from "@core/prompts/responses";
import { GlobalFileNames } from "@core/storage/disk";
import { fileExistsAtPath } from "@utils/fs";

const AXOLOTL_MD_MAX_CHARS = 12_000;

export async function getAxolotlMdInstructions(cwd: string): Promise<string> {
	const filePath = path.resolve(cwd, GlobalFileNames.axolotlMd);

	if (await fileExistsAtPath(filePath)) {
		try {
			const content = (await fs.readFile(filePath, "utf8")).trim();
			if (content) {
				const truncated = content.length > AXOLOTL_MD_MAX_CHARS;
				const limitedContent = truncated
					? `${content.slice(0, AXOLOTL_MD_MAX_CHARS)}\n\n[axolotl.md truncated: showing first ${AXOLOTL_MD_MAX_CHARS} characters of ${content.length}]`
					: content;

				return formatResponse.axolotlMdInstructions(cwd, limitedContent);
			}
		} catch {
			console.error(`Failed to read axolotl.md at ${filePath}`);
		}
	}

	return formatResponse.axolotlMdEmptyInstructions(cwd);
}

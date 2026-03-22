import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { expect } from "chai";
import { afterEach, beforeEach, describe, it } from "mocha";

import { getAxolotlMdInstructions } from "../axolotl-md";

describe("axolotl.md instructions", () => {
	let testDir: string;

	beforeEach(async () => {
		testDir = await fs.mkdtemp(path.join(os.tmpdir(), "axolotl-md-test-"));
	});

	afterEach(async () => {
		await fs.rm(testDir, { recursive: true, force: true });
	});

	it("should return empty instructions when axolotl.md does not exist", async () => {
		const instructions = await getAxolotlMdInstructions(testDir);

		expect(instructions).to.include("No axolotl.md exists in this project yet");
	});

	it("should include full axolotl.md content when within limit", async () => {
		await fs.writeFile(
			path.join(testDir, "axolotl.md"),
			"Project run instructions",
			"utf8",
		);

		const instructions = await getAxolotlMdInstructions(testDir);

		expect(instructions).to.include("Project run instructions");
		expect(instructions).to.not.include("[axolotl.md truncated:");
	});

	it("should truncate oversized axolotl.md content and append a notice", async () => {
		await fs.writeFile(
			path.join(testDir, "axolotl.md"),
			"a".repeat(12_050),
			"utf8",
		);

		const instructions = await getAxolotlMdInstructions(testDir);

		expect(instructions).to.include("a".repeat(12_000));
		expect(instructions).to.not.include("a".repeat(12_001));
		expect(instructions).to.include(
			"[axolotl.md truncated: showing first 12000 characters of 12050]",
		);
	});
});

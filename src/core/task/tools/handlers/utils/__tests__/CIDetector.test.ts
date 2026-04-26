import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { expect } from "chai";
import { detectCICommands, filterByCheckType } from "../CIDetector";

async function makeTempProject(pkgJson: object | null): Promise<string> {
	const dir = await fs.mkdtemp(path.join(os.tmpdir(), "ci-detector-test-"));
	if (pkgJson !== null) {
		await fs.writeFile(
			path.join(dir, "package.json"),
			JSON.stringify(pkgJson, null, 2),
		);
	}
	return dir;
}

async function cleanup(dir: string) {
	await fs.rm(dir, { recursive: true, force: true });
}

describe("CIDetector", () => {
	describe("detectCICommands", () => {
		it("returns empty array when no package.json exists", async () => {
			const dir = await makeTempProject(null);
			try {
				const result = await detectCICommands(dir);
				expect(result).to.deep.equal([]);
			} finally {
				await cleanup(dir);
			}
		});

		it("returns empty array when package.json is malformed", async () => {
			const dir = await fs.mkdtemp(path.join(os.tmpdir(), "ci-bad-"));
			try {
				await fs.writeFile(path.join(dir, "package.json"), "{ not json");
				const result = await detectCICommands(dir);
				expect(result).to.deep.equal([]);
			} finally {
				await cleanup(dir);
			}
		});

		it("returns empty array when no relevant scripts exist", async () => {
			const dir = await makeTempProject({
				name: "x",
				scripts: { build: "tsc", start: "node index.js" },
			});
			try {
				const result = await detectCICommands(dir);
				expect(result).to.deep.equal([]);
			} finally {
				await cleanup(dir);
			}
		});

		it("detects lint script", async () => {
			const dir = await makeTempProject({
				name: "x",
				scripts: { lint: "biome check ." },
			});
			try {
				const result = await detectCICommands(dir);
				expect(result).to.have.lengthOf(1);
				expect(result[0]).to.deep.equal({
					check_type: "lint",
					command: "npm run lint",
					source: "package.json",
				});
			} finally {
				await cleanup(dir);
			}
		});

		it("detects typecheck script under multiple aliases", async () => {
			for (const aliasName of ["typecheck", "type-check", "check-types"]) {
				const dir = await makeTempProject({
					name: "x",
					scripts: { [aliasName]: "tsc --noEmit" },
				});
				try {
					const result = await detectCICommands(dir);
					expect(result, `alias ${aliasName}`).to.have.lengthOf(1);
					expect(result[0].check_type).to.equal("typecheck");
					expect(result[0].command).to.equal(`npm run ${aliasName}`);
				} finally {
					await cleanup(dir);
				}
			}
		});

		it("detects multiple categories simultaneously", async () => {
			const dir = await makeTempProject({
				name: "x",
				scripts: {
					lint: "biome check .",
					typecheck: "tsc --noEmit",
					test: "mocha",
				},
			});
			try {
				const result = await detectCICommands(dir);
				const types = result.map((c) => c.check_type);
				expect(types).to.include.members(["lint", "typecheck", "test"]);
				expect(result).to.have.lengthOf(3);
			} finally {
				await cleanup(dir);
			}
		});

		it("prefers the canonical script name when multiple aliases present", async () => {
			const dir = await makeTempProject({
				name: "x",
				scripts: {
					test: "mocha",
					"test:unit": "mocha unit",
				},
			});
			try {
				const result = await detectCICommands(dir);
				const testCmd = result.find((c) => c.check_type === "test");
				expect(testCmd?.command).to.equal("npm run test");
			} finally {
				await cleanup(dir);
			}
		});

		it("handles package.json with no scripts field", async () => {
			const dir = await makeTempProject({ name: "x" });
			try {
				const result = await detectCICommands(dir);
				expect(result).to.deep.equal([]);
			} finally {
				await cleanup(dir);
			}
		});
	});

	describe("filterByCheckType", () => {
		const all = [
			{
				check_type: "lint" as const,
				command: "npm run lint",
				source: "package.json" as const,
			},
			{
				check_type: "typecheck" as const,
				command: "npm run typecheck",
				source: "package.json" as const,
			},
			{
				check_type: "test" as const,
				command: "npm run test",
				source: "package.json" as const,
			},
		];

		it("returns all when filter is 'all'", () => {
			expect(filterByCheckType(all, "all")).to.deep.equal(all);
		});

		it("returns only matching type", () => {
			expect(filterByCheckType(all, "lint")).to.deep.equal([all[0]]);
			expect(filterByCheckType(all, "typecheck")).to.deep.equal([all[1]]);
			expect(filterByCheckType(all, "test")).to.deep.equal([all[2]]);
		});

		it("returns empty array when no commands match", () => {
			expect(filterByCheckType([all[0]], "test")).to.deep.equal([]);
		});
	});
});

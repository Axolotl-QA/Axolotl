import type { ToolUse } from "@core/assistant-message"
import { formatResponse } from "@core/prompts/responses"
import { regexSearchFiles } from "@services/ripgrep"
import { type LanguageParser, loadRequiredLanguageParsers } from "@services/tree-sitter/languageParser"
import * as fs from "fs/promises"
import * as path from "path"
import { ClineDefaultTool } from "@/shared/tools"
import type { ToolResponse } from "../../index"
import type { IToolHandler } from "../ToolExecutorCoordinator"
import type { TaskConfig } from "../types/TaskConfig"

// Size limits to prevent context explosion
const MAX_FILES = 20
const MAX_DEFINITIONS_PER_FILE = 30
const MAX_SEARCH_RESULTS = 50
const MAX_OUTPUT_BYTES = 100 * 1024 // 100KB

// Supported file extensions for AST parsing
const SUPPORTED_EXTENSIONS = [
	"js",
	"jsx",
	"ts",
	"tsx",
	"py",
	"rs",
	"go",
	"c",
	"h",
	"cpp",
	"hpp",
	"cs",
	"rb",
	"java",
	"php",
	"swift",
	"kt",
]

interface CodeDefinition {
	name: string
	type: string
	line: number
}

interface FileAnalysis {
	filePath: string
	definitions: CodeDefinition[]
	error?: string
}

interface SearchMatch {
	filePath: string
	line: number
	content: string
}

interface AnalysisResult {
	structures: FileAnalysis[]
	searchMatches: SearchMatch[]
	summary: {
		filesAnalyzed: number
		totalDefinitions: number
		totalSearchMatches: number
		truncated: boolean
	}
}

export class AxolotlAnalyzeCodeHandler implements IToolHandler {
	readonly name = ClineDefaultTool.AXOLOTL_ANALYZE_CODE

	getDescription(block: ToolUse): string {
		const analysisType = block.params.analysis_type || "unknown"
		return `[${block.name} type="${analysisType}"]`
	}

	async execute(config: TaskConfig, block: ToolUse): Promise<ToolResponse> {
		console.log("[AxolotlAnalyzeCode] Tool called with params:", JSON.stringify(block.params, null, 2))

		const filePathsRaw: string | undefined = block.params.file_paths
		const analysisType: string | undefined = block.params.analysis_type
		const searchPattern: string | undefined = block.params.search_pattern
		const focusAreas: string | undefined = block.params.focus_areas

		// Validate required parameters
		if (!filePathsRaw) {
			config.taskState.consecutiveMistakeCount++
			return await config.callbacks.sayAndCreateMissingParamError(this.name, "file_paths")
		}

		if (!analysisType) {
			config.taskState.consecutiveMistakeCount++
			return await config.callbacks.sayAndCreateMissingParamError(this.name, "analysis_type")
		}

		if (!["structure", "search", "both"].includes(analysisType)) {
			config.taskState.consecutiveMistakeCount++
			return formatResponse.toolError(`Invalid analysis_type "${analysisType}". Must be one of: structure, search, both`)
		}

		if ((analysisType === "search" || analysisType === "both") && !searchPattern) {
			config.taskState.consecutiveMistakeCount++
			return formatResponse.toolError(`search_pattern is required when analysis_type is "${analysisType}"`)
		}

		config.taskState.consecutiveMistakeCount = 0

		// Parse file paths
		let filePaths: string[]
		try {
			filePaths = JSON.parse(filePathsRaw)
			if (!Array.isArray(filePaths)) {
				throw new Error("file_paths must be a JSON array")
			}
		} catch {
			// Try splitting by comma or newline if not valid JSON
			filePaths = filePathsRaw
				.split(/[,\n]/)
				.map((f) => f.trim())
				.filter((f) => f)
		}

		// Limit number of files
		const limitedFilePaths = filePaths.slice(0, MAX_FILES)
		const wasFilesLimited = filePaths.length > MAX_FILES

		try {
			const result: AnalysisResult = {
				structures: [],
				searchMatches: [],
				summary: {
					filesAnalyzed: 0,
					totalDefinitions: 0,
					totalSearchMatches: 0,
					truncated: wasFilesLimited,
				},
			}

			// Perform structure analysis if requested
			if (analysisType === "structure" || analysisType === "both") {
				result.structures = await this.analyzeCodeStructure(
					limitedFilePaths,
					config.cwd,
					config.services.clineIgnoreController,
				)
				result.summary.filesAnalyzed = result.structures.length
				result.summary.totalDefinitions = result.structures.reduce((sum, f) => sum + f.definitions.length, 0)
			}

			// Perform search if requested
			if (analysisType === "search" || analysisType === "both") {
				result.searchMatches = await this.searchCode(
					limitedFilePaths,
					searchPattern!,
					config.cwd,
					config.services.clineIgnoreController,
				)
				result.summary.totalSearchMatches = result.searchMatches.length
			}

			// Format output with size limiting
			const output = this.formatOutput(result, focusAreas, searchPattern)

			return formatResponse.toolResult(output)
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : "Unknown error"
			console.error("Error in axolotl_analyze_code:", errorMessage)
			return formatResponse.toolError(`Failed to analyze code: ${errorMessage}`)
		}
	}

	private async analyzeCodeStructure(filePaths: string[], cwd: string, clineIgnoreController?: any): Promise<FileAnalysis[]> {
		const results: FileAnalysis[] = []

		// Filter to supported file types
		const supportedFiles = filePaths.filter((f) => {
			const ext = path.extname(f).toLowerCase().slice(1)
			return SUPPORTED_EXTENSIONS.includes(ext)
		})

		if (supportedFiles.length === 0) {
			return results
		}

		// Resolve absolute paths
		const absolutePaths = supportedFiles.map((f) => path.resolve(cwd, f))

		// Load language parsers
		let languageParsers: LanguageParser
		try {
			languageParsers = await loadRequiredLanguageParsers(absolutePaths)
		} catch (error) {
			console.error("Error loading language parsers:", error)
			return results
		}

		// Parse each file
		for (const filePath of absolutePaths) {
			// Check access if controller provided
			if (clineIgnoreController && !clineIgnoreController.validateAccess(filePath)) {
				continue
			}

			const relativePath = path.relative(cwd, filePath)
			const analysis = await this.parseFileForDefinitions(filePath, relativePath, languageParsers)
			if (analysis) {
				results.push(analysis)
			}
		}

		return results
	}

	private async parseFileForDefinitions(
		absolutePath: string,
		relativePath: string,
		languageParsers: LanguageParser,
	): Promise<FileAnalysis | null> {
		const ext = path.extname(absolutePath).toLowerCase().slice(1)
		const { parser, query } = languageParsers[ext] || {}

		if (!parser || !query) {
			return {
				filePath: relativePath,
				definitions: [],
				error: `Unsupported file type: ${ext}`,
			}
		}

		try {
			const fileContent = await fs.readFile(absolutePath, "utf8")
			const tree = parser.parse(fileContent)

			if (!tree || !tree.rootNode) {
				return {
					filePath: relativePath,
					definitions: [],
					error: "Failed to parse file",
				}
			}

			const captures = query.captures(tree.rootNode)
			captures.sort((a, b) => a.node.startPosition.row - b.node.startPosition.row)

			const lines = fileContent.split("\n")
			const definitions: CodeDefinition[] = []
			const seenLines = new Set<number>()

			for (const capture of captures) {
				const { node, name } = capture
				const line = node.startPosition.row

				// Skip duplicates and limit definitions per file
				if (seenLines.has(line) || definitions.length >= MAX_DEFINITIONS_PER_FILE) {
					continue
				}

				// Only capture definition names
				if (name.includes("name")) {
					seenLines.add(line)

					// Extract definition type from capture name
					let defType = "unknown"
					if (name.includes("function")) {
						defType = "function"
					} else if (name.includes("class")) {
						defType = "class"
					} else if (name.includes("method")) {
						defType = "method"
					} else if (name.includes("interface")) {
						defType = "interface"
					} else if (name.includes("type")) {
						defType = "type"
					} else if (name.includes("module")) {
						defType = "module"
					}

					// Get the actual definition name from the line
					const lineContent = lines[line]?.trim() || ""
					definitions.push({
						name: lineContent,
						type: defType,
						line: line + 1, // 1-indexed
					})
				}
			}

			return {
				filePath: relativePath,
				definitions,
			}
		} catch (error) {
			return {
				filePath: relativePath,
				definitions: [],
				error: error instanceof Error ? error.message : "Parse error",
			}
		}
	}

	private async searchCode(
		filePaths: string[],
		pattern: string,
		cwd: string,
		clineIgnoreController?: any,
	): Promise<SearchMatch[]> {
		const matches: SearchMatch[] = []

		// Search in each file's directory
		const directories = new Set(filePaths.map((f) => path.dirname(path.resolve(cwd, f))))

		for (const dir of directories) {
			try {
				// Build file pattern from the files in this directory
				const filesInDir = filePaths
					.filter((f) => path.dirname(path.resolve(cwd, f)) === dir)
					.map((f) => path.basename(f))

				// Create glob pattern for these specific files
				const filePattern = filesInDir.length === 1 ? filesInDir[0] : `{${filesInDir.join(",")}}`

				const result = await regexSearchFiles(cwd, dir, pattern, filePattern, clineIgnoreController)

				// Parse ripgrep output
				const parsedMatches = this.parseRipgrepOutput(result, cwd)
				matches.push(...parsedMatches)

				if (matches.length >= MAX_SEARCH_RESULTS) {
					break
				}
			} catch (error) {
				console.error(`Error searching in ${dir}:`, error)
			}
		}

		return matches.slice(0, MAX_SEARCH_RESULTS)
	}

	private parseRipgrepOutput(output: string, _cwd: string): SearchMatch[] {
		const matches: SearchMatch[] = []
		const lines = output.split("\n")

		let currentFile = ""
		for (const line of lines) {
			// File path line (doesn't start with │)
			if (!line.startsWith("│") && !line.startsWith("|") && line.trim() && !line.includes("results")) {
				currentFile = line.trim()
			}
			// Match line (starts with │)
			else if ((line.startsWith("│") || line.startsWith("|")) && line.trim() !== "|----" && line.trim() !== "│----") {
				const content = line.slice(1).trim()
				if (content && currentFile) {
					// Try to extract line number if present
					const lineNumMatch = /^(\d+):/.exec(content)
					matches.push({
						filePath: currentFile,
						line: lineNumMatch ? parseInt(lineNumMatch[1], 10) : 0,
						content: lineNumMatch ? content.slice(lineNumMatch[0].length) : content,
					})
				}
			}
		}

		return matches
	}

	private formatOutput(result: AnalysisResult, focusAreas?: string, searchPattern?: string): string {
		let output = ""
		let byteSize = 0

		const addLine = (line: string): boolean => {
			const lineBytes = Buffer.byteLength(line + "\n", "utf8")
			if (byteSize + lineBytes > MAX_OUTPUT_BYTES) {
				result.summary.truncated = true
				return false
			}
			output += line + "\n"
			byteSize += lineBytes
			return true
		}

		// Header
		addLine("=== AXOLOTL CODE ANALYSIS ===")
		addLine("")

		// Code Structure section
		if (result.structures.length > 0) {
			addLine("=== CODE STRUCTURE ===")
			addLine("")

			for (const fileAnalysis of result.structures) {
				if (!addLine(fileAnalysis.filePath)) {
					break
				}

				if (fileAnalysis.error) {
					if (!addLine(`  ⚠️ ${fileAnalysis.error}`)) {
						break
					}
				} else if (fileAnalysis.definitions.length === 0) {
					if (!addLine("  (no definitions found)")) {
						break
					}
				} else {
					for (let i = 0; i < fileAnalysis.definitions.length; i++) {
						const def = fileAnalysis.definitions[i]
						const isLast = i === fileAnalysis.definitions.length - 1
						const prefix = isLast ? "└──" : "├──"
						const defLine = `${prefix} [${def.type}] ${def.name}`
						if (!addLine(defLine)) {
							break
						}
					}
				}
				if (!addLine("")) {
					break
				}
			}
		}

		// Search Results section
		if (result.searchMatches.length > 0) {
			if (!addLine(`=== SEARCH RESULTS (pattern: "${searchPattern}") ===`)) {
				// Still add summary even if truncated
			} else {
				addLine("")

				// Group by file
				const matchesByFile = new Map<string, SearchMatch[]>()
				for (const match of result.searchMatches) {
					const existing = matchesByFile.get(match.filePath) || []
					existing.push(match)
					matchesByFile.set(match.filePath, existing)
				}

				for (const [filePath, matches] of matchesByFile) {
					if (!addLine(filePath)) {
						break
					}
					for (const match of matches) {
						const lineInfo = match.line > 0 ? `:${match.line}` : ""
						if (!addLine(`│ ${lineInfo} ${match.content}`)) {
							break
						}
					}
					if (!addLine("")) {
						break
					}
				}
			}
		}

		// Summary section
		addLine("=== SUMMARY ===")
		addLine(`- Files analyzed: ${result.summary.filesAnalyzed}`)
		addLine(`- Definitions found: ${result.summary.totalDefinitions}`)
		if (result.searchMatches.length > 0) {
			addLine(`- Search matches: ${result.summary.totalSearchMatches}`)
		}
		if (result.summary.truncated) {
			addLine(`- ⚠️ Output truncated due to size limits`)
		}
		if (focusAreas) {
			addLine(`- Focus areas: ${focusAreas}`)
		}
		addLine("")
		addLine("Use this analysis to generate comprehensive test cases with axolotl_generate_plan.")

		return output.trim()
	}
}

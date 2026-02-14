import { ModelFamily } from "@/shared/prompts"
import { ClineDefaultTool } from "@/shared/tools"
import type { ClineToolSpec } from "../spec"

const id = ClineDefaultTool.AXOLOTL_QA_REPORT

const GENERIC: ClineToolSpec = {
	variant: ModelFamily.GENERIC,
	id,
	name: "axolotl_qa_report",
	description: `Generate and display a Axolotl QA test report. Use this tool ONLY after:
1. Completing all test execution
2. Cleaning up ALL injected AXOLOTL_TEST_LOG statements

**IMPORTANT**: You MUST cleanup injected logs BEFORE calling this tool. Do NOT leave test logs in the code!`,
	parameters: [
		{
			name: "report_json",
			required: true,
			instruction: `The complete test report as a JSON string. Must follow this schema:
{
  "summary": {
    "total_tests": number,
    "passed": number,
    "failed": number,
    "skipped": number,
    "verdict": "MERGEABLE" | "NOT_MERGEABLE" | "MERGEABLE_WITH_RISKS"
  },
  "tests": [
    {
      "id": "string",
      "name": "string",
      "category": "functional" | "edge_case" | "integration" | "ui_ux",
      "status": "passed" | "failed" | "skipped",
      "evidence": {
        "logs": ["captured log lines"],
        "screenshots": ["screenshot descriptions"],
        "notes": "additional observations"
      },
      "failure_reason": "string (if failed)"
    }
  ],
  "risks": ["identified risks or concerns"],
  "recommendations": ["suggested improvements"]
}`,
			usage: '{"summary":{"total_tests":3,"passed":2,"failed":1,"skipped":0,"verdict":"MERGEABLE_WITH_RISKS"},"tests":[...],"risks":["Edge case not handled"],"recommendations":["Add input validation"]}',
		},
		{
			name: "logs_cleanup_summary",
			required: false,
			instruction: `Summary of log cleanup performed. If you injected any AXOLOTL_TEST_LOG statements, you MUST provide this to confirm cleanup was done.

Format: "Removed N logs from M files: file1.ts (lines X,Y), file2.ts (line Z)" or "No logs were injected" if no logs were added.

If logs were injected but this field is empty, you have NOT completed the cleanup phase!`,
			usage: "Removed 3 logs from 2 files: src/auth/login.ts (lines 15, 23), src/components/Form.tsx (line 45)",
		},
	],
}

export const axolotl_qa_report_variants = [GENERIC]

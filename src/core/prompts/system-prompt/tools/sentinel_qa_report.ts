import { ModelFamily } from "@/shared/prompts"
import { ClineDefaultTool } from "@/shared/tools"
import type { ClineToolSpec } from "../spec"

const id = ClineDefaultTool.SENTINEL_QA_REPORT

const GENERIC: ClineToolSpec = {
	variant: ModelFamily.GENERIC,
	id,
	name: "sentinel_qa_report",
	description:
		"Generate and display a Sentinel QA test report. Use this tool ONLY when completing a /sentinel-qa test session to summarize all test results, evidence, and provide a final verdict on whether the code meets the specified requirements. The report will be saved as a JSON file and displayed in the chat.",
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
	],
}

export const sentinel_qa_report_variants = [GENERIC]

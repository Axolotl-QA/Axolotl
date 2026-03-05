/**
 * Gemini Computer Use action names.
 * These are the function names returned by the model when Computer Use is enabled.
 * See: https://ai.google.dev/gemini-api/docs/computer-use
 */
export const COMPUTER_USE_ACTIONS = new Set([
	"click_at",
	"type_text_at",
	"scroll_document",
	"scroll_at",
	"hover_at",
	"key_combination",
	"drag_and_drop",
	"navigate",
	"go_back",
	"go_forward",
	"search",
	"open_web_browser",
	"wait_5_seconds",
]);

/**
 * CU actions that should auto-launch the browser if not running.
 */
export const BROWSER_LAUNCH_ACTIONS = new Set([
	"navigate",
	"open_web_browser",
	"search",
]);

/**
 * Check if a function name is a Computer Use action.
 */
export function isComputerUseAction(name: string): boolean {
	return COMPUTER_USE_ACTIONS.has(name);
}

/**
 * Convert CU normalized coordinate (0-999 grid) to pixel coordinate.
 */
export function denormalizeCoordinate(
	normalized: number,
	dimension: number,
): number {
	return Math.round((normalized / 1000) * dimension);
}

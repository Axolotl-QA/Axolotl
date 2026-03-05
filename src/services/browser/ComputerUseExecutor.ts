import {
	BROWSER_LAUNCH_ACTIONS,
	denormalizeCoordinate,
	isComputerUseAction,
} from "@shared/computer-use";
import type { BrowserActionResult } from "@shared/ExtensionMessage";
import type { KeyInput } from "puppeteer-core";
import type { BrowserSession } from "./BrowserSession";

export class ComputerUseExecutor {
	constructor(
		private browserSession: BrowserSession,
		private viewportWidth: number,
		private viewportHeight: number,
	) {}

	updateBrowserSession(session: BrowserSession): void {
		this.browserSession = session;
	}

	needsBrowserLaunch(actionName: string): boolean {
		return BROWSER_LAUNCH_ACTIONS.has(actionName);
	}

	/**
	 * Convert a normalized CU coordinate pair to pixel values.
	 */
	private toPixels(
		args: Record<string, unknown>,
		xKey: string = "x",
		yKey: string = "y",
	): { px: number; py: number } {
		const rawX = Number(args[xKey]);
		const rawY = Number(args[yKey]);
		if (Number.isNaN(rawX) || Number.isNaN(rawY)) {
			throw new Error(
				`Invalid coordinates: ${xKey}=${args[xKey]}, ${yKey}=${args[yKey]}`,
			);
		}
		return {
			px: denormalizeCoordinate(rawX, this.viewportWidth),
			py: denormalizeCoordinate(rawY, this.viewportHeight),
		};
	}

	/**
	 * Click at a normalized coordinate and return the coordinate string used.
	 */
	private async clickAtCoords(
		args: Record<string, unknown>,
	): Promise<{ result: BrowserActionResult; coord: string }> {
		const { px, py } = this.toPixels(args);
		const coord = `${px},${py}`;
		const result = await this.browserSession.click(coord);
		return { result, coord };
	}

	/**
	 * Navigate in a given history direction (back or forward).
	 */
	private navigateHistory(
		direction: "back" | "forward",
	): Promise<BrowserActionResult> {
		const NAVIGATION_OPTIONS = {
			waitUntil: "domcontentloaded" as const,
			timeout: 7000,
		};
		return this.browserSession.doAction(async (page) => {
			if (direction === "back") {
				await page.goBack(NAVIGATION_OPTIONS);
			} else {
				await page.goForward(NAVIGATION_OPTIONS);
			}
		});
	}

	/** CU navigation timeout — longer than BrowserSession's 7s default. */
	private static readonly CU_NAV_TIMEOUT = 15_000;

	async executeAction(
		actionName: string,
		args: Record<string, unknown>,
	): Promise<BrowserActionResult> {
		if (!isComputerUseAction(actionName)) {
			throw new Error(`Unknown Computer Use action: ${actionName}`);
		}

		switch (actionName) {
			case "click_at": {
				// Use doAction directly instead of browserSession.click() to get a
				// longer navigation timeout (15s vs 7s). Login redirects and SPAs
				// often exceed the default 7s.
				const { px, py } = this.toPixels(args);
				return this.browserSession.doAction(async (page) => {
					let hasNetworkActivity = false;
					const requestListener = () => {
						hasNetworkActivity = true;
					};
					page.on("request", requestListener);

					await page.mouse.click(px, py);

					// Small delay to detect if click triggered network activity
					await new Promise((r) => setTimeout(r, 100));

					if (hasNetworkActivity) {
						await page
							.waitForNavigation({
								waitUntil: ["domcontentloaded", "networkidle2"],
								timeout: ComputerUseExecutor.CU_NAV_TIMEOUT,
							})
							.catch(() => {});
					}

					page.off("request", requestListener);
				});
			}

			case "type_text_at": {
				await this.clickAtCoords(args);
				return this.browserSession.type(String(args.text));
			}

			case "scroll_document": {
				return String(args.direction) === "up"
					? this.browserSession.scrollUp()
					: this.browserSession.scrollDown();
			}

			case "scroll_at": {
				const { px, py } = this.toPixels(args);
				const delta = Number(args.magnitude ?? 3) * 100;
				const dir = String(args.direction);
				const validDirections = ["up", "down", "left", "right"];
				if (!validDirections.includes(dir)) {
					throw new Error(
						`scroll_at: invalid direction '${dir}', expected one of: ${validDirections.join(", ")}`,
					);
				}
				return this.browserSession.doAction(async (page) => {
					await page.mouse.move(px, py);
					if (dir === "up" || dir === "down") {
						await page.mouse.wheel({
							deltaY: dir === "down" ? delta : -delta,
						});
					} else {
						await page.mouse.wheel({
							deltaX: dir === "right" ? delta : -delta,
						});
					}
				});
			}

			case "hover_at": {
				const { px, py } = this.toPixels(args);
				return this.browserSession.doAction(async (page) => {
					await page.mouse.move(px, py);
				});
			}

			case "key_combination": {
				// StreamResponseHandler stringifies all params, so keys may arrive as
				// a JSON string like '["Control","c"]' instead of an actual array.
				let rawKeys = args.keys;
				if (typeof rawKeys === "string") {
					try {
						rawKeys = JSON.parse(rawKeys);
					} catch {
						// Single key as plain string — wrap in array
						rawKeys = [rawKeys];
					}
				}
				if (!Array.isArray(rawKeys) || rawKeys.length === 0) {
					throw new Error("key_combination requires a non-empty 'keys' array");
				}
				const keys = rawKeys as KeyInput[];
				return this.browserSession.doAction(async (page) => {
					const modifiers = keys.slice(0, -1);
					const finalKey = keys[keys.length - 1];
					for (const mod of modifiers) {
						await page.keyboard.down(mod);
					}
					await page.keyboard.press(finalKey);
					for (const mod of [...modifiers].reverse()) {
						await page.keyboard.up(mod);
					}
				});
			}

			case "drag_and_drop": {
				const start = this.toPixels(args, "startX", "startY");
				const end = this.toPixels(args, "endX", "endY");
				return this.browserSession.doAction(async (page) => {
					await page.mouse.move(start.px, start.py);
					await page.mouse.down();
					await page.mouse.move(end.px, end.py, { steps: 10 });
					await page.mouse.up();
				});
			}

			case "navigate": {
				return this.browserSession.navigateToUrl(String(args.url));
			}

			case "go_back": {
				return this.navigateHistory("back");
			}

			case "go_forward": {
				return this.navigateHistory("forward");
			}

			case "open_web_browser": {
				return this.browserSession.navigateToUrl("about:blank");
			}

			case "search": {
				const query = String(args.query || "");
				return this.browserSession.navigateToUrl(
					`https://www.google.com/search?q=${encodeURIComponent(query)}`,
				);
			}

			case "wait_5_seconds": {
				await new Promise((r) => setTimeout(r, 5000));
				return this.browserSession.doAction(async () => {
					// No-op — just capture screenshot after wait
				});
			}

			default:
				throw new Error(`Unimplemented Computer Use action: ${actionName}`);
		}
	}
}

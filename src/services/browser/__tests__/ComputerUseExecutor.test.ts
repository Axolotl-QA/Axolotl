import type { BrowserActionResult } from "@shared/ExtensionMessage";
import { expect } from "chai";
import { afterEach, beforeEach, describe, it } from "mocha";
import * as sinon from "sinon";
import type { BrowserSession } from "../BrowserSession";
import { ComputerUseExecutor } from "../ComputerUseExecutor";

/**
 * Shape of the mock Page object exposed for test assertions.
 */
interface MockPage {
	mouse: {
		move: sinon.SinonStub;
		wheel: sinon.SinonStub;
		down: sinon.SinonStub;
		up: sinon.SinonStub;
	};
	keyboard: {
		down: sinon.SinonStub;
		press: sinon.SinonStub;
		up: sinon.SinonStub;
	};
	goBack: sinon.SinonStub;
	goForward: sinon.SinonStub;
}

interface MockBrowserSessionBundle {
	session: BrowserSession;
	mockPage: MockPage;
}

/**
 * Create a mock BrowserSession with sinon stubs for each public method.
 * Returns the session (cast as BrowserSession) and the underlying mock page
 * separately so tests can inspect page-level calls without type errors.
 */
function createMockBrowserSession(): MockBrowserSessionBundle {
	const defaultResult: BrowserActionResult = {
		screenshot: "data:image/png;base64,base64data",
		currentUrl: "http://example.com",
		logs: "",
	};

	const mockPage: MockPage = {
		mouse: {
			move: sinon.stub().resolves(),
			wheel: sinon.stub().resolves(),
			down: sinon.stub().resolves(),
			up: sinon.stub().resolves(),
		},
		keyboard: {
			down: sinon.stub().resolves(),
			press: sinon.stub().resolves(),
			up: sinon.stub().resolves(),
		},
		goBack: sinon.stub().resolves(),
		goForward: sinon.stub().resolves(),
	};

	const session = {
		click: sinon.stub().resolves({ ...defaultResult }),
		type: sinon.stub().resolves({ ...defaultResult }),
		scrollUp: sinon.stub().resolves({ ...defaultResult }),
		scrollDown: sinon.stub().resolves({ ...defaultResult }),
		navigateToUrl: sinon.stub().resolves({ ...defaultResult }),
		doAction: sinon
			.stub()
			.callsFake(async (fn: (page: unknown) => Promise<void>) => {
				await fn(mockPage);
				return { ...defaultResult };
			}),
	} as unknown as BrowserSession;

	return { session, mockPage };
}

// Viewport dimensions used across all tests.
const VIEWPORT_WIDTH = 1280;
const VIEWPORT_HEIGHT = 800;

describe("ComputerUseExecutor", () => {
	let executor: ComputerUseExecutor;
	let session: BrowserSession;
	let mockPage: MockPage;

	beforeEach(() => {
		const bundle = createMockBrowserSession();
		session = bundle.session;
		mockPage = bundle.mockPage;
		executor = new ComputerUseExecutor(
			session,
			VIEWPORT_WIDTH,
			VIEWPORT_HEIGHT,
		);
	});

	afterEach(() => {
		sinon.restore();
	});

	// ---------------------------------------------------------------
	// click_at
	// ---------------------------------------------------------------
	describe("click_at", () => {
		it("should convert normalized coordinates to pixels and call browserSession.click", async () => {
			const result = await executor.executeAction("click_at", {
				x: 500,
				y: 500,
			});

			// 500/1000 * 1280 = 640, 500/1000 * 800 = 400
			const clickStub = session.click as sinon.SinonStub;
			expect(clickStub.calledOnce).to.be.true;
			expect(clickStub.firstCall.args[0]).to.equal("640,400");
			expect(result).to.have.property("screenshot");
		});

		it("should handle edge coordinates (0, 0)", async () => {
			await executor.executeAction("click_at", { x: 0, y: 0 });

			const clickStub = session.click as sinon.SinonStub;
			expect(clickStub.firstCall.args[0]).to.equal("0,0");
		});

		it("should handle max coordinates (1000, 1000)", async () => {
			await executor.executeAction("click_at", { x: 1000, y: 1000 });

			const clickStub = session.click as sinon.SinonStub;
			// 1000/1000 * 1280 = 1280, 1000/1000 * 800 = 800
			expect(clickStub.firstCall.args[0]).to.equal("1280,800");
		});
	});

	// ---------------------------------------------------------------
	// type_text_at
	// ---------------------------------------------------------------
	describe("type_text_at", () => {
		it("should click first then type text", async () => {
			const result = await executor.executeAction("type_text_at", {
				x: 500,
				y: 500,
				text: "hello world",
			});

			const clickStub = session.click as sinon.SinonStub;
			const typeStub = session.type as sinon.SinonStub;

			expect(clickStub.calledOnce).to.be.true;
			expect(clickStub.firstCall.args[0]).to.equal("640,400");
			expect(typeStub.calledOnce).to.be.true;
			expect(typeStub.firstCall.args[0]).to.equal("hello world");

			// click should be called before type
			expect(clickStub.calledBefore(typeStub)).to.be.true;
			expect(result).to.have.property("screenshot");
		});
	});

	// ---------------------------------------------------------------
	// scroll_document
	// ---------------------------------------------------------------
	describe("scroll_document", () => {
		it("should call scrollUp for direction 'up'", async () => {
			await executor.executeAction("scroll_document", { direction: "up" });

			const scrollUpStub = session.scrollUp as sinon.SinonStub;
			const scrollDownStub = session.scrollDown as sinon.SinonStub;

			expect(scrollUpStub.calledOnce).to.be.true;
			expect(scrollDownStub.called).to.be.false;
		});

		it("should call scrollDown for direction 'down'", async () => {
			await executor.executeAction("scroll_document", { direction: "down" });

			const scrollUpStub = session.scrollUp as sinon.SinonStub;
			const scrollDownStub = session.scrollDown as sinon.SinonStub;

			expect(scrollDownStub.calledOnce).to.be.true;
			expect(scrollUpStub.called).to.be.false;
		});

		it("should call scrollDown for any non-'up' direction", async () => {
			await executor.executeAction("scroll_document", { direction: "left" });

			const scrollDownStub = session.scrollDown as sinon.SinonStub;
			expect(scrollDownStub.calledOnce).to.be.true;
		});
	});

	// ---------------------------------------------------------------
	// scroll_at
	// ---------------------------------------------------------------
	describe("scroll_at", () => {
		it("should move mouse to position and scroll down with correct delta", async () => {
			await executor.executeAction("scroll_at", {
				x: 500,
				y: 500,
				direction: "down",
				magnitude: 3,
			});

			expect(mockPage.mouse.move.calledOnce).to.be.true;
			expect(mockPage.mouse.move.firstCall.args).to.deep.equal([640, 400]);
			expect(mockPage.mouse.wheel.calledOnce).to.be.true;
			expect(mockPage.mouse.wheel.firstCall.args[0]).to.deep.equal({
				deltaY: 300,
			});
		});

		it("should scroll up with negative deltaY", async () => {
			await executor.executeAction("scroll_at", {
				x: 500,
				y: 500,
				direction: "up",
				magnitude: 2,
			});

			expect(mockPage.mouse.wheel.firstCall.args[0]).to.deep.equal({
				deltaY: -200,
			});
		});

		it("should scroll right with positive deltaX", async () => {
			await executor.executeAction("scroll_at", {
				x: 500,
				y: 500,
				direction: "right",
				magnitude: 1,
			});

			expect(mockPage.mouse.wheel.firstCall.args[0]).to.deep.equal({
				deltaX: 100,
			});
		});

		it("should scroll left with negative deltaX", async () => {
			await executor.executeAction("scroll_at", {
				x: 500,
				y: 500,
				direction: "left",
				magnitude: 1,
			});

			expect(mockPage.mouse.wheel.firstCall.args[0]).to.deep.equal({
				deltaX: -100,
			});
		});

		it("should default magnitude to 3 when not provided", async () => {
			await executor.executeAction("scroll_at", {
				x: 500,
				y: 500,
				direction: "down",
			});

			expect(mockPage.mouse.wheel.firstCall.args[0]).to.deep.equal({
				deltaY: 300,
			});
		});

		it("should throw error for invalid direction", async () => {
			try {
				await executor.executeAction("scroll_at", {
					x: 500,
					y: 500,
					direction: "diagonal",
				});
				expect.fail("Should have thrown an error");
			} catch (err: unknown) {
				expect((err as Error).message).to.include("invalid direction");
				expect((err as Error).message).to.include("diagonal");
			}
		});
	});

	// ---------------------------------------------------------------
	// hover_at
	// ---------------------------------------------------------------
	describe("hover_at", () => {
		it("should move mouse to the denormalized position", async () => {
			await executor.executeAction("hover_at", { x: 250, y: 750 });

			// 250/1000 * 1280 = 320, 750/1000 * 800 = 600
			expect(mockPage.mouse.move.calledOnce).to.be.true;
			expect(mockPage.mouse.move.firstCall.args).to.deep.equal([320, 600]);
		});
	});

	// ---------------------------------------------------------------
	// key_combination
	// ---------------------------------------------------------------
	describe("key_combination", () => {
		it("should press modifiers down, press final key, release modifiers in reverse", async () => {
			await executor.executeAction("key_combination", {
				keys: ["Control", "Shift", "a"],
			});

			const downCalls = mockPage.keyboard.down.getCalls();
			const pressCalls = mockPage.keyboard.press.getCalls();
			const upCalls = mockPage.keyboard.up.getCalls();

			// Modifiers pressed down in order
			expect(downCalls).to.have.length(2);
			expect(downCalls[0].args[0]).to.equal("Control");
			expect(downCalls[1].args[0]).to.equal("Shift");

			// Final key pressed
			expect(pressCalls).to.have.length(1);
			expect(pressCalls[0].args[0]).to.equal("a");

			// Modifiers released in reverse order
			expect(upCalls).to.have.length(2);
			expect(upCalls[0].args[0]).to.equal("Shift");
			expect(upCalls[1].args[0]).to.equal("Control");
		});

		it("should handle a single key (no modifiers)", async () => {
			await executor.executeAction("key_combination", {
				keys: ["Enter"],
			});

			expect(mockPage.keyboard.down.called).to.be.false;
			expect(mockPage.keyboard.press.calledOnce).to.be.true;
			expect(mockPage.keyboard.press.firstCall.args[0]).to.equal("Enter");
			expect(mockPage.keyboard.up.called).to.be.false;
		});

		it("should throw error when keys is not an array", async () => {
			try {
				await executor.executeAction("key_combination", {
					keys: "Enter",
				});
				expect.fail("Should have thrown an error");
			} catch (err: unknown) {
				expect((err as Error).message).to.include("non-empty 'keys' array");
			}
		});

		it("should throw error when keys is an empty array", async () => {
			try {
				await executor.executeAction("key_combination", {
					keys: [],
				});
				expect.fail("Should have thrown an error");
			} catch (err: unknown) {
				expect((err as Error).message).to.include("non-empty 'keys' array");
			}
		});
	});

	// ---------------------------------------------------------------
	// drag_and_drop
	// ---------------------------------------------------------------
	describe("drag_and_drop", () => {
		it("should move to start, mouse down, move to end with steps, mouse up", async () => {
			await executor.executeAction("drag_and_drop", {
				startX: 100,
				startY: 200,
				endX: 800,
				endY: 600,
			});

			const moveCalls = mockPage.mouse.move.getCalls();

			// start: 100/1000*1280=128, 200/1000*800=160
			// end:   800/1000*1280=1024, 600/1000*800=480
			expect(moveCalls[0].args).to.deep.equal([128, 160]);
			expect(mockPage.mouse.down.calledOnce).to.be.true;
			expect(moveCalls[1].args[0]).to.equal(1024);
			expect(moveCalls[1].args[1]).to.equal(480);
			expect(moveCalls[1].args[2]).to.deep.equal({ steps: 10 });
			expect(mockPage.mouse.up.calledOnce).to.be.true;
		});
	});

	// ---------------------------------------------------------------
	// navigate
	// ---------------------------------------------------------------
	describe("navigate", () => {
		it("should call navigateToUrl with the provided URL", async () => {
			await executor.executeAction("navigate", { url: "https://example.com" });

			const navStub = session.navigateToUrl as sinon.SinonStub;
			expect(navStub.calledOnce).to.be.true;
			expect(navStub.firstCall.args[0]).to.equal("https://example.com");
		});
	});

	// ---------------------------------------------------------------
	// go_back / go_forward
	// ---------------------------------------------------------------
	describe("go_back", () => {
		it("should call page.goBack via doAction", async () => {
			await executor.executeAction("go_back", {});

			expect(mockPage.goBack.calledOnce).to.be.true;
		});
	});

	describe("go_forward", () => {
		it("should call page.goForward via doAction", async () => {
			await executor.executeAction("go_forward", {});

			expect(mockPage.goForward.calledOnce).to.be.true;
		});
	});

	// ---------------------------------------------------------------
	// open_web_browser
	// ---------------------------------------------------------------
	describe("open_web_browser", () => {
		it("should navigate to about:blank", async () => {
			await executor.executeAction("open_web_browser", {});

			const navStub = session.navigateToUrl as sinon.SinonStub;
			expect(navStub.calledOnce).to.be.true;
			expect(navStub.firstCall.args[0]).to.equal("about:blank");
		});
	});

	// ---------------------------------------------------------------
	// search
	// ---------------------------------------------------------------
	describe("search", () => {
		it("should navigate to Google with encoded query", async () => {
			await executor.executeAction("search", { query: "hello world" });

			const navStub = session.navigateToUrl as sinon.SinonStub;
			expect(navStub.calledOnce).to.be.true;
			expect(navStub.firstCall.args[0]).to.equal(
				"https://www.google.com/search?q=hello%20world",
			);
		});

		it("should handle special characters in query", async () => {
			await executor.executeAction("search", {
				query: "c++ tutorial & tricks",
			});

			const navStub = session.navigateToUrl as sinon.SinonStub;
			expect(navStub.firstCall.args[0]).to.equal(
				`https://www.google.com/search?q=${encodeURIComponent("c++ tutorial & tricks")}`,
			);
		});

		it("should handle empty query", async () => {
			await executor.executeAction("search", {});

			const navStub = session.navigateToUrl as sinon.SinonStub;
			expect(navStub.firstCall.args[0]).to.equal(
				"https://www.google.com/search?q=",
			);
		});
	});

	// ---------------------------------------------------------------
	// wait_5_seconds
	// ---------------------------------------------------------------
	describe("wait_5_seconds", () => {
		let clock: sinon.SinonFakeTimers;

		beforeEach(() => {
			clock = sinon.useFakeTimers();
		});

		afterEach(() => {
			clock.restore();
		});

		it("should wait 5 seconds then call doAction for screenshot", async () => {
			const doActionStub = session.doAction as sinon.SinonStub;

			const promise = executor.executeAction("wait_5_seconds", {});

			// The setTimeout inside wait_5_seconds should be pending
			expect(doActionStub.called).to.be.false;

			// Advance time by 5 seconds
			await clock.tickAsync(5000);

			const result = await promise;
			expect(doActionStub.calledOnce).to.be.true;
			expect(result).to.have.property("screenshot");
		});
	});

	// ---------------------------------------------------------------
	// unknown action
	// ---------------------------------------------------------------
	describe("unknown action", () => {
		it("should throw Error for an unknown action name", async () => {
			try {
				await executor.executeAction("nonexistent_action", {});
				expect.fail("Should have thrown an error");
			} catch (err: unknown) {
				expect((err as Error).message).to.include(
					"Unknown Computer Use action",
				);
				expect((err as Error).message).to.include("nonexistent_action");
			}
		});
	});

	// ---------------------------------------------------------------
	// Validation tests
	// ---------------------------------------------------------------
	describe("validation", () => {
		it("should throw error for NaN coordinates", async () => {
			try {
				await executor.executeAction("click_at", { x: "abc", y: 500 });
				expect.fail("Should have thrown an error");
			} catch (err: unknown) {
				expect((err as Error).message).to.include("Invalid coordinates");
			}
		});

		it("should throw error for undefined coordinates", async () => {
			try {
				await executor.executeAction("click_at", {
					x: undefined,
					y: undefined,
				});
				expect.fail("Should have thrown an error");
			} catch (err: unknown) {
				expect((err as Error).message).to.include("Invalid coordinates");
			}
		});

		it("should throw error for missing coordinates", async () => {
			try {
				await executor.executeAction("click_at", {});
				expect.fail("Should have thrown an error");
			} catch (err: unknown) {
				expect((err as Error).message).to.include("Invalid coordinates");
			}
		});
	});

	// ---------------------------------------------------------------
	// needsBrowserLaunch
	// ---------------------------------------------------------------
	describe("needsBrowserLaunch", () => {
		it("should return true for navigate", () => {
			expect(executor.needsBrowserLaunch("navigate")).to.be.true;
		});

		it("should return true for open_web_browser", () => {
			expect(executor.needsBrowserLaunch("open_web_browser")).to.be.true;
		});

		it("should return true for search", () => {
			expect(executor.needsBrowserLaunch("search")).to.be.true;
		});

		it("should return false for click_at", () => {
			expect(executor.needsBrowserLaunch("click_at")).to.be.false;
		});

		it("should return false for unknown actions", () => {
			expect(executor.needsBrowserLaunch("unknown")).to.be.false;
		});
	});

	// ---------------------------------------------------------------
	// updateBrowserSession
	// ---------------------------------------------------------------
	describe("updateBrowserSession", () => {
		it("should replace the browser session and use the new one for subsequent calls", async () => {
			const newBundle = createMockBrowserSession();
			executor.updateBrowserSession(newBundle.session);

			await executor.executeAction("click_at", { x: 500, y: 500 });

			// Old session should NOT have been called
			const oldClickStub = session.click as sinon.SinonStub;
			expect(oldClickStub.called).to.be.false;

			// New session should have been called
			const newClickStub = newBundle.session.click as sinon.SinonStub;
			expect(newClickStub.calledOnce).to.be.true;
		});
	});
});

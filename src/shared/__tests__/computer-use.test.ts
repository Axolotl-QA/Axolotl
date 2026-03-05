import { expect } from "chai";
import { describe, it } from "mocha";
import {
	BROWSER_LAUNCH_ACTIONS,
	COMPUTER_USE_ACTIONS,
	denormalizeCoordinate,
	isComputerUseAction,
} from "../computer-use";

describe("computer-use", () => {
	describe("COMPUTER_USE_ACTIONS", () => {
		it("should contain exactly 13 actions", () => {
			expect(COMPUTER_USE_ACTIONS.size).to.equal(13);
		});

		it("should contain all expected action names", () => {
			const expectedActions = [
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
			];

			for (const action of expectedActions) {
				expect(COMPUTER_USE_ACTIONS.has(action)).to.be.true;
			}
		});
	});

	describe("BROWSER_LAUNCH_ACTIONS", () => {
		it("should contain exactly 3 actions", () => {
			expect(BROWSER_LAUNCH_ACTIONS.size).to.equal(3);
		});

		it("should contain navigate, open_web_browser, and search", () => {
			expect(BROWSER_LAUNCH_ACTIONS.has("navigate")).to.be.true;
			expect(BROWSER_LAUNCH_ACTIONS.has("open_web_browser")).to.be.true;
			expect(BROWSER_LAUNCH_ACTIONS.has("search")).to.be.true;
		});

		it("should be a subset of COMPUTER_USE_ACTIONS", () => {
			for (const action of BROWSER_LAUNCH_ACTIONS) {
				expect(COMPUTER_USE_ACTIONS.has(action)).to.be.true;
			}
		});
	});

	describe("isComputerUseAction", () => {
		it("should return true for all 13 valid CU actions", () => {
			const validActions = [
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
			];

			for (const action of validActions) {
				expect(isComputerUseAction(action)).to.be.true;
			}
		});

		it('should return false for "browser_action"', () => {
			expect(isComputerUseAction("browser_action")).to.be.false;
		});

		it('should return false for "read_file"', () => {
			expect(isComputerUseAction("read_file")).to.be.false;
		});

		it('should return false for "unknown"', () => {
			expect(isComputerUseAction("unknown")).to.be.false;
		});

		it("should return false for empty string", () => {
			expect(isComputerUseAction("")).to.be.false;
		});
	});

	describe("denormalizeCoordinate", () => {
		it("should return 0 when normalized is 0 regardless of dimension", () => {
			expect(denormalizeCoordinate(0, 900)).to.equal(0);
			expect(denormalizeCoordinate(0, 600)).to.equal(0);
			expect(denormalizeCoordinate(0, 1920)).to.equal(0);
		});

		it("should return the full dimension when normalized is 1000", () => {
			expect(denormalizeCoordinate(1000, 900)).to.equal(900);
			expect(denormalizeCoordinate(1000, 600)).to.equal(600);
			expect(denormalizeCoordinate(1000, 1920)).to.equal(1920);
		});

		it("should return the midpoint when normalized is 500", () => {
			// (500 / 1000) * 900 = 450
			expect(denormalizeCoordinate(500, 900)).to.equal(450);
			// (500 / 1000) * 600 = 300
			expect(denormalizeCoordinate(500, 600)).to.equal(300);
		});

		it("should round correctly for non-integer results", () => {
			// (333 / 1000) * 600 = 199.8 → rounds to 200
			expect(denormalizeCoordinate(333, 600)).to.equal(200);
			// (333 / 1000) * 900 = 299.7 → rounds to 300
			expect(denormalizeCoordinate(333, 900)).to.equal(300);
		});

		it("should handle very small normalized values", () => {
			// (1 / 1000) * 1920 = 1.92 → rounds to 2
			expect(denormalizeCoordinate(1, 1920)).to.equal(2);
			// (1 / 1000) * 600 = 0.6 → rounds to 1
			expect(denormalizeCoordinate(1, 600)).to.equal(1);
		});

		it("should handle large normalized values beyond the standard range", () => {
			// (1500 / 1000) * 800 = 1200
			expect(denormalizeCoordinate(1500, 800)).to.equal(1200);
		});
	});
});

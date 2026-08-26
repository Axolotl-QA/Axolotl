import { retryOperation } from "./retry"

describe("retryOperation session refresh", () => {
	it("returns the refreshed session when the first attempt succeeds", async () => {
		const refreshSession = jest.fn().mockResolvedValue("fresh-access-token")

		await expect(retryOperation(3, 1_000, refreshSession)).resolves.toBe("fresh-access-token")
		expect(refreshSession).toHaveBeenCalledTimes(1)
	})
})

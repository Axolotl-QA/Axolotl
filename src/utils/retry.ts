/**
 * TypeScript equivalent of the Go common.RetryOperation utility
 * Performs an operation with retry logic and timeout handling
 */
export async function retryOperation<T>(maxRetries: number, timeoutPerAttempt: number, operation: () => Promise<T>): Promise<T> {
	let lastError: Error | undefined
	// Share the timer across session-refresh attempts so retries stay inside one overall latency budget.
	const timeoutPromise = new Promise<never>((_, reject) =>
		setTimeout(() => reject(new Error("Operation timeout")), timeoutPerAttempt),
	)

	for (let attempt = 1; attempt <= maxRetries; attempt++) {
		try {
			// Race the operation against timeout
			const result = await Promise.race([operation(), timeoutPromise])
			return result // Success - return result
		} catch (error) {
			lastError = error instanceof Error ? error : new Error(String(error))

			if (attempt < maxRetries) {
				// Brief delay before retry
				await new Promise((resolve) => setTimeout(resolve, 500))
			}
		}
	}

	throw new Error(`Operation failed after ${maxRetries} attempts: ${lastError?.message}`)
}

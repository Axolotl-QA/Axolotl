/**
 * List of email domains that are considered trusted testers for Axolotl.
 */
const AXOLOTL_TRUSTED_TESTER_DOMAINS = ["fibilabs.tech"]

/**
 * Checks if the given email belongs to an Axolotl internal user.
 * E.g. Emails ending with @qaxolotl.com
 */
export function isAxolotlInternalUser(email: string): boolean {
	return email.endsWith("@qaxolotl.com")
}

export function isAxolotlInternalTester(email: string): boolean {
	return isAxolotlInternalUser(email) || AXOLOTL_TRUSTED_TESTER_DOMAINS.some((d) => email.endsWith(`@${d}`))
}

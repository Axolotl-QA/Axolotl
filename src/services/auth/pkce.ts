import { createHash, randomBytes } from "crypto"

const BASE64_URL_REGEX = /\+/g
const BASE64_URL_SLASH_REGEX = /\//g
const BASE64_URL_PADDING_REGEX = /=+$/g

const base64UrlEncode = (buffer: Buffer): string =>
	buffer
		.toString("base64")
		.replace(BASE64_URL_REGEX, "-")
		.replace(BASE64_URL_SLASH_REGEX, "_")
		.replace(BASE64_URL_PADDING_REGEX, "")

export const generateAuthState = (): string => base64UrlEncode(randomBytes(16))

export const generateCodeVerifier = (): string => base64UrlEncode(randomBytes(32))

export const generateCodeChallenge = (verifier: string): string => {
	const hash = createHash("sha256").update(verifier).digest()
	return base64UrlEncode(hash)
}

import type { JwtPayload } from "jwt-decode";
import { ClineEnv, type EnvironmentConfig } from "@/config";
import type { Controller } from "@/core/controller";
import {
	AuthInvalidTokenError,
	AuthNetworkError,
} from "@/services/error/ClineError";
import { Logger } from "@/services/logging/Logger";
import { telemetryService } from "@/services/telemetry";
import { fetch } from "@/shared/net";
import type { ClineAccountUserInfo, ClineAuthInfo } from "../AuthService";
import { parseJwtPayload } from "../oca/utils/utils";

// InsForge API response shapes
interface InsForgeUser {
	id: string;
	email: string;
	emailVerified?: boolean;
	providers?: string[];
	createdAt?: string;
	updatedAt?: string;
	role?: string;
}

interface InsForgeAuthResponse {
	user: InsForgeUser;
	accessToken: string;
	refreshToken?: string;
	redirectTo?: string;
}

interface InsForgeProfile {
	id: string;
	name?: string;
	avatar_url?: string;
	createdAt?: string;
	updatedAt?: string;
}

type TokenData = JwtPayload & {
	sid?: string;
	external_id?: string;
	exp?: number;
	email?: string;
};

export interface ClineAuthApiTokenExchangeResponse {
	success: boolean;
	data: {
		accessToken: string;
		refreshToken?: string;
		tokenType: string;
		expiresAt: string;
		userInfo: {
			subject: string | null;
			email: string;
			name: string;
			clineUserId: string | null;
			accounts: string[] | null;
		};
	};
}

export interface ClineAuthApiTokenRefreshResponse {
	success: boolean;
	data: {
		accessToken: string;
		refreshToken?: string;
		tokenType: string;
		expiresAt: string;
		userInfo: {
			subject: string | null;
			email: string;
			name: string;
			clineUserId: string | null;
			accounts: string[] | null;
		};
	};
}

export class ClineAuthProvider {
	readonly name = "cline";
	private refreshRetryCount = 0;
	private lastRefreshAttempt = 0;
	private readonly MAX_REFRESH_RETRIES = 3;
	private readonly RETRY_DELAY_MS = 30000; // 30 seconds

	get config(): EnvironmentConfig {
		return ClineEnv.config();
	}

	/**
	 * Checks if the access token needs to be refreshed (expired or about to expire).
	 * Since the new flow doesn't support refresh tokens, this will return true if token is expired.
	 * @param _refreshToken - The existing refresh token to check.
	 * @returns {Promise<boolean>} True if the token is expired or about to expire.
	 */
	async shouldRefreshIdToken(
		_refreshToken: string,
		expiresAt?: number,
	): Promise<boolean> {
		try {
			// expiresAt is in seconds
			const expirationTime = expiresAt || 0;
			const currentTime = Date.now() / 1000;
			const next5Min = currentTime + 5 * 60;

			// Check if token is expired or will expire in the next 5 minutes
			return expirationTime < next5Min; // Access token is expired or about to expire
		} catch (error) {
			Logger.error("Error checking token expiration:", error);
			return true; // If we can't decode the token, assume it needs refresh
		}
	}

	/**
	 * Returns the time in seconds until token expiry
	 */
	timeUntilExpiry(jwt: string): number {
		const data = this.extractTokenData(jwt);
		if (!data.exp) {
			return 0;
		}

		const currentTime = Date.now() / 1000;
		const expirationTime = data.exp;

		return expirationTime - currentTime;
	}

	private clearSession(
		controller: Controller,
		reason: string,
		storedAuthData?: ClineAuthInfo,
	) {
		Logger.error(reason);

		const startedAt = storedAuthData?.startedAt;
		const timeSinceStarted = Date.now() - (startedAt || 0);

		const tokenData = this.extractTokenData(storedAuthData?.idToken);
		telemetryService.capture({
			event: "extension_logging_user_out",
			properties: {
				reason,
				time_since_started: timeSinceStarted,
				session_id: tokenData.sid,
				user_id: tokenData.external_id,
			},
		});

		controller.stateManager.setSecret("cline:clineAccountId", undefined);
		this.refreshRetryCount = 0;
		this.lastRefreshAttempt = 0;
		return null;
	}

	private logFailedRefreshAttempt(
		response: Response,
		storedAuthData?: ClineAuthInfo,
	) {
		const startedAt = storedAuthData?.startedAt;
		const timeSinceStarted = Date.now() - (startedAt || 0);

		const tokenData = this.extractTokenData(storedAuthData?.idToken);
		telemetryService.capture({
			event: "extension_refresh_attempt_failed",
			properties: {
				status_code: response.status,
				request_id: response.headers.get("x-request-id"),
				session_id: tokenData.sid,
				user_id: tokenData.external_id,
				time_since_started: timeSinceStarted,
			},
		});
	}

	private extractTokenData(token: string | undefined): Partial<TokenData> {
		if (!token) {
			return {};
		}

		return parseJwtPayload<TokenData>(token) || {};
	}

	/**
	 * Retrieves Cline auth info using the stored access token.
	 * @param controller - The controller instance to access stored secrets.
	 * @returns {Promise<ClineAuthInfo | null>} A promise that resolves with the auth info or null.
	 */
	async retrieveClineAuthInfo(
		controller: Controller,
	): Promise<ClineAuthInfo | null> {
		try {
			// Get the stored auth data from secure storage
			const storedAuthDataString = controller.stateManager.getSecretKey(
				"cline:clineAccountId",
			);

			if (!storedAuthDataString) {
				Logger.debug("No stored authentication data found");
				// Reset retry count when there's no stored auth
				this.refreshRetryCount = 0;
				this.lastRefreshAttempt = 0;
				return null;
			}

			// Parse the stored auth data
			let storedAuthData: ClineAuthInfo;
			try {
				storedAuthData = JSON.parse(storedAuthDataString);
			} catch (e) {
				Logger.error("Failed to parse stored auth data:", e);
				return this.clearSession(
					controller,
					"Failed to parse stored auth data",
				);
			}

			if (!storedAuthData?.idToken) {
				return this.clearSession(
					controller,
					"No ID token found in store",
					storedAuthData,
				);
			}

			if (
				await this.shouldRefreshIdToken(
					storedAuthData.refreshToken || "",
					storedAuthData.expiresAt,
				)
			) {
				// If no refresh token available, return stored data as-is (will re-auth on expiry)
				if (!storedAuthData.refreshToken) {
					return storedAuthData;
				}
				// If the token hasn't expired yet,
				// and it failed the first refresh attempt
				// with something other than invalid token
				// continue with the request
				if (
					this.refreshRetryCount > 0 &&
					this.timeUntilExpiry(storedAuthData.idToken) > 30
				) {
					this.refreshRetryCount = 0;
					this.lastRefreshAttempt = 0;
					return storedAuthData;
				}

				// Check if we need to wait before retrying
				const now = Date.now();
				const timeSinceLastAttempt = now - this.lastRefreshAttempt;
				if (
					timeSinceLastAttempt < this.RETRY_DELAY_MS &&
					this.refreshRetryCount > 0
				) {
					Logger.debug(
						`Waiting ${Math.ceil((this.RETRY_DELAY_MS - timeSinceLastAttempt) / 1000)}s before retry attempt ${this.refreshRetryCount + 1}/${this.MAX_REFRESH_RETRIES}`,
					);
					return null;
				}

				// Check if we've exceeded max retries
				if (this.refreshRetryCount >= this.MAX_REFRESH_RETRIES) {
					Logger.error(
						`Max refresh retries (${this.MAX_REFRESH_RETRIES}) exceeded.`,
					);
					// Don't clear session - return stored data and let API request fail later
					return storedAuthData;
				}

				// Try to refresh the token using the refresh token
				this.refreshRetryCount++;
				this.lastRefreshAttempt = now;
				Logger.debug(
					`Token expired or expiring soon, attempting refresh (attempt ${this.refreshRetryCount}/${this.MAX_REFRESH_RETRIES}). API Base URL: ${this.config.apiBaseUrl}`,
				);

				try {
					const authInfo = await this.refreshToken(
						storedAuthData.refreshToken,
						storedAuthData,
					);
					const newAuthInfoString = JSON.stringify(authInfo);
					if (newAuthInfoString !== storedAuthDataString) {
						controller.stateManager.setSecret("clineAccountId", undefined); // cleanup old key
						controller.stateManager.setSecret(
							"cline:clineAccountId",
							newAuthInfoString,
						);
					}
					// Reset retry count on success
					this.refreshRetryCount = 0;
					this.lastRefreshAttempt = 0;
					Logger.debug("Token refresh successful");
					return authInfo || null;
				} catch (refreshError) {
					Logger.error(
						`Token refresh failed (attempt ${this.refreshRetryCount}/${this.MAX_REFRESH_RETRIES}):`,
						refreshError,
					);

					// If it's an invalid token error, clear immediately and don't retry
					if (refreshError instanceof AuthInvalidTokenError) {
						this.clearSession(
							controller,
							"Invalid or expired refresh token. Clearing auth state.",
							storedAuthData,
						);

						throw refreshError;
					}

					// For network errors, return stored data - let the API request fail later
					// when the user actually tries to use Cline, not at startup
					return storedAuthData;
				}
			}

			// Token is still valid and not expired, reset retry count
			this.refreshRetryCount = 0;
			this.lastRefreshAttempt = 0;

			// Is the token valid?
			if (storedAuthData.idToken && storedAuthData.userInfo.id) {
				return storedAuthData;
			}

			// Verify the token structure
			const tokenParts = storedAuthData.idToken.split(".");
			if (tokenParts.length !== 3) {
				throw new Error("Invalid token format");
			}

			// Decode the token to verify it's a valid JWT
			const payload = JSON.parse(
				Buffer.from(tokenParts[1], "base64").toString("utf-8"),
			);
			if (payload.external_id) {
				storedAuthData.userInfo.id = payload.external_id;
			}
			return storedAuthData;
		} catch (error) {
			Logger.error("Authentication failed with stored credential:", error);
			// Reset retry count on unexpected errors
			if (!(error instanceof AuthInvalidTokenError)) {
				this.refreshRetryCount = 0;
				this.lastRefreshAttempt = 0;
			}
			return null;
		}
	}

	/**
	 * Refreshes an access token using a refresh token.
	 * @param refreshToken - The refresh token.
	 * @returns {Promise<ClineAuthInfo>} The new access token and user info.
	 */
	async refreshToken(
		refreshToken: string,
		storedData: ClineAuthInfo,
	): Promise<ClineAuthInfo> {
		try {
			const endpoint = new URL("/api/auth/refresh", this.config.apiBaseUrl);
			endpoint.searchParams.set("client_type", "desktop");

			const response = await fetch(endpoint.toString(), {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ refreshToken: storedData.refreshToken }),
			});

			if (!response.ok) {
				this.logFailedRefreshAttempt(response, storedData);

				// 400/401 = Invalid/expired token (permanent failure)
				if (response.status === 400 || response.status === 401) {
					const errorData = await response.json().catch(() => ({}));
					const errorMessage =
						errorData?.message ||
						errorData?.error ||
						"Invalid or expired token";
					throw new AuthInvalidTokenError(errorMessage);
				}
				// 5xx, 429, network errors = transient failures
				const errorData = await response.json().catch(() => ({}));
				throw new AuthNetworkError(`status: ${response.status}`, errorData);
			}

			const data: InsForgeAuthResponse = await response.json();

			if (!data.accessToken || !data.user) {
				throw new Error("Failed to refresh access token");
			}

			// Extract expiry from JWT payload
			const tokenPayload = parseJwtPayload<TokenData>(data.accessToken) || {};
			const expiresAt = tokenPayload.exp || Date.now() / 1000 + 15 * 60;

			// Fetch profile for display name
			const profileName = await this.fetchInsForgeProfileName(
				data.accessToken,
				data.user.id,
			);

			const userInfo: ClineAccountUserInfo = {
				id: data.user.id,
				email: data.user.email,
				displayName: profileName || data.user.email,
				createdAt:
					data.user.createdAt ||
					storedData.userInfo?.createdAt ||
					new Date().toISOString(),
				organizations: [],
			};

			return {
				idToken: data.accessToken,
				expiresAt,
				refreshToken: data.refreshToken || refreshToken,
				userInfo,
				provider: this.name,
				startedAt: storedData.startedAt || Date.now(),
			};
		} catch (error: any) {
			// Network errors (ECONNREFUSED, timeout, etc)
			if (
				error.name === "TypeError" ||
				error.code === "ECONNREFUSED" ||
				error.code === "ETIMEDOUT"
			) {
				throw new AuthNetworkError("Network error during token refresh", error);
			}
			throw error;
		}
	}

	async getAuthRequest(
		callbackUrl: string,
		options?: {
			state?: string;
			codeChallenge?: string;
			codeChallengeMethod?: string;
		},
	): Promise<string> {
		// Redirect to custom login page on qaxolotl.com
		const loginUrl = new URL("/login", this.config.appBaseUrl);
		loginUrl.searchParams.set("redirect", callbackUrl);
		if (options?.codeChallenge) {
			loginUrl.searchParams.set("code_challenge", options.codeChallenge);
		}
		return loginUrl.toString();
	}

	async signIn(
		controller: Controller,
		authorizationCode: string,
		codeVerifier?: string,
		refreshToken?: string,
	): Promise<ClineAuthInfo | null> {
		try {
			// If the auth code is already a JWT (starts with "eyJ"), it's a direct access token
			// from the custom login page or InsForge — no exchange needed
			if (authorizationCode.startsWith("eyJ")) {
				return this.handleDirectToken(
					controller,
					authorizationCode,
					refreshToken,
				);
			}

			// Otherwise, exchange the InsForge authorization code for tokens
			const exchangeUrl = new URL(
				"/api/auth/oauth/exchange",
				this.config.apiBaseUrl,
			);
			exchangeUrl.searchParams.set("client_type", "desktop");

			const response = await fetch(exchangeUrl.toString(), {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					code: authorizationCode,
					code_verifier: codeVerifier,
				}),
			});

			if (!response.ok) {
				const errorData = await response.json().catch(() => ({}));
				throw new Error(
					errorData.message ||
						"Failed to exchange authorization code for tokens",
				);
			}

			const data: InsForgeAuthResponse = await response.json();

			if (!data.accessToken || !data.user) {
				throw new Error("Invalid token response from InsForge");
			}

			// Extract expiry from JWT payload
			const tokenPayload = parseJwtPayload<TokenData>(data.accessToken) || {};
			const expiresAt = tokenPayload.exp || Date.now() / 1000 + 15 * 60;

			// Fetch profile for display name
			const profileName = await this.fetchInsForgeProfileName(
				data.accessToken,
				data.user.id,
			);

			const userInfo: ClineAccountUserInfo = {
				id: data.user.id,
				email: data.user.email,
				displayName: profileName || data.user.email,
				createdAt: data.user.createdAt || new Date().toISOString(),
				organizations: [],
			};

			const clineAuthInfo: ClineAuthInfo = {
				idToken: data.accessToken,
				refreshToken: data.refreshToken,
				userInfo,
				expiresAt,
				provider: this.name,
				startedAt: Date.now(),
			};

			controller.stateManager.setSecret(
				"cline:clineAccountId",
				JSON.stringify(clineAuthInfo),
			);

			return clineAuthInfo;
		} catch (error) {
			Logger.error("Error handling auth callback:", error);
			throw error;
		}
	}

	/**
	 * Handle a direct access token from the custom login page.
	 * The login page returns access_token and optionally refresh_token in the callback URL.
	 */
	private async handleDirectToken(
		controller: Controller,
		accessToken: string,
		refreshToken?: string,
	): Promise<ClineAuthInfo> {
		const tokenPayload = parseJwtPayload<TokenData>(accessToken) || {};
		const expiresAt = tokenPayload.exp || Date.now() / 1000 + 15 * 60;
		const userId = tokenPayload.sub || "";
		const email = tokenPayload.email || "";

		// Fetch profile for display name
		const profileName = userId
			? await this.fetchInsForgeProfileName(accessToken, userId)
			: null;

		const userInfo: ClineAccountUserInfo = {
			id: userId,
			email,
			displayName: profileName || email,
			createdAt: new Date().toISOString(),
			organizations: [],
		};

		const clineAuthInfo: ClineAuthInfo = {
			idToken: accessToken,
			refreshToken: refreshToken || undefined,
			userInfo,
			expiresAt,
			provider: this.name,
			startedAt: Date.now(),
		};

		controller.stateManager.setSecret(
			"cline:clineAccountId",
			JSON.stringify(clineAuthInfo),
		);

		return clineAuthInfo;
	}

	private async fetchInsForgeProfileName(
		accessToken: string,
		userId: string,
	): Promise<string | null> {
		try {
			const profileUrl = new URL(
				`/api/auth/profiles/${userId}`,
				this.config.apiBaseUrl,
			);
			const res = await fetch(profileUrl.toString(), {
				headers: { Authorization: `Bearer ${accessToken}` },
			});
			if (!res.ok) return null;
			const data: InsForgeProfile = await res.json();
			return data?.name || null;
		} catch {
			return null;
		}
	}
}

enum CLINE_API_AUTH_ENDPOINTS {
	AUTH = "/v1/auth/authorize",
	REFRESH_TOKEN = "/v1/auth/refresh",
}

enum CLINE_API_ENDPOINT_V1 {
	TOKEN_EXCHANGE = "/v1/auth/token",
	USER_INFO = "/v1/me",
	ACTIVE_ACCOUNT = "/api/v1/users/active-account",
	REMOTE_CONFIG = "/api/v1/organizations/{id}/remote-config",
	API_KEYS = "/api/v1/organizations/{id}/api-keys",
}

export const CLINE_API_ENDPOINT = {
	...CLINE_API_AUTH_ENDPOINTS,
	...CLINE_API_ENDPOINT_V1,
}

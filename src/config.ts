export enum Environment {
	production = "production",
	staging = "staging",
	local = "local",
}

export interface EnvironmentConfig {
	environment: Environment;
	appBaseUrl: string;
	apiBaseUrl: string;
	mcpBaseUrl: string;
}

class ClineEndpoint {
	public static instance = new ClineEndpoint();
	public static get config() {
		return ClineEndpoint.instance.config();
	}

	private environment: Environment = Environment.production;

	private constructor() {
		// Set environment at module load. Use override if provided.
		const _env =
			process?.env?.CLINE_ENVIRONMENT_OVERRIDE ||
			process?.env?.CLINE_ENVIRONMENT;
		if (_env && Object.values(Environment).includes(_env as Environment)) {
			this.environment = _env as Environment;
			return;
		}
	}

	public config(): EnvironmentConfig {
		return this.getEnvironment();
	}

	public setEnvironment(env: string) {
		switch (env.toLowerCase()) {
			case "staging":
				this.environment = Environment.staging;
				break;
			case "local":
				this.environment = Environment.local;
				break;
			default:
				this.environment = Environment.production;
				break;
		}
		console.info("Cline environment updated: ", this.environment);
	}

	public getEnvironment(): EnvironmentConfig {
		const envAppBaseUrl = process?.env?.AXOLOTL_APP_BASE_URL;
		const envApiBaseUrl = process?.env?.AXOLOTL_API_BASE_URL;
		switch (this.environment) {
			case Environment.staging:
				return {
					environment: Environment.staging,
					appBaseUrl: envAppBaseUrl || "https://staging-app.cline.bot",
					apiBaseUrl: envApiBaseUrl || "https://core-api.staging.int.cline.bot",
					mcpBaseUrl: "https://core-api.staging.int.cline.bot/v1/mcp",
				};
			case Environment.local:
				return {
					environment: Environment.local,
					appBaseUrl: envAppBaseUrl || "https://4zxsfry3.us-west.insforge.app",
					apiBaseUrl: envApiBaseUrl || "https://4zxsfry3.us-west.insforge.app",
					mcpBaseUrl: "https://4zxsfry3.us-west.insforge.app/v1/mcp",
				};
			default:
				return {
					environment: Environment.production,
					appBaseUrl: envAppBaseUrl || "https://qaxolotl.com",
					apiBaseUrl: envApiBaseUrl || "https://4zxsfry3.us-west.insforge.app",
					mcpBaseUrl: "https://4zxsfry3.us-west.insforge.app/v1/mcp",
				};
		}
	}
}

/**
 * Singleton instance to access the current environment configuration.
 * Usage:
 * - ClineEnv.config() to get the current config.
 * - ClineEnv.setEnvironment(Environment.local) to change the environment.
 */
export const ClineEnv = ClineEndpoint.instance;

import { VSCodeButton, VSCodeLink } from "@vscode/webview-ui-toolkit/react"
import { useClineSignIn } from "@/context/ClineAuthContext"
import { useExtensionState } from "@/context/ExtensionStateContext"
import AxolotlLogo from "@/assets/AxolotlLogo"

/**
 * Full-screen auth gate shown when the user is not logged in.
 * Blocks access to the main UI until the user signs in.
 * After successful login, ClineAuthContext updates clineUser,
 * and App.tsx re-renders to show the main ChatView.
 */
export const AuthGateView = () => {
	const { environment } = useExtensionState()
	const { isLoginLoading, handleSignIn } = useClineSignIn()

	return (
		<div className="fixed inset-0 flex flex-col items-center justify-center px-8">
			<div className="flex flex-col items-center gap-4 max-w-sm w-full">
				<AxolotlLogo className="size-20 mb-2" environment={environment} />

				<h2 className="text-lg font-semibold text-center m-0">Welcome to Axolotl</h2>

				<p className="text-center text-(--vscode-descriptionForeground) m-0">
					Please sign in to continue using Axolotl.
				</p>

				<VSCodeButton appearance="primary" className="w-full" disabled={isLoginLoading} onClick={handleSignIn}>
					Sign In
					{isLoginLoading && (
						<span className="ml-1 animate-spin">
							<span className="codicon codicon-refresh"></span>
						</span>
					)}
				</VSCodeButton>

				<VSCodeButton appearance="secondary" className="w-full" disabled={isLoginLoading} onClick={handleSignIn}>
					Create Account
					{isLoginLoading && (
						<span className="ml-1 animate-spin">
							<span className="codicon codicon-refresh"></span>
						</span>
					)}
				</VSCodeButton>

				<p className="text-(--vscode-descriptionForeground) text-xs text-center m-0 mt-2">
					By continuing, you agree to the <VSCodeLink href="https://cline.bot/tos">Terms of Service</VSCodeLink> and{" "}
					<VSCodeLink href="https://cline.bot/privacy">Privacy Policy.</VSCodeLink>
				</p>
			</div>
		</div>
	)
}

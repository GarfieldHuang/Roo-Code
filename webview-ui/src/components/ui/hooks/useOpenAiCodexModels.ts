import { useQuery } from "@tanstack/react-query"

import { type ModelRecord, type ExtensionMessage } from "@roo-code/types"

import { vscode } from "@src/utils/vscode"

const getOpenAiCodexModels = async () =>
	new Promise<ModelRecord>((resolve, reject) => {
		const cleanup = () => {
			window.removeEventListener("message", handler)
		}

		const timeout = setTimeout(() => {
			cleanup()
			reject(new Error("OpenAI Codex models request timed out"))
		}, 15000)

		const handler = (event: MessageEvent) => {
			const message: ExtensionMessage = event.data

			if (message.type === "openAiCodexModels") {
				clearTimeout(timeout)
				cleanup()

				if (message.openAiCodexModels) {
					resolve(message.openAiCodexModels)
				} else {
					reject(new Error(message.error || "No OpenAI Codex models in response"))
				}
			}
		}

		window.addEventListener("message", handler)
		vscode.postMessage({ type: "requestOpenAiCodexModels" })
	})

/**
 * Live ChatGPT Plus/Pro (Codex OAuth) model catalog. Callers fall back to the static
 * `openAiCodexModels` list while this is loading or when it fails (e.g. signed out).
 */
export const useOpenAiCodexModels = (enabled: boolean) =>
	useQuery({
		queryKey: ["openAiCodexModels"],
		queryFn: getOpenAiCodexModels,
		enabled,
		retry: false,
		staleTime: 5 * 60 * 1000,
	})

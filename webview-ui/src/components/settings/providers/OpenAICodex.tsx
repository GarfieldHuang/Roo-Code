import React, { useMemo } from "react"
import { VSCodeCheckbox } from "@vscode/webview-ui-toolkit/react"

import { type ModelInfo, type ProviderSettings, openAiCodexDefaultModelId, openAiCodexModels } from "@roo-code/types"

import { useAppTranslation } from "@src/i18n/TranslationContext"
import { Button } from "@src/components/ui"
import { vscode } from "@src/utils/vscode"
import { useOpenAiCodexModels } from "@src/components/ui/hooks/useOpenAiCodexModels"

import { ModelPicker } from "../ModelPicker"
import { OpenAICodexRateLimitDashboard } from "./OpenAICodexRateLimitDashboard"

interface OpenAICodexProps {
	apiConfiguration: ProviderSettings
	setApiConfigurationField: (field: keyof ProviderSettings, value: ProviderSettings[keyof ProviderSettings]) => void
	simplifySettings?: boolean
	openAiCodexIsAuthenticated?: boolean
}

export const OpenAICodex: React.FC<OpenAICodexProps> = ({
	apiConfiguration,
	setApiConfigurationField,
	simplifySettings,
	openAiCodexIsAuthenticated = false,
}) => {
	const { t } = useAppTranslation()
	const { data: liveModels } = useOpenAiCodexModels(openAiCodexIsAuthenticated)
	const selectedModelId = apiConfiguration.apiModelId

	// Prefer the live catalog from the Codex backend; keep the current selection listed even if it
	// has been retired so the picker does not silently show a different model.
	const models = useMemo<Record<string, ModelInfo>>(() => {
		const staticModels: Record<string, ModelInfo> = openAiCodexModels
		if (!liveModels || Object.keys(liveModels).length === 0) {
			return staticModels
		}
		if (selectedModelId && !liveModels[selectedModelId] && staticModels[selectedModelId]) {
			return { ...liveModels, [selectedModelId]: staticModels[selectedModelId] }
		}
		return liveModels
	}, [liveModels, selectedModelId])

	return (
		<div className="flex flex-col gap-4">
			{/* Authentication Section */}
			<div className="flex flex-col gap-2">
				{openAiCodexIsAuthenticated ? (
					<div className="flex justify-end">
						<Button
							variant="secondary"
							size="sm"
							onClick={() => vscode.postMessage({ type: "openAiCodexSignOut" })}>
							{t("settings:providers.openAiCodex.signOutButton", {
								defaultValue: "Sign Out",
							})}
						</Button>
					</div>
				) : (
					<Button
						variant="primary"
						onClick={() => vscode.postMessage({ type: "openAiCodexSignIn" })}
						className="w-fit">
						{t("settings:providers.openAiCodex.signInButton", {
							defaultValue: "Sign in to OpenAI Codex",
						})}
					</Button>
				)}
			</div>

			{/* Rate Limit Dashboard - only shown when authenticated */}
			<OpenAICodexRateLimitDashboard isAuthenticated={openAiCodexIsAuthenticated} />

			{/* Model Picker */}
			<ModelPicker
				apiConfiguration={apiConfiguration}
				setApiConfigurationField={setApiConfigurationField}
				defaultModelId={openAiCodexDefaultModelId}
				models={models}
				modelIdKey="apiModelId"
				serviceName="OpenAI - ChatGPT Plus/Pro"
				serviceUrl="https://chatgpt.com"
				simplifySettings={simplifySettings}
				hidePricing
			/>

			{/* Hosted tools run on the Codex backend; enabled unless explicitly turned off */}
			<div className="flex flex-col gap-3">
				<div>
					<VSCodeCheckbox
						checked={apiConfiguration.openAiCodexWebSearch !== false}
						onChange={(e: any) => setApiConfigurationField("openAiCodexWebSearch", e.target.checked)}>
						<span className="font-medium">{t("settings:providers.openAiCodex.webSearch")}</span>
					</VSCodeCheckbox>
					<div className="text-sm text-vscode-descriptionForeground ml-6 mt-1">
						{t("settings:providers.openAiCodex.webSearchDescription")}
					</div>
				</div>
				<div>
					<VSCodeCheckbox
						checked={apiConfiguration.openAiCodexImageGeneration !== false}
						onChange={(e: any) => setApiConfigurationField("openAiCodexImageGeneration", e.target.checked)}>
						<span className="font-medium">{t("settings:providers.openAiCodex.imageGeneration")}</span>
					</VSCodeCheckbox>
					<div className="text-sm text-vscode-descriptionForeground ml-6 mt-1">
						{t("settings:providers.openAiCodex.imageGenerationDescription")}
					</div>
				</div>
			</div>
		</div>
	)
}

import type { ExtensionContext } from "vscode"

import {
	type ModelInfo,
	type ModelRecord,
	type ReasoningEffortExtended,
	openAiCodexDefaultModelId,
	openAiCodexModels,
	reasoningEffortsExtended,
} from "@roo-code/types"

import { openAiCodexOAuthManager } from "./oauth"

/**
 * Live model catalog for the ChatGPT Plus/Pro (Codex OAuth) provider.
 *
 * The Codex CLI discovers models from `GET /backend-api/codex/models?client_version=...`
 * instead of a hard-coded list. We do the same so new models appear as soon as
 * OpenAI ships them; the static `openAiCodexModels` list remains the offline fallback.
 */
const CODEX_MODELS_URL = "https://chatgpt.com/backend-api/codex/models"

/**
 * The backend hides models whose `minimal_client_version` is newer than this,
 * so keep it in step with the latest Codex CLI release (codex-rs `client_version_to_whole`).
 */
export const OPENAI_CODEX_CLIENT_VERSION = "0.165.0"

const CACHE_STATE_KEY = "openAiCodexModelCatalog"
const CACHE_TTL_MS = 60 * 60 * 1000

type CodexCatalogModel = {
	slug?: string
	display_name?: string
	description?: string
	visibility?: string
	priority?: number
	context_window?: number
	input_modalities?: string[]
	support_verbosity?: boolean
	default_reasoning_level?: string
	supported_reasoning_levels?: { effort?: string }[]
}

type CachedCatalog = { models: ModelRecord; fetchedAt: number }

let context: ExtensionContext | null = null
let cache: CachedCatalog | null = null
let inFlight: Promise<ModelRecord | null> | null = null

function isSupportedEffort(value: unknown): value is ReasoningEffortExtended {
	return typeof value === "string" && (reasoningEffortsExtended as readonly string[]).includes(value)
}

function toModelInfo(model: CodexCatalogModel): ModelInfo {
	const slug = model.slug!
	const base: ModelInfo =
		(openAiCodexModels as Record<string, ModelInfo>)[slug] ?? openAiCodexModels[openAiCodexDefaultModelId]

	// Efforts Roo cannot express (e.g. "ultra", which relies on Codex CLI task delegation) are dropped.
	const efforts = (model.supported_reasoning_levels ?? []).map((level) => level.effort).filter(isSupportedEffort)
	const defaultEffort = isSupportedEffort(model.default_reasoning_level) ? model.default_reasoning_level : undefined

	return {
		...base,
		...(typeof model.context_window === "number" && model.context_window > 0
			? { contextWindow: model.context_window }
			: {}),
		...(Array.isArray(model.input_modalities) ? { supportsImages: model.input_modalities.includes("image") } : {}),
		...(typeof model.support_verbosity === "boolean" ? { supportsVerbosity: model.support_verbosity } : {}),
		...(efforts.length > 0 ? { supportsReasoningEffort: efforts } : {}),
		...(defaultEffort && (efforts.length === 0 || efforts.includes(defaultEffort))
			? { reasoningEffort: defaultEffort }
			: {}),
		inputPrice: 0,
		outputPrice: 0,
		description: [model.display_name, model.description].filter(Boolean).join(": ") || base.description,
	}
}

/**
 * Converts a `/codex/models` response into Roo model records, keeping only models the
 * Codex picker lists (hidden ones are internal, e.g. auto-review) in catalog priority order.
 */
export function parseOpenAiCodexModelsPayload(payload: unknown): ModelRecord {
	const list = (payload as { models?: unknown } | null)?.models
	if (!Array.isArray(list)) {
		throw new Error("OpenAI Codex models response did not include a models array")
	}

	const models = (list as CodexCatalogModel[])
		.filter((model) => typeof model?.slug === "string" && model.slug && model.visibility !== "hide")
		.sort((a, b) => (a.priority ?? Number.MAX_SAFE_INTEGER) - (b.priority ?? Number.MAX_SAFE_INTEGER))

	const record: ModelRecord = {}
	for (const model of models) {
		record[model.slug!] = toModelInfo(model)
	}
	return record
}

export async function fetchOpenAiCodexModels(
	accessToken: string,
	options?: { accountId?: string | null },
): Promise<ModelRecord> {
	const headers: Record<string, string> = {
		Authorization: `Bearer ${accessToken}`,
		Accept: "application/json",
		originator: "roo-code",
	}
	if (options?.accountId) {
		headers["ChatGPT-Account-Id"] = options.accountId
	}

	const url = `${CODEX_MODELS_URL}?client_version=${encodeURIComponent(OPENAI_CODEX_CLIENT_VERSION)}`
	const response = await fetch(url, { method: "GET", headers })
	if (!response.ok) {
		const text = await response.text().catch(() => "")
		throw new Error(
			`OpenAI Codex models request failed: ${response.status} ${response.statusText}${text ? ` - ${text}` : ""}`,
		)
	}

	const models = parseOpenAiCodexModelsPayload(await response.json())
	if (Object.keys(models).length === 0) {
		throw new Error("OpenAI Codex models response did not include any listed models")
	}
	return models
}

/**
 * Restores the last fetched catalog so a model picked from it still resolves
 * (instead of falling back to the default model) before the next refresh completes.
 */
export function initializeOpenAiCodexModelCache(extensionContext: ExtensionContext): void {
	context = extensionContext
	const stored = extensionContext.globalState.get<CachedCatalog>(CACHE_STATE_KEY)
	if (stored && stored.models && typeof stored.models === "object") {
		cache = stored
	}
}

export function getCachedOpenAiCodexModels(): ModelRecord | undefined {
	return cache?.models
}

/**
 * Fetches the live catalog with the stored OAuth credentials and caches it.
 * Returns null when signed out. Concurrent callers share one request.
 */
export async function refreshOpenAiCodexModels(options?: { force?: boolean }): Promise<ModelRecord | null> {
	if (!options?.force && cache && Date.now() - cache.fetchedAt < CACHE_TTL_MS) {
		return cache.models
	}
	if (inFlight) {
		return inFlight
	}

	inFlight = (async () => {
		const accessToken = await openAiCodexOAuthManager.getAccessToken()
		if (!accessToken) {
			return null
		}

		const accountId = await openAiCodexOAuthManager.getAccountId()
		const models = await fetchOpenAiCodexModels(accessToken, { accountId })
		cache = { models, fetchedAt: Date.now() }
		await context?.globalState.update(CACHE_STATE_KEY, cache)
		return models
	})().finally(() => {
		inFlight = null
	})

	return inFlight
}

export async function clearOpenAiCodexModelCache(): Promise<void> {
	cache = null
	await context?.globalState.update(CACHE_STATE_KEY, undefined)
}

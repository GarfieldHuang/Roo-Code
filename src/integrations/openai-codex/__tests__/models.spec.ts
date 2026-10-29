import { describe, it, expect, vi, afterEach } from "vitest"

import { openAiCodexModels } from "@roo-code/types"

vi.mock("../oauth", () => ({
	openAiCodexOAuthManager: {
		getAccessToken: vi.fn(),
		getAccountId: vi.fn(),
	},
}))

import { fetchOpenAiCodexModels, OPENAI_CODEX_CLIENT_VERSION, parseOpenAiCodexModelsPayload } from "../models"

const catalogEntry = (overrides: Record<string, unknown>) => ({
	context_window: 272000,
	input_modalities: ["text", "image"],
	support_verbosity: true,
	default_reasoning_level: "medium",
	supported_reasoning_levels: [
		{ effort: "low" },
		{ effort: "medium" },
		{ effort: "high" },
		{ effort: "xhigh" },
		{ effort: "max" },
		{ effort: "ultra" },
	],
	visibility: "list",
	...overrides,
})

describe("parseOpenAiCodexModelsPayload()", () => {
	it("keeps listed models in priority order and drops hidden ones", () => {
		const out = parseOpenAiCodexModelsPayload({
			models: [
				catalogEntry({ slug: "gpt-6-astra", priority: 2 }),
				catalogEntry({ slug: "codex-auto-review", priority: 43, visibility: "hide" }),
				catalogEntry({ slug: "gpt-6.1-sol", priority: 1 }),
			],
		})

		expect(Object.keys(out)).toEqual(["gpt-6.1-sol", "gpt-6-astra"])
	})

	it("maps catalog metadata and drops efforts Roo cannot send", () => {
		const out = parseOpenAiCodexModelsPayload({
			models: [
				catalogEntry({
					slug: "gpt-7-nova",
					display_name: "GPT-7 Nova",
					description: "Brand new model.",
					context_window: 500000,
					default_reasoning_level: "low",
					input_modalities: ["text"],
				}),
			],
		})

		expect(out["gpt-7-nova"]).toMatchObject({
			contextWindow: 500000,
			supportsImages: false,
			supportsVerbosity: true,
			supportsReasoningEffort: ["low", "medium", "high", "xhigh", "max"],
			reasoningEffort: "low",
			inputPrice: 0,
			outputPrice: 0,
			includedTools: ["apply_patch"],
			excludedTools: ["apply_diff", "write_to_file"],
			description: "GPT-7 Nova: Brand new model.",
		})
	})

	it("inherits static settings for known models", () => {
		const out = parseOpenAiCodexModelsPayload({
			models: [catalogEntry({ slug: "gpt-5.3-codex-spark", input_modalities: undefined })],
		})

		expect(out["gpt-5.3-codex-spark"].maxTokens).toBe(openAiCodexModels["gpt-5.3-codex-spark"].maxTokens)
		expect(out["gpt-5.3-codex-spark"].supportsImages).toBe(false)
	})

	it("throws when the payload has no models array", () => {
		expect(() => parseOpenAiCodexModelsPayload({})).toThrow()
	})
})

describe("fetchOpenAiCodexModels()", () => {
	afterEach(() => {
		vi.unstubAllGlobals()
	})

	it("requests the catalog with the client version and account header", async () => {
		const fetchMock = vi.fn().mockResolvedValue({
			ok: true,
			json: async () => ({ models: [catalogEntry({ slug: "gpt-6.1-sol", priority: 1 })] }),
		})
		vi.stubGlobal("fetch", fetchMock)

		const out = await fetchOpenAiCodexModels("token", { accountId: "acct_1" })

		expect(Object.keys(out)).toEqual(["gpt-6.1-sol"])
		const [url, init] = fetchMock.mock.calls[0]
		expect(url).toBe(`https://chatgpt.com/backend-api/codex/models?client_version=${OPENAI_CODEX_CLIENT_VERSION}`)
		expect(init.headers).toMatchObject({ Authorization: "Bearer token", "ChatGPT-Account-Id": "acct_1" })
	})

	it("throws on a non-OK response", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue({ ok: false, status: 401, statusText: "Unauthorized", text: async () => "" }),
		)

		await expect(fetchOpenAiCodexModels("token")).rejects.toThrow("401")
	})
})

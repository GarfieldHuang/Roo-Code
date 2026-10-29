// npx vitest run api/providers/__tests__/openai-codex.spec.ts

import type { ModelRecord } from "@roo-code/types"

import { OpenAiCodexHandler } from "../openai-codex"

const liveCatalog = vi.hoisted(() => ({ models: undefined as ModelRecord | undefined }))

vi.mock("../../../integrations/openai-codex/models", () => ({
	getCachedOpenAiCodexModels: () => liveCatalog.models,
}))

afterEach(() => {
	liveCatalog.models = undefined
})

describe("OpenAiCodexHandler.getModel", () => {
	it.each(["gpt-5.1", "gpt-5", "gpt-5.1-codex", "gpt-5-codex", "gpt-5-codex-mini", "gpt-5.3-codex-spark"])(
		"should return specified model when a valid model id is provided: %s",
		(apiModelId) => {
			const handler = new OpenAiCodexHandler({ apiModelId })
			const model = handler.getModel()

			expect(model.id).toBe(apiModelId)
			expect(model.info).toBeDefined()
			// Default reasoning effort for GPT-5 family
			expect(model.info.reasoningEffort).toBe("medium")
		},
	)

	it("should fall back to default model when an invalid model id is provided", () => {
		const handler = new OpenAiCodexHandler({ apiModelId: "not-a-real-model" })
		const model = handler.getModel()

		expect(model.id).toBe("gpt-6.1-sol")
		expect(model.info).toBeDefined()
	})

	it("should resolve a model that only exists in the live Codex catalog", () => {
		liveCatalog.models = {
			"gpt-7-nova": {
				maxTokens: 128000,
				contextWindow: 400000,
				supportsPromptCache: true,
				supportsReasoningEffort: ["low", "medium", "high", "xhigh", "max"],
				reasoningEffort: "low",
				description: "GPT-7 Nova",
			},
		}

		const handler = new OpenAiCodexHandler({ apiModelId: "gpt-7-nova" })
		const model = handler.getModel()

		expect(model.id).toBe("gpt-7-nova")
		expect(model.info.contextWindow).toBe(400000)
		expect(model.reasoningEffort).toBe("low")
	})

	it("should prefer live catalog metadata over the static list", () => {
		liveCatalog.models = {
			"gpt-6.1-sol": {
				maxTokens: 128000,
				contextWindow: 300000,
				supportsPromptCache: true,
			},
		}

		const handler = new OpenAiCodexHandler({ apiModelId: "gpt-6.1-sol" })

		expect(handler.getModel().info.contextWindow).toBe(300000)
	})

	it("should keep using static models that are missing from the live catalog", () => {
		liveCatalog.models = {}

		const handler = new OpenAiCodexHandler({ apiModelId: "gpt-5.4-mini" })

		expect(handler.getModel().id).toBe("gpt-5.4-mini")
	})

	it("should support the max reasoning effort on GPT-6 models", () => {
		const handler = new OpenAiCodexHandler({ apiModelId: "gpt-6-astra", reasoningEffort: "max" })
		const model = handler.getModel()

		expect(model.info.supportsReasoningEffort).toContain("max")
		expect(model.reasoningEffort).toBe("max")
	})

	it("should use Spark-specific limits and capabilities", () => {
		const handler = new OpenAiCodexHandler({ apiModelId: "gpt-5.3-codex-spark" })
		const model = handler.getModel()

		expect(model.id).toBe("gpt-5.3-codex-spark")
		expect(model.info.contextWindow).toBe(128000)
		expect(model.info.maxTokens).toBe(8192)
		expect(model.info.supportsImages).toBe(false)
	})

	it("should use GPT-5.4 Mini capabilities when selected", () => {
		const handler = new OpenAiCodexHandler({ apiModelId: "gpt-5.4-mini" })
		const model = handler.getModel()

		expect(model.id).toBe("gpt-5.4-mini")
		expect(model.info).toBeDefined()
	})
})

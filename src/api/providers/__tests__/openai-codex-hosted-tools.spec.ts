// cd src && npx vitest run api/providers/__tests__/openai-codex-hosted-tools.spec.ts

import * as fs from "fs/promises"
import * as os from "os"
import * as path from "path"

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const workspace = vi.hoisted(() => ({ path: "" }))

// Keep interpolated details (like the real translations do) so backend error text reaches the handler.
vi.mock("../../../i18n", () => ({
	t: (key: string, options?: { message?: string }) => (options?.message ? `${key}: ${options.message}` : key),
}))

vi.mock("../../../utils/path", async (importOriginal) => ({
	...(await importOriginal<typeof import("../../../utils/path")>()),
	getWorkspacePath: () => workspace.path,
}))

import { OpenAiCodexHandler } from "../openai-codex"
import { openAiCodexOAuthManager } from "../../../integrations/openai-codex/oauth"
import {
	buildHostedTools,
	describeWebSearchCall,
	hostedToolToDropForError,
	resetRejectedHostedTools,
} from "../../../integrations/openai-codex/hosted-tools"

const completed = {
	type: "response.completed",
	response: { id: "resp_1", status: "completed", output: [], usage: { input_tokens: 1, output_tokens: 1 } },
}

function mockStream(handler: OpenAiCodexHandler, events: any[]) {
	const create = vi.fn().mockResolvedValue({
		async *[Symbol.asyncIterator]() {
			for (const event of events) {
				yield event
			}
		},
	})
	;(handler as any).client = { responses: { create } }
	return create
}

const attemptCompletionTool = {
	type: "function" as const,
	function: {
		name: "attempt_completion",
		description: "Finish the task",
		parameters: { type: "object", properties: { result: { type: "string" } }, required: ["result"] },
	},
}

async function collect(handler: OpenAiCodexHandler, tools: any[] = []) {
	const chunks: any[] = []
	for await (const chunk of handler.createMessage("system", [{ role: "user", content: "hi" } as any], {
		taskId: "task-123",
		tools,
	})) {
		chunks.push(chunk)
	}
	return chunks
}

describe("OpenAI Codex hosted tools", () => {
	beforeEach(async () => {
		vi.restoreAllMocks()
		resetRejectedHostedTools()
		vi.spyOn(openAiCodexOAuthManager, "getAccessToken").mockResolvedValue("test-token")
		vi.spyOn(openAiCodexOAuthManager, "getAccountId").mockResolvedValue(null)
		workspace.path = await fs.mkdtemp(path.join(os.tmpdir(), "roo-codex-"))
	})

	afterEach(async () => {
		await fs.rm(workspace.path, { recursive: true, force: true })
	})

	it("adds web search, image generation and a prompt cache key to the request", async () => {
		const handler = new OpenAiCodexHandler({ apiModelId: "gpt-6.1-sol" })
		const create = mockStream(handler, [completed])

		await collect(handler)

		const body = create.mock.calls[0][0]
		expect(body.prompt_cache_key).toBe("task-123")
		expect(body.tools).toEqual(
			expect.arrayContaining([
				{ type: "web_search", external_web_access: true },
				expect.objectContaining({ type: "image_generation", model: "gpt-image-2", output_format: "png" }),
			]),
		)
	})

	it("leaves hosted tools out when turned off in settings", async () => {
		const handler = new OpenAiCodexHandler({
			apiModelId: "gpt-6.1-sol",
			openAiCodexWebSearch: false,
			openAiCodexImageGeneration: false,
		})
		const create = mockStream(handler, [completed])

		await collect(handler)

		expect(create.mock.calls[0][0].tools).toEqual([])
	})

	it("skips image generation for models without image input", async () => {
		const handler = new OpenAiCodexHandler({ apiModelId: "gpt-5.3-codex-spark" })
		const create = mockStream(handler, [completed])

		await collect(handler)

		const types = create.mock.calls[0][0].tools.map((tool: any) => tool.type)
		expect(types).toEqual(["web_search"])
	})

	it("retries without a hosted tool the backend rejects", async () => {
		const handler = new OpenAiCodexHandler({ apiModelId: "gpt-6.1-sol" })
		const create = vi
			.fn()
			.mockRejectedValueOnce(new Error("sdk error"))
			.mockResolvedValue({
				async *[Symbol.asyncIterator]() {
					yield completed
				},
			})
		;(handler as any).client = { responses: { create } }
		// The SDK failure falls back to fetch, which reports the backend's 400.
		vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
			new Response(JSON.stringify({ error: { message: "Unsupported tool type: image_generation" } }), {
				status: 400,
			}),
		)

		await collect(handler)

		const retriedTypes = create.mock.calls[1][0].tools.map((tool: any) => tool.type)
		expect(retriedTypes).toEqual(["web_search"])
	})

	it("shows web search queries as reasoning", async () => {
		const handler = new OpenAiCodexHandler({ apiModelId: "gpt-6.1-sol" })
		mockStream(handler, [
			{
				type: "response.output_item.done",
				item: { type: "web_search_call", status: "completed", action: { type: "search", query: "roo code" } },
			},
			completed,
		])

		const chunks = await collect(handler)

		expect(chunks).toContainEqual({ type: "reasoning", text: "\n🔍 roo code\n" })
	})

	it("saves generated images into the workspace and mentions the path", async () => {
		const handler = new OpenAiCodexHandler({ apiModelId: "gpt-6.1-sol" })
		const png = Buffer.from([0x89, 0x50, 0x4e, 0x47])
		mockStream(handler, [
			{
				type: "response.output_item.done",
				item: { type: "image_generation_call", status: "completed", result: png.toString("base64") },
			},
			completed,
		])

		const chunks = await collect(handler)

		const text = chunks.find((chunk) => chunk.type === "text" && chunk.text.includes("🖼️"))?.text as string
		const relative = text.trim().replace("🖼️ ", "")
		expect(relative).toMatch(/^generated_images\/image-\d{8}-\d{6}\.png$/)
		expect(await fs.readFile(path.join(workspace.path, relative))).toEqual(png)
		// The task turns this into an inline preview once the stream ends.
		expect(chunks).toContainEqual({ type: "image", imagePath: path.join(workspace.path, relative) })
	})

	it("closes the turn with attempt_completion when a hosted tool ran but no Roo tool was called", async () => {
		const handler = new OpenAiCodexHandler({ apiModelId: "gpt-6.1-sol" })
		mockStream(handler, [
			{
				type: "response.output_item.done",
				item: { type: "web_search_call", status: "completed", action: { type: "search", query: "q" } },
			},
			{ type: "response.output_text.delta", delta: "Index closed at 23,456." },
			completed,
		])

		const chunks = await collect(handler, [attemptCompletionTool])

		const last = chunks.filter((chunk) => chunk.type !== "usage").at(-1)
		expect(last).toMatchObject({ type: "tool_call", name: "attempt_completion" })
		expect(JSON.parse(last.arguments)).toEqual({ result: "Index closed at 23,456." })
	})

	it("does not add attempt_completion when the model already called a tool", async () => {
		const handler = new OpenAiCodexHandler({ apiModelId: "gpt-6.1-sol" })
		mockStream(handler, [
			{
				type: "response.output_item.done",
				item: { type: "web_search_call", status: "completed", action: { type: "search", query: "q" } },
			},
			{
				type: "response.output_item.added",
				item: { type: "function_call", call_id: "call_1", name: "attempt_completion", arguments: "" },
			},
			{ type: "response.function_call_arguments.delta", delta: '{"result":"done"}' },
			completed,
		])

		const chunks = await collect(handler, [attemptCompletionTool])

		expect(chunks.filter((chunk) => chunk.type === "tool_call")).toEqual([])
	})

	it("does not add attempt_completion when no hosted tool ran", async () => {
		const handler = new OpenAiCodexHandler({ apiModelId: "gpt-6.1-sol" })
		mockStream(handler, [{ type: "response.output_text.delta", delta: "Just text." }, completed])

		const chunks = await collect(handler, [attemptCompletionTool])

		expect(chunks.filter((chunk) => chunk.type === "tool_call")).toEqual([])
	})

	it("tells the model to still call a tool after hosted tools", async () => {
		const handler = new OpenAiCodexHandler({ apiModelId: "gpt-6.1-sol" })
		const create = mockStream(handler, [completed])

		await collect(handler)

		expect(create.mock.calls[0][0].instructions).toMatch(/^system[\s\S]*SERVER-SIDE TOOLS[\s\S]*attempt_completion/)
	})

	it("keeps the system prompt unchanged when no hosted tools are sent", async () => {
		const handler = new OpenAiCodexHandler({
			apiModelId: "gpt-6.1-sol",
			openAiCodexWebSearch: false,
			openAiCodexImageGeneration: false,
		})
		const create = mockStream(handler, [completed])

		await collect(handler)

		expect(create.mock.calls[0][0].instructions).toBe("system")
	})
})

describe("hosted tool helpers", () => {
	beforeEach(() => resetRejectedHostedTools())

	it("drops the image model parameter before the whole tool", () => {
		const tools = buildHostedTools({ webSearch: true, imageGeneration: true })

		expect(hostedToolToDropForError("Unsupported parameter: image_generation.model", tools)).toBe(
			"image_generation.model",
		)
		expect(hostedToolToDropForError("Tool 'web_search' is not supported", tools)).toBe("web_search")
		expect(hostedToolToDropForError("Rate limit exceeded", tools)).toBeUndefined()
	})

	it("describes search, open page and find actions", () => {
		expect(describeWebSearchCall({ action: { type: "open_page", url: "https://a.dev" } })).toBe("🌐 https://a.dev")
		expect(describeWebSearchCall({ action: { type: "find_in_page", pattern: "x", url: "https://a.dev" } })).toBe(
			'🔎 "x" @ https://a.dev',
		)
		expect(describeWebSearchCall({ action: { type: "search", queries: ["a", "b"] } })).toBe("🔍 a | b")
		expect(describeWebSearchCall({})).toBeUndefined()
	})
})

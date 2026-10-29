// cd src && npx vitest run api/providers/__tests__/openai-codex-websocket.spec.ts

import { beforeEach, describe, expect, it, vi } from "vitest"

const ws = vi.hoisted(() => ({ impl: undefined as undefined | ((options: any) => AsyncGenerator<any>) }))

// Keep interpolated details (like the real translations do).
vi.mock("../../../i18n", () => ({
	t: (key: string, options?: { message?: string }) => (options?.message ? `${key}: ${options.message}` : key),
}))

vi.mock("../../../integrations/openai-codex/websocket", async (importOriginal) => {
	const actual = await importOriginal<typeof import("../../../integrations/openai-codex/websocket")>()
	return {
		...actual,
		streamCodexResponseOverWebSocket: (options: any) => ws.impl!(options),
	}
})

import { OpenAiCodexHandler, resetCodexWebSocketAvailability } from "../openai-codex"
import { openAiCodexOAuthManager } from "../../../integrations/openai-codex/oauth"
import { CodexWebSocketUnavailableError } from "../../../integrations/openai-codex/websocket"

async function collect(handler: OpenAiCodexHandler) {
	const chunks: any[] = []
	for await (const chunk of handler.createMessage("system", [{ role: "user", content: "hi" } as any], {
		taskId: "task-ws",
	})) {
		chunks.push(chunk)
	}
	return chunks
}

describe("OpenAI Codex WebSocket transport", () => {
	beforeEach(() => {
		vi.restoreAllMocks()
		resetCodexWebSocketAvailability()
		vi.spyOn(openAiCodexOAuthManager, "getAccessToken").mockResolvedValue("test-token")
		vi.spyOn(openAiCodexOAuthManager, "getAccountId").mockResolvedValue("acct_1")
	})

	it("streams the response over the WebSocket with Codex headers", async () => {
		let seen: any
		ws.impl = async function* (options) {
			seen = options
			yield { type: "response.output_text.delta", delta: "Hello over WS" }
			yield {
				type: "response.completed",
				response: { id: "r1", output: [], usage: { input_tokens: 1, output_tokens: 1 } },
			}
		}
		const fetchSpy = vi.spyOn(globalThis, "fetch")

		const chunks = await collect(new OpenAiCodexHandler({ apiModelId: "gpt-6.1-sol" }))

		expect(chunks.filter((chunk) => chunk.type === "text").map((chunk) => chunk.text)).toEqual(["Hello over WS"])
		expect(seen.url).toBe("wss://chatgpt.com/backend-api/codex/responses")
		expect(seen.headers).toMatchObject({
			Authorization: "Bearer test-token",
			"OpenAI-Beta": "responses_websockets=2026-02-06",
			"ChatGPT-Account-Id": "acct_1",
			session_id: "task-ws",
		})
		expect(seen.body.model).toBe("gpt-6.1-sol")
		expect(fetchSpy).not.toHaveBeenCalled()
	})

	it("falls back to HTTP when the WebSocket cannot connect, and keeps using HTTP afterwards", async () => {
		let attempts = 0
		ws.impl = (() => {
			attempts++
			const error = new CodexWebSocketUnavailableError("WebSocket could not connect: non-101 status code")
			return { [Symbol.asyncIterator]: () => ({ next: () => Promise.reject(error) }) }
		}) as any
		const sse = () =>
			new Response(
				'data: {"type":"response.output_text.delta","delta":"Hello over HTTP"}\n\n' +
					'data: {"type":"response.completed","response":{"id":"r1","output":[],"usage":{"input_tokens":1,"output_tokens":1}}}\n\n',
				{ status: 200, headers: { "Content-Type": "text/event-stream" } },
			)
		vi.spyOn(globalThis, "fetch").mockImplementation(async () => sse())

		const handler = new OpenAiCodexHandler({ apiModelId: "gpt-6.1-sol" })
		const first = await collect(handler)
		const second = await collect(handler)

		expect(
			first
				.filter((chunk) => chunk.type === "text")
				.map((chunk) => chunk.text)
				.join(""),
		).toBe("Hello over HTTP")
		expect(second.some((chunk) => chunk.type === "text")).toBe(true)
		expect(attempts).toBe(1)
	})

	it("reports a drop after connecting instead of silently resending over HTTP", async () => {
		ws.impl = async function* () {
			yield { type: "response.created" }
			throw new Error("WebSocket closed before the response completed (code 1006)")
		}
		const fetchSpy = vi.spyOn(globalThis, "fetch")

		await expect(collect(new OpenAiCodexHandler({ apiModelId: "gpt-6.1-sol" }))).rejects.toThrow(/code 1006/)
		expect(fetchSpy).not.toHaveBeenCalled()
	})
})

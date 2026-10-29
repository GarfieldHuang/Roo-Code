// npx vitest run integrations/openai-codex/__tests__/websocket.spec.ts

import {
	CodexWebSocketUnavailableError,
	streamCodexResponseOverWebSocket,
	toWebSocketUrl,
	type WebSocketLike,
} from "../websocket"

class FakeSocket implements WebSocketLike {
	readyState = 0
	sent: string[] = []
	closed = false
	private listeners = new Map<string, ((event: any) => void)[]>()

	addEventListener(type: string, listener: (event: any) => void) {
		this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener])
	}
	emit(type: string, event: any = {}) {
		for (const listener of this.listeners.get(type) ?? []) listener(event)
	}
	open() {
		this.readyState = 1
		this.emit("open")
	}
	message(event: unknown) {
		this.emit("message", { data: JSON.stringify(event) })
	}
	send(data: string) {
		this.sent.push(data)
	}
	close() {
		this.closed = true
		this.readyState = 3
	}
}

async function collect(generator: AsyncGenerator<any>) {
	const events: any[] = []
	for await (const event of generator) events.push(event)
	return events
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0))

describe("streamCodexResponseOverWebSocket", () => {
	it("converts the HTTPS endpoint to WSS", () => {
		expect(toWebSocketUrl("https://chatgpt.com/backend-api/codex/responses")).toBe(
			"wss://chatgpt.com/backend-api/codex/responses",
		)
	})

	it("sends response.create and yields events until the response completes", async () => {
		const socket = new FakeSocket()
		const received = collect(
			streamCodexResponseOverWebSocket({
				url: "wss://x",
				headers: { Authorization: "Bearer t" },
				body: { model: "gpt-6.1-sol", stream: true, input: [] },
				createSocket: () => socket,
			}),
		)

		socket.open()
		await tick()
		socket.message({ type: "response.output_text.delta", delta: "hi" })
		socket.message({ type: "response.completed", response: { id: "r1" } })
		socket.message({ type: "response.output_text.delta", delta: "ignored after completion" })

		const events = await received
		expect(JSON.parse(socket.sent[0])).toEqual({
			type: "response.create",
			model: "gpt-6.1-sol",
			stream: true,
			input: [],
		})
		expect(events.map((event) => event.type)).toEqual(["response.output_text.delta", "response.completed"])
		expect(socket.closed).toBe(true)
	})

	it("reports a failed handshake as unavailable so the caller can use HTTP", async () => {
		const socket = new FakeSocket()
		const received = collect(
			streamCodexResponseOverWebSocket({ url: "wss://x", headers: {}, body: {}, createSocket: () => socket }),
		)

		socket.emit("error", { message: "Received network error or non-101 status code." })

		await expect(received).rejects.toBeInstanceOf(CodexWebSocketUnavailableError)
	})

	it("treats a drop after connecting as a normal connection failure", async () => {
		const socket = new FakeSocket()
		const received = collect(
			streamCodexResponseOverWebSocket({ url: "wss://x", headers: {}, body: {}, createSocket: () => socket }),
		)

		socket.open()
		await tick()
		socket.message({ type: "response.created" })
		socket.emit("close", { code: 1006 })

		const error = await received.catch((err) => err)
		expect(error).not.toBeInstanceOf(CodexWebSocketUnavailableError)
		expect(error.message).toMatch(/closed before the response completed \(code 1006\)/)
	})

	it("surfaces server error events with their status and message", async () => {
		const socket = new FakeSocket()
		const received = collect(
			streamCodexResponseOverWebSocket({ url: "wss://x", headers: {}, body: {}, createSocket: () => socket }),
		)

		socket.open()
		await tick()
		socket.message({ type: "error", status: 400, error: { message: "Unsupported tool type: image_generation" } })

		await expect(received).rejects.toThrow("Codex API error 400 - Unsupported tool type: image_generation")
	})

	it("gives up when the connection stays silent past the idle timeout", async () => {
		const socket = new FakeSocket()
		const received = collect(
			streamCodexResponseOverWebSocket({
				url: "wss://x",
				headers: {},
				body: {},
				idleTimeoutMs: 20,
				createSocket: () => socket,
			}),
		)

		socket.open()

		await expect(received).rejects.toThrow(/idle/)
	})

	it("stops quietly when the request is aborted", async () => {
		const socket = new FakeSocket()
		const controller = new AbortController()
		const received = collect(
			streamCodexResponseOverWebSocket({
				url: "wss://x",
				headers: {},
				body: {},
				signal: controller.signal,
				createSocket: () => socket,
			}),
		)

		socket.open()
		await tick()
		socket.message({ type: "response.created" })
		await tick()
		// No further frames arrive: the abort alone must end the stream.
		controller.abort()

		const events = await received
		expect(events.map((event) => event.type)).toEqual(["response.created"])
		expect(socket.closed).toBe(true)
	})
})

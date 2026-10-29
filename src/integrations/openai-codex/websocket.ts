import { WebSocket } from "undici"

/**
 * Responses API over WebSocket, as the Codex CLI uses it
 * (codex-rs/codex-api/src/endpoint/responses_websocket.rs).
 *
 * Some networks buffer whole HTTP responses from chatgpt.com and drop them after ~120s, so long
 * answers never arrive over SSE. Over a WebSocket each event is its own frame and the server pings
 * the connection, so events arrive as they are produced.
 *
 * Protocol: connect with the "OpenAI-Beta: responses_websockets=..." header, send one
 * {"type":"response.create", ...requestBody} message, then receive the same JSON events the SSE
 * stream carries until response.completed / response.failed / an "error" event.
 */

export const CODEX_WEBSOCKET_BETA_HEADER = "responses_websockets=2026-02-06"

/** Same default as the Codex CLI's stream idle timeout. */
const DEFAULT_IDLE_TIMEOUT_MS = 300_000
const CONNECT_TIMEOUT_MS = 15_000

const TERMINAL_EVENTS = new Set(["response.completed", "response.done", "response.failed", "response.incomplete"])

/** The WebSocket could not be opened; the caller should use HTTP instead. */
export class CodexWebSocketUnavailableError extends Error {
	constructor(message: string) {
		super(message)
		this.name = "CodexWebSocketUnavailableError"
	}
}

export type CodexWebSocketOptions = {
	url: string
	headers: Record<string, string>
	body: Record<string, unknown>
	signal?: AbortSignal
	idleTimeoutMs?: number
	connectTimeoutMs?: number
	/** For tests. */
	createSocket?: (url: string, headers: Record<string, string>) => WebSocketLike
}

/** The subset of the WebSocket API used here (undici's WebSocket satisfies it). */
export interface WebSocketLike {
	readyState: number
	send(data: string): void
	close(code?: number, reason?: string): void
	addEventListener(type: string, listener: (event: any) => void): void
}

function errorEventMessage(event: any): string {
	const error = event?.error
	const message =
		(typeof error?.message === "string" && error.message) ||
		(typeof event?.message === "string" && event.message) ||
		JSON.stringify(event)
	const status = typeof event?.status === "number" ? `${event.status} ` : ""
	const code = typeof error?.code === "string" ? ` (${error.code})` : ""
	return `Codex API error ${status}- ${message}${code}`
}

export function toWebSocketUrl(httpUrl: string): string {
	return httpUrl.replace(/^http/, "ws")
}

/**
 * Sends one Responses request over a WebSocket and yields the parsed events.
 * Throws CodexWebSocketUnavailableError if the connection cannot be established.
 */
export async function* streamCodexResponseOverWebSocket(options: CodexWebSocketOptions): AsyncGenerator<any> {
	const idleTimeoutMs = options.idleTimeoutMs ?? DEFAULT_IDLE_TIMEOUT_MS
	const connectTimeoutMs = options.connectTimeoutMs ?? CONNECT_TIMEOUT_MS
	const socket = options.createSocket
		? options.createSocket(options.url, options.headers)
		: (new WebSocket(options.url, { headers: options.headers }) as unknown as WebSocketLike)

	const queue: any[] = []
	let opened = false
	let finished = false
	let failure: Error | undefined
	let wake: (() => void) | undefined
	const notify = () => {
		wake?.()
		wake = undefined
	}

	socket.addEventListener("open", () => {
		opened = true
		notify()
	})
	socket.addEventListener("message", (event: any) => {
		const text = typeof event.data === "string" ? event.data : Buffer.from(event.data).toString("utf8")
		try {
			queue.push(JSON.parse(text))
		} catch {
			// Ignore non-JSON frames, as the Codex CLI does.
		}
		notify()
	})
	socket.addEventListener("error", (event: any) => {
		const cause = event?.error?.message || event?.message || "WebSocket error"
		failure ??= opened
			? new Error(`WebSocket connection error: ${cause}`)
			: new CodexWebSocketUnavailableError(`WebSocket could not connect: ${cause}`)
		notify()
	})
	socket.addEventListener("close", (event: any) => {
		if (!finished) {
			const detail = `code ${event?.code ?? "?"}${event?.reason ? `: ${event.reason}` : ""}`
			failure ??= opened
				? new Error(`WebSocket closed before the response completed (${detail})`)
				: new CodexWebSocketUnavailableError(`WebSocket closed during connect (${detail})`)
		}
		notify()
	})

	const onAbort = () => {
		socket.close(1000, "aborted")
		// Wake the receive loop right away instead of waiting for the close event or idle timeout.
		notify()
	}
	options.signal?.addEventListener("abort", onAbort)

	// Resolves true on the next socket event, false on timeout. Callers re-check state after it;
	// no event can slip in between that check and this call because nothing awaits in between.
	const waitForActivity = (timeoutMs: number) =>
		new Promise<boolean>((resolve) => {
			const timer = setTimeout(() => {
				wake = undefined
				resolve(false)
			}, timeoutMs)
			wake = () => {
				clearTimeout(timer)
				resolve(true)
			}
		})

	try {
		// Connect
		while (!opened && !failure) {
			if (!(await waitForActivity(connectTimeoutMs)) && !opened && !failure) {
				throw new CodexWebSocketUnavailableError("WebSocket connect timed out")
			}
		}
		if (failure) {
			throw failure
		}

		socket.send(JSON.stringify({ type: "response.create", ...options.body }))

		// Receive events until the response ends
		while (true) {
			if (options.signal?.aborted) {
				return
			}
			const event = queue.shift()
			if (event) {
				if (event.type === "error") {
					throw new Error(errorEventMessage(event))
				}
				yield event
				if (TERMINAL_EVENTS.has(event.type)) {
					finished = true
					return
				}
				continue
			}
			if (failure) {
				throw failure
			}
			if (!(await waitForActivity(idleTimeoutMs)) && queue.length === 0 && !failure) {
				throw new Error(`WebSocket idle for ${Math.round(idleTimeoutMs / 1000)}s waiting for the response`)
			}
		}
	} finally {
		finished = true
		options.signal?.removeEventListener("abort", onAbort)
		if (socket.readyState === 0 || socket.readyState === 1) {
			socket.close(1000)
		}
	}
}

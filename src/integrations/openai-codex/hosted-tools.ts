import fs from "fs/promises"
import * as os from "os"
import * as path from "path"

/**
 * Hosted tools for the ChatGPT Plus/Pro (Codex OAuth) provider. They run on OpenAI's
 * servers: the model calls them inside the same response, so Roo only adds them to the
 * request and surfaces their results (search queries, generated images).
 *
 * Request shapes follow the Codex CLI (codex-rs/core/src/tools/hosted_spec.rs) for web
 * search and the hosted image_generation tool accepted by the Codex backend.
 */

export type HostedToolOptions = {
	webSearch: boolean
	imageGeneration: boolean
}

export const OPENAI_CODEX_IMAGE_MODEL = "gpt-image-2"

// Set when the backend rejects a hosted tool, so later requests in this session skip it
// instead of failing every turn.
const rejectedHostedTools = new Set<string>()

export function markHostedToolRejected(type: string): void {
	rejectedHostedTools.add(type)
}

export function resetRejectedHostedTools(): void {
	rejectedHostedTools.clear()
}

export function buildHostedTools(options: HostedToolOptions): Record<string, unknown>[] {
	const tools: Record<string, unknown>[] = []

	if (options.webSearch && !rejectedHostedTools.has("web_search")) {
		// external_web_access: true = live internet (Codex "live" mode), false = OpenAI's cached index.
		tools.push({ type: "web_search", external_web_access: true })
	}

	if (options.imageGeneration && !rejectedHostedTools.has("image_generation")) {
		tools.push({
			type: "image_generation",
			output_format: "png",
			size: "auto",
			quality: "auto",
			...(rejectedHostedTools.has("image_generation.model") ? {} : { model: OPENAI_CODEX_IMAGE_MODEL }),
		})
	}

	return tools
}

/**
 * Works out which hosted tool a 400 error is about, so the request can be retried without it.
 * The image tool's `model` field is dropped first (some accounts reject it) before the tool itself.
 */
export function hostedToolToDropForError(message: string, tools: Record<string, unknown>[]): string | undefined {
	const text = message.toLowerCase()
	const types = new Set(tools.map((tool) => String(tool.type)))

	if (types.has("image_generation") && text.includes("image_generation")) {
		const image = tools.find((tool) => tool.type === "image_generation")
		return image && "model" in image && text.includes("model") ? "image_generation.model" : "image_generation"
	}
	if (types.has("web_search") && text.includes("web_search")) {
		return "web_search"
	}
	return undefined
}

/** One line for the reasoning area describing what a web_search_call did. */
export function describeWebSearchCall(item: any): string | undefined {
	const action = item?.action
	if (!action || typeof action !== "object") {
		return undefined
	}

	switch (action.type) {
		case "search": {
			const queries: string[] = Array.isArray(action.queries) ? action.queries : []
			const query = typeof action.query === "string" ? action.query : queries.join(" | ")
			return query ? `🔍 ${query}` : undefined
		}
		case "open_page":
			return typeof action.url === "string" ? `🌐 ${action.url}` : undefined
		case "find_in_page":
		case "find":
			return typeof action.pattern === "string"
				? `🔎 "${action.pattern}"${typeof action.url === "string" ? ` @ ${action.url}` : ""}`
				: undefined
		default:
			return undefined
	}
}

function timestamp(): string {
	const now = new Date()
	const pad = (value: number) => String(value).padStart(2, "0")
	return (
		`${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-` +
		`${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`
	)
}

/**
 * Saves a generated PNG under `<workspace>/generated_images/` (or the home folder when no
 * workspace is open) without overwriting existing files. Returns the absolute path.
 */
export async function saveGeneratedImage(base64Png: string, workspacePath: string | undefined): Promise<string> {
	const dir = path.join(workspacePath || path.join(os.homedir(), "Roo Code"), "generated_images")
	await fs.mkdir(dir, { recursive: true })

	const base = `image-${timestamp()}`
	let filePath = path.join(dir, `${base}.png`)
	for (
		let n = 2;
		await fs.stat(filePath).then(
			() => true,
			() => false,
		);
		n++
	) {
		filePath = path.join(dir, `${base}-${n}.png`)
	}

	await fs.writeFile(filePath, Buffer.from(base64Png, "base64"))
	return filePath
}

export type WebSource = { title: string; url: string }

/** Pages a web_search_call looked at (opened page and/or listed sources). */
export function collectWebSearchSources(item: any): WebSource[] {
	const action = item?.action
	const sources: WebSource[] = []
	if (!action || typeof action !== "object") {
		return sources
	}
	if (typeof action.url === "string" && /^https?:\/\//.test(action.url)) {
		sources.push({ title: action.url, url: action.url })
	}
	for (const source of Array.isArray(action.sources) ? action.sources : []) {
		if (typeof source?.url === "string" && /^https?:\/\//.test(source.url)) {
			sources.push({
				title: typeof source.title === "string" && source.title ? source.title : source.url,
				url: source.url,
			})
		}
	}
	return sources
}

// ChatGPT-style citation markers, e.g. "citeturn1view0". The ChatGPT app
// turns them into source chips; anywhere else they show up as boxes, so they are removed.
const CITE_START = ""
const CITE_END = ""
const MAX_PENDING_MARKER = 200

/** Removes citation markers from streamed text, holding back a marker split across chunks. */
export class CitationMarkerFilter {
	private pending = ""

	push(text: string): string {
		let input = this.pending + text
		this.pending = ""
		let output = ""

		while (input.length > 0) {
			const start = input.indexOf(CITE_START)
			if (start === -1) {
				output += input
				break
			}
			output += input.slice(0, start)
			const end = input.indexOf(CITE_END, start + 1)
			if (end === -1) {
				const rest = input.slice(start)
				if (rest.length <= MAX_PENDING_MARKER) {
					this.pending = rest
				} else {
					// Not a real marker after all; keep the text without the stray control character.
					output += rest.slice(1)
				}
				break
			}
			input = input.slice(end + 1)
		}

		return output
	}

	flush(): string {
		const rest = this.pending.replace(/[-]/g, "")
		this.pending = ""
		return rest
	}
}

/**
 * ChatGPT-style citation markers such as "citeturn1view0". Models that used
 * OpenAI's hosted web search write them for the ChatGPT app to turn into source chips; anywhere
 * else they render as boxes and stray text, so they are removed.
 */
const CITATION_MARKER = /[^]*/g
const MARKER_CHARS = /[-]/g

export function stripCitationMarkers(text: string): string {
	return text.includes("") || text.includes("") || text.includes("")
		? text.replace(CITATION_MARKER, "").replace(MARKER_CHARS, "")
		: text
}

/** Strips citation markers from every string inside a value (e.g. a tool's parsed arguments). */
export function stripCitationMarkersDeep<T>(value: T): T {
	if (typeof value === "string") {
		return stripCitationMarkers(value) as T
	}
	if (Array.isArray(value)) {
		return value.map((item) => stripCitationMarkersDeep(item)) as T
	}
	if (value && typeof value === "object") {
		const result: Record<string, unknown> = {}
		for (const [key, item] of Object.entries(value)) {
			result[key] = stripCitationMarkersDeep(item)
		}
		return result as T
	}
	return value
}

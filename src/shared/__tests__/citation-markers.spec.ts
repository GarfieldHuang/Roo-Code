// npx vitest run shared/__tests__/citation-markers.spec.ts

import { stripCitationMarkers, stripCitationMarkersDeep } from "../citation-markers"

describe("stripCitationMarkers", () => {
	it("removes complete markers", () => {
		expect(stripCitationMarkers("Price 2,400.citeturn1view0\n\nNext")).toBe("Price 2,400.\n\nNext")
	})

	it("removes markers with several references", () => {
		expect(stripCitationMarkers("Aciteturn1view0turn2view1 B")).toBe("A B")
	})

	it("drops stray marker characters", () => {
		expect(stripCitationMarkers("Acite B")).toBe("Acite B")
	})

	it("leaves normal text alone", () => {
		expect(stripCitationMarkers("plain 中文 text")).toBe("plain 中文 text")
	})
})

describe("stripCitationMarkersDeep", () => {
	it("cleans nested tool arguments", () => {
		expect(
			stripCitationMarkersDeep({
				result: "Done.citeturn1view1",
				files: [{ path: "a.md", content: "xciteturn2view0" }],
				line: 3,
			}),
		).toEqual({ result: "Done.", files: [{ path: "a.md", content: "x" }], line: 3 })
	})
})

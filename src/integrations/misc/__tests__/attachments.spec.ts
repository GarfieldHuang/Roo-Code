// npx vitest run integrations/misc/__tests__/attachments.spec.ts

import * as fs from "fs/promises"
import * as os from "os"
import * as path from "path"

vi.mock("vscode", () => ({ window: { showOpenDialog: vi.fn() } }))

import { saveAttachments, toFileMention } from "../attachments"

describe("toFileMention", () => {
	const cwd = path.resolve("/work/project")

	it("uses a workspace-relative mention for files inside cwd", () => {
		expect(toFileMention(path.join(cwd, "docs", "spec.md"), cwd)).toBe("@/docs/spec.md")
	})

	it("uses the absolute path for files outside cwd", () => {
		const outside = path.resolve("/tmp/report.pdf")
		expect(toFileMention(outside, cwd)).toBe(`@/${outside.replace(/\\/g, "/").replace(/^\/+/, "")}`)
	})

	it("escapes spaces so the path stays one mention", () => {
		expect(toFileMention(path.join(cwd, "my notes.txt"), cwd)).toBe("@/my\\ notes.txt")
	})
})

describe("saveAttachments", () => {
	let storageDir: string

	beforeEach(async () => {
		storageDir = await fs.mkdtemp(path.join(os.tmpdir(), "roo-attach-"))
	})

	afterEach(async () => {
		await fs.rm(storageDir, { recursive: true, force: true })
	})

	it("writes data URLs to disk and reports skipped files", async () => {
		const { paths, skipped } = await saveAttachments(storageDir, [
			{ name: "notes.txt", dataUrl: `data:text/plain;base64,${Buffer.from("hello").toString("base64")}` },
			{ name: "huge.bin", tooLarge: true },
		])

		expect(skipped).toEqual(["huge.bin"])
		expect(paths).toHaveLength(1)
		expect(path.basename(paths[0])).toBe("notes.txt")
		expect(await fs.readFile(paths[0], "utf8")).toBe("hello")
	})

	it("sanitizes names and keeps duplicate names apart", async () => {
		const dataUrl = "data:text/plain;base64,"
		const { paths } = await saveAttachments(storageDir, [
			{ name: "../../evil:name?.txt", dataUrl },
			{ name: "a.txt", dataUrl },
			{ name: "a.txt", dataUrl },
		])

		expect(paths.every((p) => p.startsWith(path.join(storageDir, "attachments")))).toBe(true)
		expect(path.basename(paths[0])).toBe("evil_name_.txt")
		expect(new Set(paths.map((p) => path.basename(p))).size).toBe(3)
	})
})

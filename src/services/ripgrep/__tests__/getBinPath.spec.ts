// npx vitest run services/ripgrep/__tests__/getBinPath.spec.ts

import * as fs from "fs/promises"
import * as os from "os"
import * as path from "path"

import { getBinPath } from "../index"

describe("getBinPath", () => {
	let appRoot: string

	beforeEach(async () => {
		appRoot = await fs.mkdtemp(path.join(os.tmpdir(), "roo-rg-"))
	})

	afterEach(async () => {
		await fs.rm(appRoot, { recursive: true, force: true })
	})

	const createBinary = async (folder: string) => {
		const binName = process.platform.startsWith("win") ? "rg.exe" : "rg"
		const fullPath = path.join(appRoot, folder, binName)
		await fs.mkdir(path.dirname(fullPath), { recursive: true })
		await fs.writeFile(fullPath, "")
		return fullPath
	}

	it("finds the classic @vscode/ripgrep location", async () => {
		const expected = await createBinary("node_modules/@vscode/ripgrep/bin")

		expect(await getBinPath(appRoot)).toBe(expected)
	})

	it("finds the per-platform @vscode/ripgrep-universal location used by newer VS Code", async () => {
		const expected = await createBinary(
			`node_modules.asar.unpacked/@vscode/ripgrep-universal/bin/${process.platform}-${process.arch}`,
		)

		expect(await getBinPath(appRoot)).toBe(expected)
	})

	it("returns undefined when no ripgrep binary exists", async () => {
		expect(await getBinPath(appRoot)).toBeUndefined()
	})
})

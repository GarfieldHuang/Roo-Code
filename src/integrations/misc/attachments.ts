import * as vscode from "vscode"
import fs from "fs/promises"
import * as path from "path"

import { escapeSpaces } from "../../shared/context-mentions"

/**
 * Attachments added to the chat input from outside the workspace: files pasted
 * from the clipboard, dropped from the OS file manager or picked in a dialog.
 *
 * Non-image files become `@/path` mentions so their content is inlined like any
 * other file mention. Pasted and dropped files carry no path inside the webview,
 * so they are first written to extension storage.
 */

export const ATTACHABLE_IMAGE_EXTENSIONS = ["png", "jpg", "jpeg", "webp"]

export type IncomingAttachment = {
	name: string
	dataUrl?: string
	tooLarge?: boolean
}

/**
 * Builds the text of an `@` mention for a file. Files inside `cwd` use the usual
 * workspace-relative form; anything else uses its absolute path, which the mention
 * resolver accepts because `path.resolve(cwd, absolutePath)` returns it unchanged.
 */
export function toFileMention(filePath: string, cwd: string): string {
	const relative = path.relative(cwd, filePath)
	const insideCwd = !!cwd && !!relative && !relative.startsWith("..") && !path.isAbsolute(relative)
	const mentionPath = (insideCwd ? relative : path.resolve(filePath)).replace(/\\/g, "/")
	return `@/${escapeSpaces(mentionPath.replace(/^\/+/, ""))}`
}

function sanitizeFileName(name: string): string {
	const base = Array.from(path.basename(name.replace(/\\/g, "/")))
		// Characters Windows does not allow in file names, plus control characters.
		.map((char) => (/[<>:"/\\|?*]/.test(char) || char.charCodeAt(0) < 0x20 ? "_" : char))
		.join("")
		.trim()
	return base && base !== "." && base !== ".." ? base : "attachment"
}

function decodeDataUrl(dataUrl: string): Buffer {
	const commaIndex = dataUrl.indexOf(",")
	if (!dataUrl.startsWith("data:") || commaIndex === -1) {
		throw new Error("Invalid data URL")
	}
	const meta = dataUrl.slice(5, commaIndex)
	const payload = dataUrl.slice(commaIndex + 1)
	return meta.endsWith(";base64") ? Buffer.from(payload, "base64") : Buffer.from(decodeURIComponent(payload), "utf8")
}

/**
 * Writes pasted/dropped files to `<storageDir>/attachments/<batch>/` and returns their paths.
 * Each batch gets its own folder so files with the same name never overwrite each other.
 */
export async function saveAttachments(
	storageDir: string,
	attachments: IncomingAttachment[],
): Promise<{ paths: string[]; skipped: string[] }> {
	const batch = `${new Date().toISOString().replace(/[:.]/g, "-")}-${Math.random().toString(36).slice(2, 8)}`
	const dir = path.join(storageDir, "attachments", batch)
	const paths: string[] = []
	const skipped: string[] = []
	const usedNames = new Set<string>()

	for (const attachment of attachments) {
		if (attachment.tooLarge || !attachment.dataUrl) {
			skipped.push(attachment.name)
			continue
		}

		let fileName = sanitizeFileName(attachment.name)
		if (usedNames.has(fileName.toLowerCase())) {
			const ext = path.extname(fileName)
			fileName = `${path.basename(fileName, ext)}-${usedNames.size}${ext}`
		}
		usedNames.add(fileName.toLowerCase())

		try {
			const content = decodeDataUrl(attachment.dataUrl)
			await fs.mkdir(dir, { recursive: true })
			const filePath = path.join(dir, fileName)
			await fs.writeFile(filePath, content)
			paths.push(filePath)
		} catch {
			skipped.push(attachment.name)
		}
	}

	return { paths, skipped }
}

function imageMimeType(filePath: string): string | undefined {
	switch (path.extname(filePath).toLowerCase()) {
		case ".png":
			return "image/png"
		case ".jpg":
		case ".jpeg":
			return "image/jpeg"
		case ".webp":
			return "image/webp"
		default:
			return undefined
	}
}

/**
 * Lets the user pick any files. Supported images are returned as data URLs (when the model
 * accepts images); every other file is returned as a path to mention.
 */
export async function selectAttachments(allowImages: boolean): Promise<{ images: string[]; paths: string[] }> {
	const fileUris = await vscode.window.showOpenDialog({
		canSelectMany: true,
		openLabel: "Attach",
		filters: {
			"All files": ["*"],
			...(allowImages ? { Images: ATTACHABLE_IMAGE_EXTENSIONS } : {}),
		},
	})

	const images: string[] = []
	const paths: string[] = []

	for (const uri of fileUris ?? []) {
		const mimeType = allowImages ? imageMimeType(uri.fsPath) : undefined
		if (mimeType) {
			const buffer = await fs.readFile(uri.fsPath)
			images.push(`data:${mimeType};base64,${buffer.toString("base64")}`)
		} else {
			paths.push(uri.fsPath)
		}
	}

	return { images, paths }
}

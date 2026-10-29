import { act } from "react"

import { defaultModeSlug } from "@roo/modes"

import { render, fireEvent, screen, waitFor } from "@src/utils/test-utils"
import { useExtensionState } from "@src/context/ExtensionStateContext"
import { vscode } from "@src/utils/vscode"

import { ChatTextArea } from "../ChatTextArea"

vi.mock("@src/utils/vscode", () => ({
	vscode: {
		postMessage: vi.fn(),
	},
}))

vi.mock("@src/components/common/CodeBlock")
vi.mock("@src/components/common/MarkdownBlock")
vi.mock("@src/context/ExtensionStateContext")

const mockPostMessage = vscode.postMessage as ReturnType<typeof vi.fn>

const defaultProps = {
	inputValue: "",
	setInputValue: vi.fn(),
	onSend: vi.fn(),
	sendingDisabled: false,
	selectApiConfigDisabled: false,
	shouldDisableImages: false,
	placeholderText: "Type a message...",
	selectedImages: [],
	setSelectedImages: vi.fn(),
	onHeightChange: vi.fn(),
	mode: defaultModeSlug,
	setMode: vi.fn(),
	modeShortcutText: "(⌘. for next mode)",
}

const lastAttachmentRequest = (type: string) =>
	mockPostMessage.mock.calls.map(([message]) => message).find((message) => message.type === type)

describe("ChatTextArea attachments", () => {
	beforeEach(() => {
		vi.clearAllMocks()
		;(useExtensionState as ReturnType<typeof vi.fn>).mockReturnValue({
			filePaths: [],
			openedTabs: [],
			cwd: "/Users/test/project",
			taskHistory: [],
			clineMessages: [],
		})
	})

	it("sends pasted non-image files to the extension to be saved", async () => {
		const { container } = render(<ChatTextArea {...defaultProps} />)
		const file = new File(["hello"], "notes.txt", { type: "text/plain" })

		fireEvent.paste(container.querySelector("textarea")!, {
			clipboardData: { items: [], files: [file], getData: () => "" },
		})

		await waitFor(() => expect(lastAttachmentRequest("saveAttachments")).toBeDefined())
		const request = lastAttachmentRequest("saveAttachments")
		expect(request.attachments).toEqual([
			{ name: "notes.txt", dataUrl: expect.stringMatching(/^data:text\/plain;base64,/) },
		])
		expect(request.requestId).toEqual(expect.any(String))
	})

	it("attaches pasted images directly instead of saving them", async () => {
		const setSelectedImages = vi.fn()
		const { container } = render(<ChatTextArea {...defaultProps} setSelectedImages={setSelectedImages} />)
		const image = new File([new Uint8Array([1, 2, 3])], "shot.png", { type: "image/png" })

		fireEvent.paste(container.querySelector("textarea")!, {
			clipboardData: { items: [], files: [image], getData: () => "" },
		})

		await waitFor(() => expect(setSelectedImages).toHaveBeenCalled())
		expect(lastAttachmentRequest("saveAttachments")).toBeUndefined()
	})

	it("sends files dropped from the OS file manager to the extension", async () => {
		const { container } = render(<ChatTextArea {...defaultProps} />)
		const file = new File(["%PDF"], "report.pdf", { type: "application/pdf" })

		fireEvent.drop(container.querySelector(".chat-text-area")!, {
			dataTransfer: { getData: () => "", files: [file] },
		})

		await waitFor(() => expect(lastAttachmentRequest("saveAttachments")).toBeDefined())
		expect(lastAttachmentRequest("saveAttachments").attachments[0].name).toBe("report.pdf")
	})

	it("opens the file picker and inserts the returned mentions", async () => {
		const setInputValue = vi.fn()
		render(<ChatTextArea {...defaultProps} inputValue="see" setInputValue={setInputValue} />)

		fireEvent.click(screen.getByRole("button", { name: "chat:addFiles" }))
		const request = lastAttachmentRequest("selectAttachments")
		expect(request).toMatchObject({ bool: true, requestId: expect.any(String) })

		act(() => {
			window.dispatchEvent(
				new MessageEvent("message", {
					data: { type: "attachmentsReady", requestId: "someone-else", mentions: ["@/ignored.txt"] },
				}),
			)
		})
		expect(setInputValue).not.toHaveBeenCalled()

		act(() => {
			window.dispatchEvent(
				new MessageEvent("message", {
					data: { type: "attachmentsReady", requestId: request.requestId, mentions: ["@/a.md", "@/b.md"] },
				}),
			)
		})
		// Inserted at the caret, which starts at the beginning of the input.
		expect(setInputValue).toHaveBeenCalledWith("@/a.md @/b.md see")
	})
})

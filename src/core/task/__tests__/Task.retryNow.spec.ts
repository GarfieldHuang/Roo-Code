// npx vitest run core/task/__tests__/Task.retryNow.spec.ts

import { Task } from "../Task"

function fakeTask() {
	const says: string[] = []
	const task: any = {
		taskId: "t1",
		abort: false,
		apiConfiguration: {},
		retryCountdownSkipped: false,
		providerRef: { deref: () => ({ getState: async () => ({ requestDelaySeconds: 30 }) }) },
		say: vi.fn(async (_type: string, text: string) => {
			says.push(text)
		}),
	}
	task.skipRetryCountdown = (Task.prototype as any).skipRetryCountdown.bind(task)
	return { task, says }
}

describe("Task retry countdown", () => {
	beforeEach(() => vi.useFakeTimers())
	afterEach(() => vi.useRealTimers())

	it("stops the countdown early when the user presses Retry now", async () => {
		const { task, says } = fakeTask()
		const backoff = (Task.prototype as any).backoffAndAnnounce.call(task, 0, new Error("fetch failed"))

		await vi.advanceTimersByTimeAsync(3000)
		task.skipRetryCountdown()
		await vi.advanceTimersByTimeAsync(1000)
		await backoff

		const countdownTicks = says.filter((text) => text.includes("<retry_timer>"))
		expect(countdownTicks.length).toBeLessThan(6)
		expect(says.at(-1)).not.toContain("<retry_timer>")
		expect(task.retryCountdownSkipped).toBe(false)
	})

	it("runs the full countdown when nobody presses the button", async () => {
		const { task, says } = fakeTask()
		const backoff = (Task.prototype as any).backoffAndAnnounce.call(task, 0, new Error("fetch failed"))

		await vi.advanceTimersByTimeAsync(31_000)
		await backoff

		expect(says.filter((text) => text.includes("<retry_timer>"))).toHaveLength(30)
	})
})

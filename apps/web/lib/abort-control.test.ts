import { describe, expect, it } from "vitest";
import { runAbortable } from "./abort-control";

describe("runAbortable", () => {
  it.each(["REPLACED", "PAGE_LEFT", "PAGE_HIDDEN"])(
    "settles a cancelled operation without exposing its %s reason",
    async reason => {
      const controller = new AbortController();
      const operation = runAbortable(controller, signal => new Promise<never>((_resolve, reject) => {
        signal.addEventListener("abort", () => reject(signal.reason), { once: true });
      }));

      controller.abort(reason);

      await expect(operation).resolves.toBeUndefined();
    },
  );

  it("does not swallow an unexpected failure", async () => {
    const controller = new AbortController();
    const failure = new Error("API_RESPONSE_INVALID");

    await expect(runAbortable(controller, async () => {
      throw failure;
    })).rejects.toBe(failure);
  });
});

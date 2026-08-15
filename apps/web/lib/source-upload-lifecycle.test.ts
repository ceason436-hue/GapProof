import { describe, expect, it, vi } from "vitest";
import { beginSourceUploadLifecycle } from "./source-upload-lifecycle";

describe("source upload lifecycle", () => {
  it("restores the mounted guard across StrictMode cleanup and remount", () => {
    const mountedRef = { current: true };
    const onCleanup = vi.fn();

    const firstCleanup = beginSourceUploadLifecycle(mountedRef, onCleanup);
    expect(mountedRef.current).toBe(true);
    firstCleanup();
    expect(mountedRef.current).toBe(false);
    expect(onCleanup).toHaveBeenCalledTimes(1);

    const secondCleanup = beginSourceUploadLifecycle(mountedRef, onCleanup);
    expect(mountedRef.current).toBe(true);
    secondCleanup();
    expect(mountedRef.current).toBe(false);
    expect(onCleanup).toHaveBeenCalledTimes(2);
  });
});

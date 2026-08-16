export function isAbortError(signal: AbortSignal, error: unknown): boolean {
  return signal.aborted || (error instanceof Error && error.name === "AbortError");
}

export async function runAbortable<T>(
  controller: AbortController,
  run: (signal: AbortSignal) => Promise<T>,
): Promise<T | undefined> {
  try {
    return await run(controller.signal);
  } catch (error) {
    if (isAbortError(controller.signal, error)) return undefined;
    throw error;
  }
}

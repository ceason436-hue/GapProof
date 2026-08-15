export class WorkerStartupConfigurationError extends Error {
  readonly code = "WORKER_NOT_CONFIGURED";

  constructor() {
    super("GAPPROOF_UPLOAD_DIR must be configured before the worker can start.");
    this.name = "WorkerStartupConfigurationError";
  }
}

export function requireUploadDirectory(value: string | undefined): string {
  const directory = value?.trim();
  if (directory === undefined || directory.length === 0) {
    throw new WorkerStartupConfigurationError();
  }
  return directory;
}

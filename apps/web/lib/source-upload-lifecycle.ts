export type MountedUploadRef = { current: boolean };

export function beginSourceUploadLifecycle(
  mountedRef: MountedUploadRef,
  onCleanup: () => void,
): () => void {
  mountedRef.current = true;
  return () => {
    mountedRef.current = false;
    onCleanup();
  };
}

import { writeSync } from 'node:fs';

export const PROCESS_EXIT_PROTOCOL = 'behold.process-exit.v1';

export type SuccessfulProcessExitRecord = {
  protocol: typeof PROCESS_EXIT_PROTOCOL;
  status: 'cleanup_completed';
  at: string;
  pid: number;
  activeResources: Record<string, number>;
  resourceInspectionError: string | null;
};

export function successfulProcessExitRecord(
  now: Date = new Date(),
  getActiveResourcesInfo: () => readonly string[] = () => process.getActiveResourcesInfo(),
): SuccessfulProcessExitRecord {
  let activeResources: Record<string, number> = {};
  let resourceInspectionError: string | null = null;
  try {
    for (const resource of getActiveResourcesInfo()) {
      activeResources[resource] = (activeResources[resource] ?? 0) + 1;
    }
  } catch (error: any) {
    resourceInspectionError = error?.message || String(error);
  }
  activeResources = Object.fromEntries(
    Object.entries(activeResources).sort(([left], [right]) => left.localeCompare(right)),
  );
  return {
    protocol: PROCESS_EXIT_PROTOCOL,
    status: 'cleanup_completed',
    at: now.toISOString(),
    pid: process.pid,
    activeResources,
    resourceInspectionError,
  };
}

/**
 * End the owned CLI process after its caller has completed every durable
 * shutdown obligation. Some dependencies retain obsolete timers after their
 * work has succeeded, so waiting for Node's event loop is not a reliable
 * process-lifecycle boundary.
 */
export function completeSuccessfulCliExit(): never {
  const record = successfulProcessExitRecord();
  try {
    writeSync(process.stderr.fd, `[behold] ${JSON.stringify(record)}\n`);
  } catch {
    // A closed diagnostics pipe cannot invalidate already-durable cleanup.
  }
  process.exit(0);
}

// R1.3 — بعد از SIGTERM درخواست‌های تغییردهنده‌ی جدید رد می‌شوند و /health ناسالم می‌شود،
// ولی turnهای در جریان تمام می‌شوند.
let shuttingDown = false;

export function markShuttingDown(): void {
  shuttingDown = true;
}

export function isShuttingDown(): boolean {
  return shuttingDown;
}

export function resetShutdownStateForTests(): void {
  shuttingDown = false;
}

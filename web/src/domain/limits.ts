// The payload limit studiod enforces (server/internal/adapters/httpapi). One number in two languages is a
// contract: both sides read testdata/limits.json in their tests and fail when they disagree, so a change
// on one side cannot go unnoticed on the other.
export const MAX_PAYLOAD_BYTES = 64 * 1024 * 1024;

const MIB = 1024 * 1024;

/** formatMiB prints a byte count the way the server does in its refusal: "64 MiB", "1.5 MiB". */
export function formatMiB(bytes: number): string {
  const mib = bytes / MIB;
  const text = Number.isInteger(mib) ? String(mib) : mib.toFixed(1);
  return `${text} MiB`;
}

/** Pure retry policy shared by access and listing failures. */
export function providerRetryDelayMs(failures: number): number {
  if (!Number.isSafeInteger(failures) || failures < 1)
    throw new RangeError("failures must be a positive safe integer");
  // Avoid exponent overflow for long-running workers.
  return Math.min(60, 5 * 2 ** Math.min(failures - 1, 4)) * 60_000;
}

/**
 * Pick a safe monitoring interval for a movie based on user priority and the
 * provider's request budget. Pure helper: no network requests or seat actions.
 */
export type MonitoringPriority = "critical" | "high" | "normal" | "low";

const TARGET_SECONDS: Record<MonitoringPriority, number> = {
  critical: 120,
  high: 180,
  normal: 300,
  low: 1800,
};

export function monitoringIntervalSeconds(
  priority: MonitoringPriority,
  minimumSafeSeconds = 120,
): number {
  if (!Number.isFinite(minimumSafeSeconds) || minimumSafeSeconds <= 0)
    throw new RangeError("minimumSafeSeconds must be positive and finite");
  return Math.max(TARGET_SECONDS[priority], Math.ceil(minimumSafeSeconds));
}

# Monitoring priority rollout (experimental)

The cloud movie scheduler supports an optional `MONITOR_PRIORITY_TIER` setting:
`critical` (target 120s), `high` (180s), `normal` (300s, default),
or `low` (1800s). This is **global**, not a per-movie user preference.

Actual interval is the maximum of the tier target, the existing
`MONITOR_INTERVAL_SECONDS` floor, and the provider rate-budget estimate.
Choosing `critical` does not guarantee a two-minute check.

Do not change production variables yet. Validate unit tests, TypeScript,
provider access and quotas in a preview environment first. The laptop Scene
worker has its own Windows Task Scheduler cadence and is not controlled by
this variable. The Windows task must be reinstalled to adopt the new default.

This feature does **not** detect available seats or use any seat-locking
endpoint. Leave the PR in draft until validation and a rollback plan exist.

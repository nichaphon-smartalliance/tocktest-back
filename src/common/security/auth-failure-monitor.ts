// Lightweight in-memory detector for repeated authentication failures from a
// single source IP. When failures cross a threshold inside a rolling window it
// emits ONE structured `security_alert` log line that an external log/alerting
// pipeline (Loki, CloudWatch, Datadog, …) can trigger on. Deliberately simple:
// no external deps, bounded memory, resets per window.

const WINDOW_MS = 60_000;
const ALERT_THRESHOLD = 10;
const MAX_TRACKED_IPS = 10_000;

interface Bucket {
  count: number;
  windowStart: number;
  alerted: boolean;
}

const buckets = new Map<string, Bucket>();

type AlertEmitter = (entry: Record<string, unknown>) => void;

/**
 * Records one auth failure for `ip`. Emits a single alert per window once the
 * threshold is crossed. Returns true when an alert was emitted this call.
 */
export function recordAuthFailure(ip: string, emit: AlertEmitter): boolean {
  const now = Date.now();

  // Opportunistic pruning so the map can't grow unbounded under IP churn.
  if (buckets.size > MAX_TRACKED_IPS) {
    for (const [key, b] of buckets) {
      if (now - b.windowStart > WINDOW_MS) buckets.delete(key);
    }
  }

  let bucket = buckets.get(ip);
  if (!bucket || now - bucket.windowStart > WINDOW_MS) {
    bucket = { count: 0, windowStart: now, alerted: false };
    buckets.set(ip, bucket);
  }

  bucket.count += 1;

  if (bucket.count >= ALERT_THRESHOLD && !bucket.alerted) {
    bucket.alerted = true;
    emit({
      level: 'error',
      event: 'security_alert',
      alert: 'repeated_auth_failures',
      ip,
      failures: bucket.count,
      windowMs: WINDOW_MS,
    });
    return true;
  }

  return false;
}

// Test-only helper to reset state between cases.
export function __resetAuthFailureMonitor(): void {
  buckets.clear();
}

type Bucket = { tokens: number; refilledAt: number };

const buckets = new Map<string, Bucket>();

export type RateLimitOptions = {
  capacity: number;
  intervalMs: number;
};

export type RateLimitResult = {
  allowed: boolean;
  remaining: number;
  retryAfterMs: number;
};

export function checkRateLimit(
  key: string,
  opts: RateLimitOptions,
  now: number = Date.now()
): RateLimitResult {
  const { capacity, intervalMs } = opts;
  const refillPerMs = capacity / intervalMs;

  let b = buckets.get(key);
  if (!b) {
    b = { tokens: capacity, refilledAt: now };
    buckets.set(key, b);
  }

  const elapsed = Math.max(0, now - b.refilledAt);
  b.tokens = Math.min(capacity, b.tokens + elapsed * refillPerMs);
  b.refilledAt = now;

  if (b.tokens >= 1) {
    b.tokens -= 1;
    return { allowed: true, remaining: Math.floor(b.tokens), retryAfterMs: 0 };
  }

  const needed = 1 - b.tokens;
  const retryAfterMs = Math.ceil(needed / refillPerMs);
  return { allowed: false, remaining: 0, retryAfterMs };
}

export function _resetRateLimits() {
  buckets.clear();
}

export function clientIpFromRequest(req: Request): string {
  const xff = req.headers.get('x-forwarded-for');
  if (xff) {
    const first = xff.split(',')[0]?.trim();
    if (first) return first;
  }
  return (
    req.headers.get('x-real-ip') ||
    req.headers.get('cf-connecting-ip') ||
    'unknown'
  );
}

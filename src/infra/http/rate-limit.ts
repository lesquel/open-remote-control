export interface RateLimitPolicy {
  limit: number
  windowMs: number
}

export interface RateLimitResult {
  allowed: boolean
  remaining: number
  retryAfterSeconds: number
}

interface Bucket {
  count: number
  resetAt: number
}

export interface RateLimiter {
  consume(key: string, policy: RateLimitPolicy, now?: number): RateLimitResult
  size(): number
}

export function createRateLimiter(maxEntries = 10_000): RateLimiter {
  const buckets = new Map<string, Bucket>()

  function prune(now: number): void {
    for (const [key, bucket] of buckets) {
      if (bucket.resetAt <= now) buckets.delete(key)
    }
    while (buckets.size >= maxEntries) {
      const oldest = buckets.keys().next().value as string | undefined
      if (oldest === undefined) break
      buckets.delete(oldest)
    }
  }

  function consume(key: string, policy: RateLimitPolicy, now = Date.now()): RateLimitResult {
    let bucket = buckets.get(key)
    if (!bucket || bucket.resetAt <= now) {
      if (buckets.size >= maxEntries) prune(now)
      bucket = { count: 0, resetAt: now + policy.windowMs }
      buckets.set(key, bucket)
    }
    bucket.count += 1
    const allowed = bucket.count <= policy.limit
    return {
      allowed,
      remaining: Math.max(0, policy.limit - bucket.count),
      retryAfterSeconds: allowed ? 0 : Math.max(1, Math.ceil((bucket.resetAt - now) / 1_000)),
    }
  }

  return { consume, size: () => buckets.size }
}

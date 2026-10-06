import { NextResponse } from "next/server";

/**
 * Simple in-memory sliding-window rate limiter keyed by IP.
 *
 * NOTE: Suitable for the single-process deployment. A production
 * deployment behind multiple instances/replicas would need a shared store
 * (Redis, etc.). This is intentionally small and dependency-free.
 */

interface Window {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, Window>();

const WINDOW_MS = 60_000;
const MAX_WINDOW_SIZE = 100_000;

function keyFor(req: Request): string {
  const forwarded = req.headers.get("x-forwarded-for");
  const ip = forwarded ? forwarded.split(",")[0].trim() : "unknown";
  return ip;
}

function sweep(now: number): void {
  if (buckets.size < MAX_WINDOW_SIZE) return;
  for (const [k, v] of buckets) {
    if (v.resetAt <= now) buckets.delete(k);
  }
}

/**
 * Enforce a per-IP limit. Returns null when the request is allowed, or a 429
 * NextResponse when the limit is exceeded.
 */
export function rateLimit(req: Request, limit: number, windowMs = WINDOW_MS): NextResponse | null {
  const now = Date.now();
  sweep(now);

  const key = keyFor(req);
  let bucket = buckets.get(key);

  if (!bucket || bucket.resetAt <= now) {
    bucket = { count: 1, resetAt: now + windowMs };
    buckets.set(key, bucket);
    return null;
  }

  bucket.count += 1;
  if (bucket.count > limit) {
    const retryAfter = Math.max(1, Math.ceil((bucket.resetAt - now) / 1000));
    return NextResponse.json(
      { error: "RATE_LIMITED", message: "Too many requests. Please try again shortly." },
      { status: 429, headers: { "Retry-After": String(retryAfter) } }
    );
  }

  return null;
}

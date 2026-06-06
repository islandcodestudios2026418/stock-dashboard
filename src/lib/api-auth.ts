import { NextRequest, NextResponse } from "next/server";

// API keys: stored in env as comma-separated list
// e.g. API_KEYS=key1,key2,key3
function getValidKeys(): Set<string> {
  const raw = process.env.API_KEYS || "";
  return new Set(raw.split(",").map(k => k.trim()).filter(Boolean));
}

export function checkApiKey(req: NextRequest): NextResponse | null {
  // Only accept API key via header (never URL — avoids logging/leakage)
  const key = req.headers.get("x-api-key") || "";
  const validKeys = getValidKeys();
  if (validKeys.size === 0) {
    // Fail closed: no keys configured = reject all requests
    return NextResponse.json({ error: "API 未設定金鑰", code: "MISCONFIGURED" }, { status: 500 });
  }
  if (!validKeys.has(key)) {
    return NextResponse.json({ error: "無效的 API Key", code: "UNAUTHORIZED" }, { status: 401 });
  }
  return null;
}

// Simple in-memory rate limiter: per-key, sliding window
const hits = new Map<string, number[]>();
const WINDOW_MS = 60_000; // 1 minute
const MAX_REQUESTS = Number(process.env.API_RATE_LIMIT) || 30; // 30 req/min default

export function checkRateLimit(req: NextRequest): NextResponse | null {
  const key = req.headers.get("x-api-key") || req.nextUrl.searchParams.get("api_key") || req.headers.get("x-forwarded-for") || "anon";
  const now = Date.now();
  const timestamps = (hits.get(key) || []).filter(t => now - t < WINDOW_MS);
  if (timestamps.length >= MAX_REQUESTS) {
    return NextResponse.json(
      { error: "超過速率限制，請稍後再試", code: "RATE_LIMITED", retryAfter: Math.ceil(WINDOW_MS / 1000) },
      { status: 429, headers: { "Retry-After": String(Math.ceil(WINDOW_MS / 1000)) } }
    );
  }
  timestamps.push(now);
  hits.set(key, timestamps);
  return null;
}

export function apiGuard(req: NextRequest): NextResponse | null {
  return checkApiKey(req) || checkRateLimit(req);
}

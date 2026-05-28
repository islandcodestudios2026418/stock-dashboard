import { NextRequest, NextResponse } from "next/server";

// This endpoint is called by kiro-cli (via OpenAB cron) to get the watchlist
// and save analysis results. Protected by CRON_SECRET.

const CRON_SECRET = process.env.CRON_SECRET || "";

function checkAuth(req: NextRequest): boolean {
  const auth = req.headers.get("authorization");
  return !CRON_SECRET || auth === `Bearer ${CRON_SECRET}`;
}

// GET: Return the watchlist for cron to analyze
export async function GET(req: NextRequest) {
  if (!checkAuth(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // For now, return hardcoded watchlist. Later: read from Supabase per user.
  const watchlist = (process.env.WATCHLIST || "NASDAQ:TSLA,NASDAQ:NVDA,NASDAQ:AAPL,TWSE:2330,TWSE:2454").split(",");
  return NextResponse.json({ watchlist });
}

// POST: Save analysis result (called by kiro-cli after analysis)
export async function POST(req: NextRequest) {
  if (!checkAuth(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { symbol, analysis, indicators, tradePlan, date } = await req.json();
  if (!symbol || !analysis) return NextResponse.json({ error: "Missing symbol or analysis" }, { status: 400 });

  // For now, write to a local JSON cache file. Later: Supabase.
  const fs = await import("fs/promises");
  const path = await import("path");
  const cacheDir = path.join(process.cwd(), ".analysis-cache");
  await fs.mkdir(cacheDir, { recursive: true });

  const today = date || new Date().toISOString().split("T")[0];
  const cacheFile = path.join(cacheDir, `${symbol.replace(/[:/]/g, "_")}_${today}.json`);
  await fs.writeFile(cacheFile, JSON.stringify({ symbol, date: today, analysis, indicators, tradePlan, ts: Date.now() }));

  return NextResponse.json({ ok: true, cached: cacheFile });
}

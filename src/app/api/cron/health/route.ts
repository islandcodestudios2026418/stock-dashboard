import { NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";

// GET /api/cron/health — unauthenticated health check for Zeabur
export async function GET() {
  const cacheDir = path.join(process.cwd(), ".analysis-cache");
  const summaryFile = path.join(cacheDir, "_last_run.json");

  let lastRun: { date: string; ts: number } | null = null;
  try {
    const raw = await fs.readFile(summaryFile, "utf-8");
    lastRun = JSON.parse(raw);
  } catch { /* no runs yet */ }

  const ageMs = lastRun ? Date.now() - lastRun.ts : Infinity;
  const healthy = lastRun ? ageMs < 172800000 : true; // <2 days or first deploy

  return NextResponse.json({
    status: healthy ? "ok" : "stale",
    uptime: process.uptime(),
    lastRun: lastRun?.date ?? null,
    ageHours: lastRun ? Math.round(ageMs / 3600000 * 10) / 10 : null,
  });
}

import { NextRequest, NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";

// GET /api/cron/status
// Returns last run summary and health check info.

const CRON_SECRET = process.env.CRON_SECRET || "";

function checkAuth(req: NextRequest): boolean {
  if (!CRON_SECRET) return false;
  const auth = req.headers.get("authorization");
  const querySecret = req.nextUrl.searchParams.get("secret");
  return auth === `Bearer ${CRON_SECRET}` || querySecret === CRON_SECRET;
}

export async function GET(req: NextRequest) {
  if (!checkAuth(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const cacheDir = path.join(process.cwd(), ".analysis-cache");
  const summaryFile = path.join(cacheDir, "_last_run.json");

  try {
    const raw = await fs.readFile(summaryFile, "utf-8");
    const lastRun = JSON.parse(raw);
    const ageMs = Date.now() - lastRun.ts;
    const ageHours = (ageMs / 3600000).toFixed(1);

    return NextResponse.json({
      healthy: ageMs < 86400000 * 2, // healthy if last run < 2 days ago
      lastRun: lastRun.date,
      ageHours: Number(ageHours),
      results: lastRun.results,
    });
  } catch {
    return NextResponse.json({ healthy: false, lastRun: null, message: "No analysis has been run yet" });
  }
}

import { NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";

// GET /api/cron/results
// Returns all cached analysis from today (or latest run).
// No auth required — dashboard reads this publicly.

export async function GET() {
  const cacheDir = path.join(process.cwd(), ".analysis-cache");

  try {
    const summaryRaw = await fs.readFile(path.join(cacheDir, "_last_run.json"), "utf-8");
    const summary = JSON.parse(summaryRaw);
    const date = summary.date as string;

    // Read all individual analysis files for that date
    const files = await fs.readdir(cacheDir);
    const dayFiles = files.filter(f => f.endsWith(`_${date}.json`) && !f.startsWith("_"));

    const analyses = await Promise.all(
      dayFiles.map(async (f) => {
        const raw = await fs.readFile(path.join(cacheDir, f), "utf-8");
        return JSON.parse(raw);
      })
    );

    return NextResponse.json({
      date,
      ts: summary.ts,
      count: analyses.length,
      results: analyses,
    });
  } catch {
    return NextResponse.json({ date: null, count: 0, results: [] });
  }
}

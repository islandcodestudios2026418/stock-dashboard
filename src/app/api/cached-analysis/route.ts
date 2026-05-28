import { NextRequest, NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";

// GET /api/cached-analysis?symbol=NASDAQ:TSLA
// Returns today's pre-computed analysis if available
export async function GET(req: NextRequest) {
  const symbol = req.nextUrl.searchParams.get("symbol");
  if (!symbol) return NextResponse.json({ error: "Missing symbol" }, { status: 400 });

  const cacheDir = path.join(process.cwd(), ".analysis-cache");
  const today = new Date().toISOString().split("T")[0];
  const cacheFile = path.join(cacheDir, `${symbol.replace(/[:/]/g, "_")}_${today}.json`);

  try {
    const raw = await fs.readFile(cacheFile, "utf-8");
    return NextResponse.json(JSON.parse(raw));
  } catch {
    return NextResponse.json({ cached: false }, { status: 404 });
  }
}

import { NextRequest, NextResponse } from "next/server";
import { apiGuard } from "@/lib/api-auth";
import { promises as fs } from "fs";
import path from "path";

export async function GET(req: NextRequest) {
  const blocked = apiGuard(req);
  if (blocked) return blocked;

  const symbol = req.nextUrl.searchParams.get("symbol") || "";
  const date = req.nextUrl.searchParams.get("date") || new Date().toISOString().split("T")[0];
  if (!symbol) return NextResponse.json({ error: "缺少 symbol 參數", code: "BAD_REQUEST" }, { status: 400 });

  const cacheDir = path.join(process.cwd(), ".analysis-cache");
  const cacheFile = path.join(cacheDir, `${symbol.replace(/[:/]/g, "_")}_${date}.json`);

  try {
    const raw = await fs.readFile(cacheFile, "utf-8");
    const data = JSON.parse(raw);
    return NextResponse.json({ symbol, date, analysis: data.analysis, indicators: data.indicators, tradePlan: data.tradePlan });
  } catch {
    return NextResponse.json({ error: "此日期無快取分析結果", code: "NOT_FOUND", symbol, date }, { status: 404 });
  }
}

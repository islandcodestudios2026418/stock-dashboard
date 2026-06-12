import { NextRequest, NextResponse } from "next/server";

// POST /api/cron/manual — one-click trigger from dashboard UI
// Uses same auth as other cron endpoints but designed for browser fetch()
const CRON_SECRET = process.env.CRON_SECRET || "";

export async function POST(req: NextRequest) {
  const auth = req.headers.get("authorization");
  if (!CRON_SECRET || auth !== `Bearer ${CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || process.env.ZEABUR_URL || req.nextUrl.origin;
  const res = await fetch(`${baseUrl}/api/cron/run-analysis`, {
    method: "POST",
    headers: { Authorization: `Bearer ${CRON_SECRET}` },
  });
  const data = await res.json();
  return NextResponse.json(data, { status: res.status });
}

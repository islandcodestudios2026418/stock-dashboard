import { NextRequest, NextResponse } from "next/server";

// GET/POST /api/cron/trigger
// External cron endpoint for Zeabur's cron service to hit.
// Validates CRON_SECRET then internally calls run-analysis.

const CRON_SECRET = process.env.CRON_SECRET || "";

function checkAuth(req: NextRequest): boolean {
  if (!CRON_SECRET) return false;
  // Support both header and query param for cron services
  const auth = req.headers.get("authorization");
  const querySecret = req.nextUrl.searchParams.get("secret");
  return auth === `Bearer ${CRON_SECRET}` || querySecret === CRON_SECRET;
}

async function runAnalysis(req: NextRequest): Promise<NextResponse> {
  if (!checkAuth(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || process.env.ZEABUR_URL || "http://localhost:3000";

  try {
    const res = await fetch(`${baseUrl}/api/cron/run-analysis`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${CRON_SECRET}`,
        "Content-Type": "application/json",
      },
    });
    const data = await res.json();

    // Fire morning brief after analysis completes (non-blocking)
    fetch(`${baseUrl}/api/cron/morning-brief?secret=${CRON_SECRET}`).catch(() => {});

    return NextResponse.json({ triggered: true, ...data }, { status: res.status });
  } catch (err) {
    return NextResponse.json(
      { triggered: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}

// Zeabur cron uses GET by default
export async function GET(req: NextRequest) {
  return runAnalysis(req);
}

export async function POST(req: NextRequest) {
  return runAnalysis(req);
}

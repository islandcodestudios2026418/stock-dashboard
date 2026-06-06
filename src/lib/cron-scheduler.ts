// Lightweight cron scheduler - triggers POST to /api/cron/daily-analysis at 20:30 Taiwan time daily

const TAIWAN_TZ = "Asia/Taipei";
const TARGET_HOUR = 20;
const TARGET_MINUTE = 30;

function msUntilNext2030(): number {
  const now = new Date();
  const taiwanNow = new Date(now.toLocaleString("en-US", { timeZone: TAIWAN_TZ }));
  const target = new Date(taiwanNow);
  target.setHours(TARGET_HOUR, TARGET_MINUTE, 0, 0);
  if (taiwanNow >= target) target.setDate(target.getDate() + 1);
  // Skip weekends (Sat=6, Sun=0)
  while (target.getDay() === 0 || target.getDay() === 6) {
    target.setDate(target.getDate() + 1);
  }
  return target.getTime() - taiwanNow.getTime();
}

async function triggerAnalysis() {
  const secret = process.env.CRON_SECRET;
  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || process.env.ZEABUR_URL || "http://localhost:3000";

  try {
    // 1. GET watchlist
    const listRes = await fetch(`${baseUrl}/api/cron/daily-analysis`, {
      headers: { Authorization: `Bearer ${secret}` },
    });
    const { watchlist } = await listRes.json() as { watchlist: string[] };
    console.log(`[CRON] ${new Date().toISOString()} Analyzing ${watchlist.length} symbols`);

    // 2. POST analysis for each symbol (placeholder - real AI analysis goes here)
    for (const symbol of watchlist) {
      await fetch(`${baseUrl}/api/cron/daily-analysis`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${secret}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          symbol,
          analysis: `Scheduled analysis pending - ${symbol}`,
          indicators: {},
          tradePlan: null,
          date: new Date().toISOString().split("T")[0],
        }),
      });
    }
    console.log(`[CRON] Analysis complete for ${watchlist.length} symbols`);
  } catch (err) {
    console.error("[CRON] Analysis failed:", err);
  }
}

export function scheduleDailyAnalysis() {
  function scheduleNext() {
    const ms = msUntilNext2030();
    const hours = Math.round(ms / 3600000 * 10) / 10;
    console.log(`[CRON] Next analysis in ${hours}h (20:30 Taiwan time)`);
    setTimeout(async () => {
      await triggerAnalysis();
      scheduleNext();
    }, ms);
  }
  scheduleNext();
  console.log("[CRON] Daily analysis scheduler started (20:30 Asia/Taipei, weekdays)");
}

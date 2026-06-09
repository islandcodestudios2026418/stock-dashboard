// Cron scheduler: triggers POST /api/cron/run-analysis at 20:30 Taiwan time (weekdays)
// Also used as fallback if Zeabur external cron fails

const TAIWAN_TZ = "Asia/Taipei";
const TARGET_HOUR = 20;
const TARGET_MINUTE = 30;

function msUntilNext(): number {
  const now = new Date();
  const taiwanNow = new Date(now.toLocaleString("en-US", { timeZone: TAIWAN_TZ }));
  const target = new Date(taiwanNow);
  target.setHours(TARGET_HOUR, TARGET_MINUTE, 0, 0);
  if (taiwanNow >= target) target.setDate(target.getDate() + 1);
  while (target.getDay() === 0 || target.getDay() === 6) {
    target.setDate(target.getDate() + 1);
  }
  return target.getTime() - taiwanNow.getTime();
}

async function triggerAnalysis() {
  const secret = process.env.CRON_SECRET;
  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || process.env.ZEABUR_URL || "http://localhost:3000";

  try {
    console.log(`[CRON] ${new Date().toISOString()} Triggering run-analysis...`);
    const res = await fetch(`${baseUrl}/api/cron/run-analysis`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${secret}`,
        "Content-Type": "application/json",
      },
    });
    const data = await res.json();
    if (!res.ok) {
      console.error("[CRON] Analysis failed:", data);
      return;
    }
    console.log(`[CRON] Analysis complete:`, JSON.stringify(data.results?.map((r: any) => `${r.symbol}: ${r.status}`)));
  } catch (err) {
    console.error("[CRON] Trigger failed:", err);
  }
}

export function scheduleDailyAnalysis() {
  function scheduleNext() {
    const ms = msUntilNext();
    const hours = Math.round(ms / 3600000 * 10) / 10;
    console.log(`[CRON] Next analysis in ${hours}h (${TARGET_HOUR}:${TARGET_MINUTE} Taiwan time)`);
    setTimeout(async () => {
      await triggerAnalysis();
      scheduleNext();
    }, ms);
  }
  scheduleNext();
  console.log("[CRON] Daily analysis scheduler started (20:30 Asia/Taipei, weekdays)");
}

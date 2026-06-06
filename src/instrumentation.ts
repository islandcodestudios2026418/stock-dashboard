// Self-scheduling cron for Zeabur (persistent Node.js server)
// Triggers daily analysis at 20:30 Taiwan time (8:30 AM ET, pre-market)

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { scheduleDailyAnalysis } = await import("./lib/cron-scheduler");
    scheduleDailyAnalysis();
  }
}

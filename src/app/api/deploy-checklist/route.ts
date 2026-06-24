import { NextResponse } from "next/server";

// GET /api/deploy-checklist — shows what's configured vs missing for full operation
// No auth needed — doesn't expose secret values, just status

export async function GET() {
  const checks = [
    { name: "CRON_SECRET", status: !!process.env.CRON_SECRET, required: true },
    { name: "NEXT_PUBLIC_SUPABASE_URL", status: !!process.env.NEXT_PUBLIC_SUPABASE_URL, required: true },
    { name: "SUPABASE_SERVICE_ROLE_KEY", status: !!process.env.SUPABASE_SERVICE_ROLE_KEY, required: true },
    { name: "TELEGRAM_BOT_TOKEN", status: !!process.env.TELEGRAM_BOT_TOKEN, required: true },
    { name: "TELEGRAM_CHAT_ID", status: !!process.env.TELEGRAM_CHAT_ID, required: true },
    { name: "DISCORD_WEBHOOK_URL", status: !!process.env.DISCORD_WEBHOOK_URL, required: false },
    { name: "FINNHUB_API_KEY", status: !!process.env.FINNHUB_API_KEY, required: false },
    { name: "IBKR_GATEWAY_URL", status: !!process.env.IBKR_GATEWAY_URL, required: false },
    { name: "IBKR_ACCOUNT_ID", status: !!process.env.IBKR_ACCOUNT_ID, required: false },
    { name: "IBKR_LIVE", status: process.env.IBKR_LIVE === "true", required: false },
    { name: "IBKR_AUTO_EXECUTE", status: process.env.IBKR_AUTO_EXECUTE === "true", required: false },
    { name: "ZEABUR_URL", status: !!process.env.ZEABUR_URL, required: true },
  ];

  const required = checks.filter(c => c.required);
  const optional = checks.filter(c => !c.required);
  const missingRequired = required.filter(c => !c.status);
  const ready = missingRequired.length === 0;

  const nextSteps = [];
  if (!ready) nextSteps.push(`Set missing env vars: ${missingRequired.map(c => c.name).join(", ")}`);
  if (!process.env.TELEGRAM_BOT_TOKEN) nextSteps.push("Set Telegram webhook: curl 'https://api.telegram.org/bot<TOKEN>/setWebhook?url=<ZEABUR_URL>/api/telegram/webhook'");
  if (!process.env.IBKR_GATEWAY_URL) nextSteps.push("(Optional) Deploy IBKR Client Portal Gateway Docker for auto-execution");
  if (ready) nextSteps.push("Trigger manual test: GET /api/cron/trigger?secret=<SECRET>");
  if (ready) nextSteps.push("Run integration test: GET /api/cron/integration-test?secret=<SECRET>");

  return NextResponse.json({
    ready,
    checks,
    summary: {
      required: `${required.filter(c => c.status).length}/${required.length} configured`,
      optional: `${optional.filter(c => c.status).length}/${optional.length} configured`,
    },
    nextSteps,
    system: {
      pages: 54,
      cronSchedules: 6,
      endpoints: "30+",
      branch: "feature/weekly-ops-conviction-sectors",
    },
  });
}

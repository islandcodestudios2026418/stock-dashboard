#!/usr/bin/env tsx
// scripts/setup-check.ts — Verify all env vars and service connectivity

import { config } from "dotenv";
config({ path: ".env.local" });

const checks: { name: string; status: "✅" | "⚠️" | "❌"; detail: string }[] = [];

function check(name: string, value: string | undefined, required: boolean) {
  if (value) checks.push({ name, status: "✅", detail: value.slice(0, 20) + "..." });
  else if (required) checks.push({ name, status: "❌", detail: "MISSING (required)" });
  else checks.push({ name, status: "⚠️", detail: "not set (optional)" });
}

// 1. Check env vars
check("CRON_SECRET", process.env.CRON_SECRET, true);
check("NEXT_PUBLIC_SUPABASE_URL", process.env.NEXT_PUBLIC_SUPABASE_URL, true);
check("SUPABASE_SERVICE_ROLE_KEY", process.env.SUPABASE_SERVICE_ROLE_KEY, true);
check("DISCORD_WEBHOOK_URL", process.env.DISCORD_WEBHOOK_URL, false);
check("WATCHLIST", process.env.WATCHLIST, false);
check("ZEABUR_URL", process.env.ZEABUR_URL, false);

// 2. Test Supabase connectivity
async function testSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) { checks.push({ name: "Supabase connectivity", status: "❌", detail: "no credentials" }); return; }
  try {
    const res = await fetch(`${url}/rest/v1/watchlists?select=symbol&limit=1`, {
      headers: { apikey: key, Authorization: `Bearer ${key}` },
    });
    if (res.ok) checks.push({ name: "Supabase connectivity", status: "✅", detail: `HTTP ${res.status}` });
    else checks.push({ name: "Supabase connectivity", status: "❌", detail: `HTTP ${res.status}: ${await res.text()}` });
  } catch (e) {
    checks.push({ name: "Supabase connectivity", status: "❌", detail: String(e) });
  }
}

// 3. Test Yahoo Finance
async function testYahoo() {
  try {
    const mod = await import("yahoo-finance2");
    const YahooFinance = mod.default;
    const yf = new YahooFinance({ suppressNotices: ["yahooSurvey"] });
    const result = await yf.chart("AAPL", { period1: new Date(Date.now() - 7 * 86400000).toISOString().split("T")[0], interval: "1d" });
    const count = result.quotes?.length || 0;
    checks.push({ name: "Yahoo Finance API", status: count > 0 ? "✅" : "⚠️", detail: `${count} quotes returned` });
  } catch (e) {
    checks.push({ name: "Yahoo Finance API", status: "❌", detail: String(e).slice(0, 80) });
  }
}

// 4. Test Discord webhook (dry — HEAD only)
async function testDiscord() {
  const url = process.env.DISCORD_WEBHOOK_URL;
  if (!url) { checks.push({ name: "Discord webhook", status: "⚠️", detail: "not configured" }); return; }
  try {
    const res = await fetch(url, { method: "HEAD" });
    checks.push({ name: "Discord webhook", status: res.status < 400 ? "✅" : "❌", detail: `HTTP ${res.status}` });
  } catch (e) {
    checks.push({ name: "Discord webhook", status: "❌", detail: String(e).slice(0, 80) });
  }
}

async function main() {
  console.log("\n🔍 Stock Dashboard — Setup Check\n");
  await testSupabase();
  await testYahoo();
  await testDiscord();

  const maxName = Math.max(...checks.map(c => c.name.length));
  for (const c of checks) {
    console.log(`  ${c.status} ${c.name.padEnd(maxName)}  ${c.detail}`);
  }

  const failed = checks.filter(c => c.status === "❌");
  console.log(`\n${failed.length === 0 ? "✅ All checks passed!" : `❌ ${failed.length} check(s) failed`}\n`);
  process.exit(failed.length > 0 ? 1 : 0);
}

main();

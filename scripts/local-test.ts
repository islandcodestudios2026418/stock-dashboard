#!/usr/bin/env tsx
// scripts/local-test.ts — Simulates the full cron cycle locally
// Usage: npx tsx scripts/local-test.ts
// Requires: dev server running on http://localhost:3000

const BASE = process.env.BASE_URL || "http://localhost:3000";
const SECRET = process.env.CRON_SECRET || "test-secret";

async function test(name: string, url: string, method = "GET"): Promise<boolean> {
  const start = Date.now();
  try {
    const res = await fetch(url, { method, headers: { Authorization: `Bearer ${SECRET}` } });
    const ms = Date.now() - start;
    const ok = res.status < 400;
    const data = await res.json().catch(() => ({}));
    console.log(`${ok ? "✅" : "❌"} ${name} (${ms}ms) — ${res.status}`);
    if (!ok) console.log("  ", JSON.stringify(data).slice(0, 200));
    return ok;
  } catch (e) {
    console.log(`❌ ${name} — ${e instanceof Error ? e.message : String(e)}`);
    return false;
  }
}

async function main() {
  console.log("\n🧪 Stock Dashboard Local Test\n" + "═".repeat(40));
  console.log(`Base: ${BASE}`);
  console.log(`Secret: ${SECRET.slice(0, 4)}...`);
  console.log("");

  const results: boolean[] = [];

  // 1. Health check (no auth)
  results.push(await test("Health check", `${BASE}/api/cron/health`));

  // 2. Deploy checklist (no auth)
  results.push(await test("Deploy checklist", `${BASE}/api/deploy-checklist`));

  // 3. Dashboard summary (no auth)
  results.push(await test("Dashboard summary", `${BASE}/api/dashboard/summary`));

  // 4. Single symbol test (no auth)
  results.push(await test("Single symbol test", `${BASE}/api/cron/test?symbol=AAPL`));

  // 5. Integration test (auth)
  results.push(await test("Integration test", `${BASE}/api/cron/integration-test?secret=${SECRET}`));

  // 6. Verify endpoint (auth)
  results.push(await test("Verify pipeline", `${BASE}/api/cron/verify?secret=${SECRET}`));

  // 7. Trigger full analysis (auth)
  console.log("\n--- Full Analysis (may take 30-60s) ---");
  results.push(await test("Full analysis (dry)", `${BASE}/api/cron/run-analysis?dry=1`, "POST"));

  // 8. Sector rotation
  results.push(await test("Sector rotation", `${BASE}/api/cron/sector-rotation?secret=${SECRET}`));

  // 9. Structural shift
  results.push(await test("Structural shift", `${BASE}/api/cron/structural-shift?secret=${SECRET}`));

  // 10. Watchlist
  results.push(await test("Watchlist", `${BASE}/api/cron/watchlist`));

  // 11. Scoring history
  results.push(await test("Scoring history", `${BASE}/api/cron/history?symbol=NVDA&days=7`));

  // Summary
  const passed = results.filter(Boolean).length;
  const total = results.length;
  console.log(`\n${"═".repeat(40)}`);
  console.log(`${passed === total ? "🟢" : "🟡"} ${passed}/${total} tests passed`);
  if (passed < total) console.log("⚠️  Some tests failed — check env vars and Supabase connection");
  process.exit(passed === total ? 0 : 1);
}

main();

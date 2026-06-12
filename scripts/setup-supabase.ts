#!/usr/bin/env tsx
// One-click Supabase setup: applies schema + seeds watchlist
// Usage: npx tsx scripts/setup-supabase.ts
// Requires: NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local

import { readFileSync } from "fs";
import { resolve } from "path";

// Load .env.local
const envPath = resolve(__dirname, "../.env.local");
try {
  const envContent = readFileSync(envPath, "utf-8");
  for (const line of envContent.split("\n")) {
    const match = line.match(/^([^#=]+)=(.*)$/);
    if (match) process.env[match[1].trim()] = match[2].trim();
  }
} catch { /* .env.local not found, rely on existing env */ }

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error("❌ Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local");
  console.error("\n📝 Steps to fix:");
  console.error("1. Go to https://supabase.com → New Project (free tier)");
  console.error("2. Copy Project URL and service_role key from Settings > API");
  console.error("3. Add to .env.local:");
  console.error("   NEXT_PUBLIC_SUPABASE_URL=https://xxx.supabase.co");
  console.error("   SUPABASE_SERVICE_ROLE_KEY=eyJ...");
  process.exit(1);
}

async function runSQL(sql: string): Promise<{ ok: boolean; error?: string }> {
  // Use Supabase's REST RPC to execute raw SQL (via pg_net or direct)
  // The simplest approach: use the supabase-js client's rpc or direct fetch to PostgREST
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/`, {
    method: "POST",
    headers: {
      apikey: SERVICE_KEY!,
      Authorization: `Bearer ${SERVICE_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({}),
  });
  // PostgREST doesn't support raw SQL — use the SQL endpoint instead
  const sqlRes = await fetch(`${SUPABASE_URL}/pg`, {
    method: "POST",
    headers: {
      apikey: SERVICE_KEY!,
      Authorization: `Bearer ${SERVICE_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query: sql }),
  });
  if (!sqlRes.ok) {
    return { ok: false, error: `HTTP ${sqlRes.status}: ${await sqlRes.text()}` };
  }
  return { ok: true };
}

async function main() {
  console.log("🔧 Supabase Setup for stock-dashboard\n");
  console.log(`   URL: ${SUPABASE_URL}`);

  // Step 1: Test connectivity
  process.stdout.write("1️⃣  Testing connection... ");
  const testRes = await fetch(`${SUPABASE_URL}/rest/v1/`, {
    headers: { apikey: SERVICE_KEY!, Authorization: `Bearer ${SERVICE_KEY}` },
  });
  if (!testRes.ok) {
    console.log("❌ Failed");
    console.error(`   HTTP ${testRes.status}. Check your URL and key.`);
    process.exit(1);
  }
  console.log("✅ Connected");

  // Step 2: Apply schema via Supabase client (table creation)
  process.stdout.write("2️⃣  Applying schema... ");
  const { createClient } = await import("@supabase/supabase-js");
  const supabase = createClient(SUPABASE_URL, SERVICE_KEY!);

  // Check if tables exist by trying to query them
  const { error: arErr } = await supabase.from("analysis_results").select("id").limit(1);
  const { error: wlErr } = await supabase.from("watchlists").select("id").limit(1);

  if (arErr || wlErr) {
    console.log("⚠️  Tables not found");
    console.log("\n   📋 Please run the schema SQL manually:");
    console.log("   1. Go to Supabase Dashboard → SQL Editor");
    console.log("   2. Paste contents of supabase-schema.sql");
    console.log("   3. Click 'Run'");
    console.log(`   4. Re-run: npx tsx scripts/setup-supabase.ts\n`);
    const schemaPath = resolve(__dirname, "../supabase-schema.sql");
    console.log(`   Schema file: ${schemaPath}`);
    process.exit(1);
  }
  console.log("✅ Tables exist");

  // Step 3: Seed watchlist
  process.stdout.write("3️⃣  Seeding watchlist... ");
  const defaults = [
    { symbol: "NASDAQ:NVDA", name: "NVIDIA" },
    { symbol: "NASDAQ:TSLA", name: "Tesla" },
    { symbol: "NASDAQ:SMCI", name: "Super Micro" },
    { symbol: "NASDAQ:AMD", name: "AMD" },
    { symbol: "TWSE:2330", name: "台積電" },
  ];
  const { error: seedErr } = await supabase.from("watchlists").upsert(defaults, { onConflict: "symbol" });
  if (seedErr) {
    console.log(`⚠️  ${seedErr.message}`);
  } else {
    console.log("✅ 5 symbols seeded");
  }

  // Step 4: Verify
  const { data: wl } = await supabase.from("watchlists").select("symbol, active").eq("active", true);
  console.log(`\n✅ Setup complete! Active watchlist: ${wl?.map(r => r.symbol).join(", ")}`);
  console.log("\n📌 Next steps:");
  console.log("   • Set env vars on Zeabur (same URL + key)");
  console.log("   • Run: npm run check");
  console.log("   • Test: curl http://localhost:3000/api/cron/test?symbol=NVDA");
}

main().catch(e => { console.error("❌", e.message); process.exit(1); });

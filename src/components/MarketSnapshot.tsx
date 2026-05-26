"use client";
import { OHLCV } from "@/lib/indicators";

interface Props { data: OHLCV[]; name: string; symbol: string; }

function fmt(n: number | undefined | null, decimals = 2) {
  if (n == null || isNaN(n)) return "—";
  return n.toLocaleString(undefined, { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

function fmtVol(n: number) {
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
  return n.toLocaleString();
}

export default function MarketSnapshot({ data, name, symbol }: Props) {
  if (data.length === 0) return null;
  const latest = data[data.length - 1];
  const prev = data.length > 1 ? data[data.length - 2] : latest;
  const change = latest.close - prev.close;
  const changePct = (change / prev.close) * 100;
  const isUp = change >= 0;
  const high52 = Math.max(...data.map(d => d.high));
  const low52 = Math.min(...data.map(d => d.low));

  return (
    <div className="glass-card p-4">
      <div className="flex items-center gap-2 mb-2">
        <span className="pulse-live w-2 h-2 rounded-full bg-[var(--neon-green)]" />
        <span className="text-xs text-[var(--text-secondary)]">{symbol}</span>
      </div>
      <div className="text-base font-semibold mb-1 truncate">{name}</div>
      <div className={`text-3xl font-bold font-mono ${isUp ? "price-up" : "price-down"}`}>
        {fmt(latest.close, 2)}
      </div>
      <div className={`text-sm font-medium mt-0.5 ${isUp ? "price-up" : "price-down"}`}>
        {isUp ? "+" : ""}{fmt(change, 2)} ({isUp ? "+" : ""}{changePct.toFixed(2)}%) {isUp ? "▲" : "▼"}
      </div>
      <div className="grid grid-cols-2 gap-x-3 gap-y-2 mt-3 text-sm">
        <Row label="開盤" value={fmt(latest.open, 2)} />
        <Row label="最高" value={fmt(latest.high, 2)} />
        <Row label="最低" value={fmt(latest.low, 2)} />
        <Row label="收盤" value={fmt(latest.close, 2)} />
        <Row label="成交量" value={fmtVol(latest.volume)} />
        <Row label="52週高" value={fmt(high52, 2)} />
        <Row label="52週低" value={fmt(low52, 2)} />
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between">
      <span className="text-[var(--text-secondary)]">{label}</span>
      <span className="font-mono text-[var(--text-primary)]">{value}</span>
    </div>
  );
}

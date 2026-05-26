"use client";
import { OHLCV } from "@/lib/indicators";

interface Props {
  data: OHLCV[];
  name: string;
  symbol: string;
}

function fmt(n: number, decimals = 2) {
  return n.toLocaleString(undefined, { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

function fmtVol(n: number) {
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
  return n.toString();
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
      <div className="flex items-center gap-2 mb-3">
        <h3 className="text-sm font-semibold text-[var(--neon-cyan)]">即時行情</h3>
        <span className="pulse-live w-1.5 h-1.5 rounded-full bg-[var(--neon-green)]" />
      </div>
      <div className="mb-2">
        <div className="text-xs text-[var(--text-secondary)]">{symbol}</div>
        <div className="text-lg font-semibold truncate">{name}</div>
      </div>
      <div className={`text-3xl font-bold ${isUp ? "price-up" : "price-down"}`}>
        {fmt(latest.close, 3)}
      </div>
      <div className={`text-sm font-medium ${isUp ? "price-up" : "price-down"}`}>
        {isUp ? "+" : ""}{fmt(change, 3)} ({isUp ? "+" : ""}{changePct.toFixed(2)}%)
        <span className="ml-1">{isUp ? "▲" : "▼"}</span>
      </div>
      <div className="grid grid-cols-2 gap-x-4 gap-y-1 mt-3 text-xs">
        <Row label="開盤" value={fmt(latest.open, 3)} />
        <Row label="最高" value={fmt(latest.high, 3)} />
        <Row label="最低" value={fmt(latest.low, 3)} />
        <Row label="收盤" value={fmt(latest.close, 3)} />
        <Row label="成交量" value={fmtVol(latest.volume)} />
        <Row label="52週高" value={fmt(high52, 3)} />
        <Row label="52週低" value={fmt(low52, 3)} />
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between">
      <span className="text-[var(--text-secondary)]">{label}</span>
      <span>{value}</span>
    </div>
  );
}

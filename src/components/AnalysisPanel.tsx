"use client";
import { PriceLevel, TradePlan } from "@/lib/levels";

interface Props {
  analysis: string;
  levels: PriceLevel[];
  tradePlan: TradePlan | null;
  loading?: boolean;
}

export default function AnalysisPanel({ analysis, levels, tradePlan, loading }: Props) {
  if (loading) {
    return (
      <div className="flex flex-col gap-2">
        {[...Array(3)].map((_, i) => (
          <div key={i} className="glass-card p-3 animate-pulse">
            <div className="h-4 bg-[rgba(0,240,255,0.1)] rounded w-1/3 mb-2" />
            <div className="h-3 bg-[rgba(0,240,255,0.05)] rounded w-full mb-1" />
            <div className="h-3 bg-[rgba(0,240,255,0.05)] rounded w-2/3" />
          </div>
        ))}
      </div>
    );
  }

  const sections = parseAnalysisSections(analysis);

  return (
    <div className="flex flex-col gap-2">
      {/* Levels */}
      <div className="glass-card p-3">
        <h3 className="text-sm font-bold text-[var(--neon-cyan)] mb-2">關鍵價位</h3>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <div className="text-xs text-[var(--neon-red)] font-medium mb-1">壓力 ▲</div>
            {levels.filter(l => l.type === "resistance").slice(0, 3).map((l, i) => (
              <div key={i} className="text-sm font-mono py-0.5 flex items-center gap-1.5">
                <span className={`w-2 h-2 rounded-full ${l.strength === "strong" ? "bg-[var(--neon-red)]" : "bg-[rgba(255,51,102,0.4)]"}`} />
                <span className="font-medium">{l.price.toFixed(2)}</span>
              </div>
            ))}
          </div>
          <div>
            <div className="text-xs text-[var(--neon-green)] font-medium mb-1">支撐 ▼</div>
            {levels.filter(l => l.type === "support").slice(0, 3).map((l, i) => (
              <div key={i} className="text-sm font-mono py-0.5 flex items-center gap-1.5">
                <span className={`w-2 h-2 rounded-full ${l.strength === "strong" ? "bg-[var(--neon-green)]" : "bg-[rgba(0,255,136,0.4)]"}`} />
                <span className="font-medium">{l.price.toFixed(2)}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Trade Plan detail */}
      {tradePlan && (
        <div className="glass-card p-3">
          <h3 className="text-sm font-bold text-[var(--neon-yellow)] mb-2">交易計畫</h3>
          <div className="space-y-1.5 text-sm">
            <Row label="停損" value={tradePlan.stopLoss.toFixed(2)} color="var(--neon-red)" />
            <Row label="進場" value={tradePlan.entry.toFixed(2)} />
            <Row label="目標1" value={tradePlan.target1.toFixed(2)} color="var(--neon-green)" />
            <Row label="目標2" value={tradePlan.target2.toFixed(2)} color="var(--neon-green)" />
            <div className="pt-1 border-t border-[rgba(0,240,255,0.1)] flex justify-between">
              <span className="text-[var(--text-secondary)]">風險報酬比</span>
              <span className={`font-bold ${tradePlan.riskReward >= 2 ? "text-[var(--neon-green)]" : tradePlan.riskReward >= 1 ? "text-[var(--neon-yellow)]" : "text-[var(--neon-red)]"}`}>
                1:{tradePlan.riskReward.toFixed(1)} {tradePlan.riskReward >= 2 ? "✅" : tradePlan.riskReward >= 1 ? "⚠️" : "❌"}
              </span>
            </div>
          </div>
        </div>
      )}

      {/* Analysis sections */}
      {sections.map((s, i) => (
        <div key={i} className="glass-card p-3">
          <h3 className="text-sm font-bold text-[var(--neon-cyan)] mb-1.5">{s.title}</h3>
          <div className="text-sm leading-relaxed text-[var(--text-secondary)] [&_strong]:text-[var(--text-primary)]"
            dangerouslySetInnerHTML={{ __html: formatContent(s.content) }} />
        </div>
      ))}
    </div>
  );
}

function Row({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="flex justify-between">
      <span className="text-[var(--text-secondary)]">{label}</span>
      <span className="font-mono font-medium" style={color ? { color } : undefined}>{value}</span>
    </div>
  );
}

function parseAnalysisSections(md: string) {
  if (!md) return [];
  return md.split(/^## /gm).filter(Boolean).map(part => {
    const [title, ...rest] = part.split("\n");
    return { title: title.trim(), content: rest.join("\n").trim() };
  });
}

function formatContent(text: string): string {
  return text
    .replace(/^### (.+)$/gm, '<div class="text-[var(--neon-yellow)] font-medium mt-1.5">$1</div>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/^- (.+)$/gm, '<div class="pl-2">• $1</div>')
    .replace(/\n{2,}/g, '<div class="h-1.5"></div>')
    .replace(/\n/g, '<br/>');
}

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
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {[...Array(4)].map((_, i) => (
          <div key={i} className="glass-card p-4 animate-pulse">
            <div className="h-4 bg-[rgba(0,240,255,0.1)] rounded w-1/3 mb-3" />
            <div className="space-y-2">
              {[...Array(3)].map((_, j) => (
                <div key={j} className="h-3 bg-[rgba(0,240,255,0.05)] rounded" style={{ width: `${60 + Math.random() * 40}%` }} />
              ))}
            </div>
          </div>
        ))}
      </div>
    );
  }

  // Parse analysis into sections by ## headers
  const sections = parseAnalysisSections(analysis);

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      {/* Support/Resistance card */}
      <div className="glass-card p-4">
        <h3 className="text-sm font-semibold text-[var(--neon-cyan)] mb-3">關鍵價位</h3>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <h4 className="text-xs text-[var(--neon-red)] font-medium mb-2">壓力位 ▲</h4>
            {levels.filter(l => l.type === "resistance").slice(0, 3).map((l, i) => (
              <div key={i} className="flex items-center gap-2 text-xs py-1">
                <span className={`w-2 h-2 rounded-full ${l.strength === "strong" ? "bg-[var(--neon-red)]" : "bg-[rgba(255,51,102,0.5)]"}`} />
                <span className="font-mono font-medium">{l.price.toFixed(2)}</span>
                <span className="text-[var(--text-secondary)] text-[10px]">{l.strength === "strong" ? "強" : "中"}</span>
              </div>
            ))}
            {levels.filter(l => l.type === "resistance").length === 0 && <p className="text-xs text-[var(--text-secondary)]">—</p>}
          </div>
          <div>
            <h4 className="text-xs text-[var(--neon-green)] font-medium mb-2">支撐位 ▼</h4>
            {levels.filter(l => l.type === "support").slice(0, 3).map((l, i) => (
              <div key={i} className="flex items-center gap-2 text-xs py-1">
                <span className={`w-2 h-2 rounded-full ${l.strength === "strong" ? "bg-[var(--neon-green)]" : "bg-[rgba(0,255,136,0.5)]"}`} />
                <span className="font-mono font-medium">{l.price.toFixed(2)}</span>
                <span className="text-[var(--text-secondary)] text-[10px]">{l.strength === "strong" ? "強" : "中"}</span>
              </div>
            ))}
            {levels.filter(l => l.type === "support").length === 0 && <p className="text-xs text-[var(--text-secondary)]">—</p>}
          </div>
        </div>
      </div>

      {/* Trade Plan card */}
      <div className="glass-card p-4">
        <h3 className="text-sm font-semibold text-[var(--neon-yellow)] mb-3">交易計畫</h3>
        {tradePlan ? (
          <>
            <div className="grid grid-cols-2 gap-3 text-xs">
              <div className="flex justify-between"><span className="text-[var(--text-secondary)]">進場</span><span className="font-mono">{tradePlan.entry.toFixed(2)}</span></div>
              <div className="flex justify-between"><span className="text-[var(--text-secondary)]">停損</span><span className="font-mono text-[var(--neon-red)]">{tradePlan.stopLoss.toFixed(2)}</span></div>
              <div className="flex justify-between"><span className="text-[var(--text-secondary)]">目標1</span><span className="font-mono text-[var(--neon-green)]">{tradePlan.target1.toFixed(2)}</span></div>
              <div className="flex justify-between"><span className="text-[var(--text-secondary)]">目標2</span><span className="font-mono text-[var(--neon-green)]">{tradePlan.target2.toFixed(2)}</span></div>
            </div>
            <div className="mt-3 pt-2 border-t border-[rgba(0,240,255,0.1)] text-xs">
              <span className="text-[var(--text-secondary)]">風險報酬比：</span>
              <span className={`font-bold text-sm ${tradePlan.riskReward >= 2 ? "text-[var(--neon-green)]" : tradePlan.riskReward >= 1 ? "text-[var(--neon-yellow)]" : "text-[var(--neon-red)]"}`}>
                1:{tradePlan.riskReward.toFixed(2)}
              </span>
              <span className="ml-2">{tradePlan.riskReward >= 2 ? "✅" : tradePlan.riskReward >= 1 ? "⚠️" : "❌"}</span>
            </div>
          </>
        ) : <p className="text-xs text-[var(--text-secondary)]">資料不足</p>}
      </div>

      {/* Analysis sections as individual cards */}
      {sections.map((section, i) => (
        <div key={i} className={`glass-card p-4 ${section.fullWidth ? "md:col-span-2" : ""}`}>
          <h3 className="text-sm font-semibold text-[var(--neon-cyan)] mb-2">{section.title}</h3>
          <div className="text-xs leading-relaxed text-[var(--text-primary)] space-y-1"
            dangerouslySetInnerHTML={{ __html: formatContent(section.content) }} />
        </div>
      ))}
    </div>
  );
}

interface Section { title: string; content: string; fullWidth: boolean; }

function parseAnalysisSections(md: string): Section[] {
  if (!md) return [];
  const parts = md.split(/^## /gm).filter(Boolean);
  return parts.map(part => {
    const lines = part.split("\n");
    const title = lines[0].trim();
    const content = lines.slice(1).join("\n").trim();
    const fullWidth = title.includes("策略") || title.includes("Strategy") || title.includes("劇本") || title.includes("Scenario");
    return { title, content, fullWidth };
  });
}

function formatContent(text: string): string {
  return text
    .replace(/^### (.+)$/gm, '<div class="font-medium text-[var(--neon-yellow)] mt-2 mb-1">$1</div>')
    .replace(/\*\*(.+?)\*\*/g, '<strong class="text-[var(--text-primary)]">$1</strong>')
    .replace(/^- (.+)$/gm, '<div class="flex gap-1.5 text-[var(--text-secondary)]"><span class="text-[var(--neon-cyan)]">•</span><span>$1</span></div>')
    .replace(/\n{2,}/g, '<div class="h-2"></div>')
    .replace(/\n/g, '<br/>');
}

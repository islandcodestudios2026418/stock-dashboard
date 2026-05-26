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
      <div className="glass-card p-4 animate-pulse">
        <div className="h-4 bg-[rgba(0,240,255,0.1)] rounded w-1/3 mb-3" />
        <div className="space-y-2">
          {[...Array(8)].map((_, i) => (
            <div key={i} className="h-3 bg-[rgba(0,240,255,0.05)] rounded" style={{ width: `${60 + Math.random() * 40}%` }} />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="glass-card p-4 space-y-4">
      <h3 className="text-sm font-semibold text-[var(--neon-cyan)]">AI 技術面分析</h3>

      {/* Support/Resistance levels */}
      {levels.length > 0 && (
        <div className="grid grid-cols-2 gap-3">
          <div>
            <h4 className="text-xs text-[var(--neon-red)] font-medium mb-1">壓力位</h4>
            {levels.filter(l => l.type === "resistance").slice(0, 3).map((l, i) => (
              <div key={i} className="flex items-center gap-2 text-xs py-0.5">
                <span className={`w-1.5 h-1.5 rounded-full ${l.strength === "strong" ? "bg-[var(--neon-red)]" : "bg-[rgba(255,51,102,0.5)]"}`} />
                <span className="font-mono">{l.price.toFixed(2)}</span>
                <span className="text-[var(--text-secondary)] text-[10px]">{l.strength === "strong" ? "強" : l.strength === "moderate" ? "中" : "弱"}</span>
              </div>
            ))}
          </div>
          <div>
            <h4 className="text-xs text-[var(--neon-green)] font-medium mb-1">支撐位</h4>
            {levels.filter(l => l.type === "support").slice(0, 3).map((l, i) => (
              <div key={i} className="flex items-center gap-2 text-xs py-0.5">
                <span className={`w-1.5 h-1.5 rounded-full ${l.strength === "strong" ? "bg-[var(--neon-green)]" : "bg-[rgba(0,255,136,0.5)]"}`} />
                <span className="font-mono">{l.price.toFixed(2)}</span>
                <span className="text-[var(--text-secondary)] text-[10px]">{l.strength === "strong" ? "強" : l.strength === "moderate" ? "中" : "弱"}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Trade Plan */}
      {tradePlan && (
        <div className="border-t border-[rgba(0,240,255,0.1)] pt-3">
          <h4 className="text-xs font-medium text-[var(--neon-yellow)] mb-2">交易計畫</h4>
          <div className="grid grid-cols-2 gap-2 text-xs">
            <div className="flex justify-between">
              <span className="text-[var(--text-secondary)]">進場</span>
              <span className="font-mono">{tradePlan.entry.toFixed(2)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-[var(--text-secondary)]">停損</span>
              <span className="font-mono text-[var(--neon-red)]">{tradePlan.stopLoss.toFixed(2)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-[var(--text-secondary)]">目標1</span>
              <span className="font-mono text-[var(--neon-green)]">{tradePlan.target1.toFixed(2)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-[var(--text-secondary)]">目標2</span>
              <span className="font-mono text-[var(--neon-green)]">{tradePlan.target2.toFixed(2)}</span>
            </div>
          </div>
          <div className="mt-2 text-xs">
            <span className="text-[var(--text-secondary)]">風險報酬比：</span>
            <span className={`font-bold ${tradePlan.riskReward >= 2 ? "text-[var(--neon-green)]" : tradePlan.riskReward >= 1 ? "text-[var(--neon-yellow)]" : "text-[var(--neon-red)]"}`}>
              1:{tradePlan.riskReward.toFixed(2)}
            </span>
          </div>
        </div>
      )}

      {/* AI Analysis text */}
      {analysis && (
        <div className="border-t border-[rgba(0,240,255,0.1)] pt-3">
          <div className="prose prose-invert prose-xs max-w-none text-xs leading-relaxed text-[var(--text-primary)] [&_h2]:text-[var(--neon-cyan)] [&_h2]:text-sm [&_h2]:font-semibold [&_h2]:mt-3 [&_h2]:mb-1 [&_h3]:text-[var(--neon-yellow)] [&_h3]:text-xs [&_strong]:text-[var(--text-primary)] [&_li]:text-[var(--text-secondary)]"
            dangerouslySetInnerHTML={{ __html: markdownToHtml(analysis) }} />
        </div>
      )}
    </div>
  );
}

function markdownToHtml(md: string): string {
  return md
    .replace(/^## (.+)$/gm, '<h2>$1</h2>')
    .replace(/^### (.+)$/gm, '<h3>$1</h3>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/^- (.+)$/gm, '<li>$1</li>')
    .replace(/(<li>.*<\/li>\n?)+/g, '<ul>$&</ul>')
    .replace(/\n{2,}/g, '<br/><br/>')
    .replace(/\n/g, '<br/>');
}

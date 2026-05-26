"use client";
import { PriceLevel, TradePlan } from "@/lib/levels";

interface Props {
  analysis: string;
  levels: PriceLevel[];
  tradePlan: TradePlan | null;
  loading?: boolean;
}

export default function AnalysisPanel({ analysis, loading }: Props) {
  if (loading) {
    return (
      <div className="grid grid-cols-3 gap-2 h-full">
        {[...Array(3)].map((_, i) => (
          <div key={i} className="glass-card p-3 animate-pulse">
            <div className="h-4 bg-[rgba(0,240,255,0.1)] rounded w-1/3 mb-2" />
            <div className="h-3 bg-[rgba(0,240,255,0.05)] rounded w-full" />
          </div>
        ))}
      </div>
    );
  }

  const sections = parseAnalysisSections(analysis);
  if (sections.length === 0) return null;

  return (
    <div className="grid grid-cols-3 gap-2 h-full overflow-hidden">
      {sections.map((s, i) => (
        <div key={i} className="glass-card p-4 overflow-y-auto min-h-0">
          <h3 className="text-base font-bold text-[var(--neon-cyan)] mb-2 sticky top-0 bg-[rgba(10,10,15,0.95)] pb-1 z-10">{s.title}</h3>
          <div className="text-[15px] leading-[1.8] text-[var(--text-primary)] [&_strong]:text-white [&_strong]:font-bold"
            dangerouslySetInnerHTML={{ __html: formatContent(s.content) }} />
        </div>
      ))}
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
    .replace(/^### (.+)$/gm, '<div class="text-[var(--neon-yellow)] font-bold mt-3 mb-1 text-[15px]">$1</div>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/^[①②③④⑤⑥⑦⑧⑨⑩] (.+)$/gm, '<div class="pl-3 py-0.5">$&</div>')
    .replace(/^● (.+)$/gm, '<div class="pl-3 py-0.5 text-[var(--neon-red)]">● $1</div>')
    .replace(/^◎ (.+)$/gm, '<div class="pl-3 py-0.5 text-[var(--neon-green)]">◎ $1</div>')
    .replace(/^[★☆]+$/gm, '<div class="text-[var(--neon-yellow)] mt-1">$&</div>')
    .replace(/^- (.+)$/gm, '<div class="pl-3 py-0.5">• $1</div>')
    .replace(/^(█+░*\s.+)$/gm, '<div class="font-mono text-[var(--neon-cyan)]">$1</div>')
    .replace(/\n{2,}/g, '<div class="h-2"></div>')
    .replace(/\n/g, '<br/>');
}

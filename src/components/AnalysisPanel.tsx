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

  // Display as horizontal grid - fill the bottom space
  const cols = sections.length <= 3 ? sections.length : Math.min(4, sections.length);

  return (
    <div className={`grid gap-2 h-full overflow-hidden`} style={{ gridTemplateColumns: `repeat(${cols}, 1fr)` }}>
      {sections.slice(0, cols).map((s, i) => (
        <div key={i} className="glass-card p-3 overflow-y-auto min-h-0">
          <h3 className="text-sm font-bold text-[var(--neon-cyan)] mb-1.5 sticky top-0 bg-[rgba(10,10,15,0.95)] pb-1">{s.title}</h3>
          <div className="text-sm leading-relaxed text-[var(--text-secondary)] [&_strong]:text-[var(--text-primary)]"
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
    .replace(/^### (.+)$/gm, '<div class="text-[var(--neon-yellow)] font-medium mt-1.5">$1</div>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/^- (.+)$/gm, '<div class="pl-2">• $1</div>')
    .replace(/\n{2,}/g, '<div class="h-1.5"></div>')
    .replace(/\n/g, '<br/>');
}

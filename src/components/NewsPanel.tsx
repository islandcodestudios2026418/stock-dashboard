"use client";
import { useState, useEffect } from "react";

interface NewsItem { title: string; link: string; publisher: string; publishedAt: number; }

export default function NewsPanel({ symbol, lang = "zh-TW" }: { symbol: string; lang?: string }) {
  const [news, setNews] = useState<NewsItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!symbol) return;
    setLoading(true);
    setError("");
    fetch(`/api/news?symbol=${encodeURIComponent(symbol)}`)
      .then(r => r.json())
      .then(d => { if (Array.isArray(d)) setNews(d); else setError(d.error || "Failed"); })
      .catch(e => setError(String(e)))
      .finally(() => setLoading(false));
  }, [symbol]);

  if (loading) return <div className="glass-card p-3 animate-pulse"><div className="h-3 bg-[rgba(0,240,255,0.1)] rounded w-1/2" /></div>;
  if (news.length === 0) return <div className="glass-card p-3"><span className="text-xs text-[var(--text-secondary)]">{error || (lang === "en" ? "No news" : "無新聞")}</span></div>;

  const en = lang === "en";

  return (
    <div className="glass-card p-3">
      <h3 className="text-sm font-bold text-[var(--neon-cyan)] mb-2">{en ? "News" : "\u65B0\u805E"}</h3>
      <div className="flex flex-col gap-1.5 max-h-[200px] overflow-y-auto">
        {news.slice(0, 6).map((n, i) => (
          <a key={i} href={n.link} target="_blank" rel="noopener noreferrer"
            className="block px-2 py-1.5 rounded hover:bg-[rgba(0,240,255,0.05)] transition-all">
            <div className="text-sm text-[var(--text-primary)] leading-tight line-clamp-2">{n.title}</div>
            <div className="text-[11px] text-[var(--text-secondary)] mt-0.5">{n.publisher}</div>
          </a>
        ))}
      </div>
    </div>
  );
}

import { trySupabase } from "./supabase";

// Conviction scoring: overlays on top of multi-agent scores.
// Tracks score trend over recent days. Rising scores = building conviction.

export interface ConvictionResult {
  convictionScore: number; // 0-100, higher = more conviction
  streak: number; // consecutive days score has been rising
  momentum: number; // avg daily score change
  urgent: boolean; // first consensus after 5+ days of climbing
}

/**
 * Computes conviction score for a symbol based on recent scoring history.
 * Higher conviction = score has been trending up consistently.
 */
export async function computeConviction(symbol: string, todayScore: number, todayConsensus: boolean): Promise<ConvictionResult> {
  const supabase = trySupabase();
  if (!supabase) return { convictionScore: 50, streak: 0, momentum: 0, urgent: false };

  const cutoff = new Date(Date.now() - 14 * 86400000).toISOString().split("T")[0];

  const { data } = await supabase
    .from("analysis_results")
    .select("date, scoring")
    .eq("symbol", symbol)
    .gte("date", cutoff)
    .order("date", { ascending: true });

  const scores = (data || [])
    .map((r: { scoring?: { avgScore?: number; consensus?: boolean } }) => ({
      avg: r.scoring?.avgScore ?? 0,
      consensus: r.scoring?.consensus ?? false,
    }));

  // Add today's score
  scores.push({ avg: todayScore, consensus: todayConsensus });

  if (scores.length < 2) return { convictionScore: 50, streak: 0, momentum: 0, urgent: false };

  // Calculate rising streak (from most recent going backwards)
  let streak = 0;
  for (let i = scores.length - 1; i > 0; i--) {
    if (scores[i].avg >= scores[i - 1].avg) streak++;
    else break;
  }

  // Momentum: avg daily change over last 5 days
  const recent = scores.slice(-5);
  const changes = recent.slice(1).map((s, i) => s.avg - recent[i].avg);
  const momentum = changes.length > 0 ? changes.reduce((a, b) => a + b, 0) / changes.length : 0;

  // Conviction score formula:
  // Base 50 + streak bonus (up to +25) + momentum bonus (up to +25)
  const streakBonus = Math.min(streak * 5, 25);
  const momentumBonus = Math.min(Math.max(momentum * 5, 0), 25);
  const convictionScore = Math.min(100, Math.round(50 + streakBonus + momentumBonus));

  // Urgent: first consensus after 5+ days of climbing without consensus
  const prevNonConsensus = scores.slice(0, -1).filter(s => !s.consensus).length;
  const urgent = todayConsensus && streak >= 5 && prevNonConsensus >= 5;

  return { convictionScore, streak, momentum: Math.round(momentum * 10) / 10, urgent };
}

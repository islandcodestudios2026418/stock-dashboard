// Sector classification: maps stocks to sectors, provides sector health context

export const STOCK_SECTORS: Record<string, string> = {
  NVDA: "XLK", AAPL: "XLK", MSFT: "XLK", AMD: "XLK", SMCI: "XLK", AVGO: "XLK", TSM: "XLK",
  TSLA: "XLY", AMZN: "XLY",
  META: "XLC", GOOG: "XLC", GOOGL: "XLC", NFLX: "XLC",
  JPM: "XLF", GS: "XLF", BAC: "XLF", V: "XLF", MA: "XLF",
  XOM: "XLE", CVX: "XLE", OXY: "XLE",
  JNJ: "XLV", UNH: "XLV", LLY: "XLV", MRNA: "XLV",
  ENPH: "XLK", CELH: "XLP",
  CAT: "XLI", DE: "XLI", GE: "XLI",
};

export const SECTOR_NAMES: Record<string, string> = {
  XLK: "Technology", XLV: "Healthcare", XLF: "Financials",
  XLE: "Energy", XLI: "Industrials", XLY: "Consumer Discretionary",
  XLP: "Consumer Staples", XLU: "Utilities", XLB: "Materials",
  XLRE: "Real Estate", XLC: "Communication Services",
};

export interface SectorContext {
  etf: string;
  sectorName: string;
  inTopSectors: boolean;
}

/**
 * Returns sector info for a symbol. If stock not in mapping, returns null.
 */
export function getSectorForStock(symbol: string): SectorContext | null {
  const raw = symbol.includes(":") ? symbol.split(":")[1] : symbol;
  const etf = STOCK_SECTORS[raw];
  if (!etf) return null;
  return { etf, sectorName: SECTOR_NAMES[etf] || etf, inTopSectors: false };
}

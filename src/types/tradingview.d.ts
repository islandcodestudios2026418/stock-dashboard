declare module "@mathieuc/tradingview" {
  export class Client {
    constructor(options?: { token?: string; signature?: string });
    Session: {
      Chart: new () => Chart;
    };
    end(): void;
  }

  interface ChartPeriod {
    time: number;
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
  }

  interface ChartInfos {
    full_name?: string;
    short_description?: string;
    description?: string;
    listed_exchange?: string;
    currency_id?: string;
  }

  export interface Chart {
    periods: ChartPeriod[];
    infos: ChartInfos;
    setMarket(symbol: string, options?: { timeframe?: string; range?: number }): void;
    onUpdate(cb: () => void): void;
    onError(cb: (...args: unknown[]) => void): void;
  }
}

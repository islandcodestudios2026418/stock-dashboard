import { Metadata } from "next";

export const metadata: Metadata = { title: "Stock Dashboard API Docs" };

export default function ApiDocsPage() {
  return (
    <main className="max-w-4xl mx-auto p-8 font-mono text-sm">
      <h1 className="text-2xl font-bold mb-4">📡 Stock Dashboard Public API</h1>
      <p className="mb-6 text-gray-400">Base URL: <code className="bg-gray-800 px-2 py-0.5 rounded">https://your-domain.com/api/v1</code></p>

      <Section title="認證 Authentication">
        <p>所有 v1 端點需要 API Key，透過以下方式傳遞：</p>
        <ul className="list-disc ml-6 mt-2">
          <li>Header: <code>x-api-key: YOUR_KEY</code></li>
          <li>Query: <code>?api_key=YOUR_KEY</code></li>
        </ul>
        <p className="mt-2">Rate limit: 30 requests/min per key (可透過 <code>API_RATE_LIMIT</code> 環境變數調整)</p>
      </Section>

      <Section title="GET /api/v1/quote">
        <p>取得股票即時報價 + 基本面數據（Yahoo Finance）</p>
        <Params params={[{ name: "symbol", desc: "股票代碼，如 TSLA, NVDA, 2330.TW", required: true }]} />
        <Response example={`{ "symbol": "TSLA", "price": 250.1, "pe": 65.2, "marketCap": 800000000000, ... }`} />
      </Section>

      <Section title="GET /api/v1/news">
        <p>取得股票相關新聞</p>
        <Params params={[
          { name: "symbol", desc: "股票代碼", required: true },
          { name: "count", desc: "新聞數量 (max 20, default 8)", required: false },
        ]} />
        <Response example={`{ "symbol": "TSLA", "news": [{ "title": "...", "link": "...", "publisher": "...", "publishedAt": ... }] }`} />
      </Section>

      <Section title="GET /api/v1/stock">
        <p>取得 K 線歷史數據（TradingView）</p>
        <Params params={[
          { name: "symbol", desc: "TradingView 格式，如 NASDAQ:TSLA", required: true },
          { name: "timeframe", desc: "1, 5, 15, 60, 1D, 1W (default: 1D)", required: false },
          { name: "range", desc: "K 線根數 (max 500, default 300)", required: false },
        ]} />
        <Response example={`{ "symbol": "NASDAQ:TSLA", "name": "Tesla", "periods": [{ "time": 1717027200, "open": 180, "high": 185, "low": 178, "close": 183, "volume": 50000000 }] }`} />
      </Section>

      <Section title="GET /api/v1/macro">
        <p>總經指標快照（VIX, DXY, US10Y, US02Y, SPX, Gold）</p>
        <Params params={[]} />
        <Response example={`{ "vix": { "price": 14.5, "change": -0.3, "changePct": -2.03, "name": "VIX" }, ... }`} />
      </Section>

      <Section title="GET /api/v1/sectors">
        <p>11 大板塊 ETF 當日漲跌幅（排序由高到低）</p>
        <Params params={[]} />
        <Response example={`[{ "symbol": "AMEX:XLK", "name": "科技", "short": "XLK", "changePct": 1.23 }, ...]`} />
      </Section>

      <Section title="GET /api/v1/analysis">
        <p>取得快取的 AI 分析結果</p>
        <Params params={[
          { name: "symbol", desc: "股票代碼", required: true },
          { name: "date", desc: "日期 YYYY-MM-DD (default: today)", required: false },
        ]} />
        <Response example={`{ "symbol": "TSLA", "date": "2025-06-01", "analysis": "...", "indicators": {...}, "tradePlan": {...} }`} />
      </Section>

      <Section title="錯誤回應">
        <pre className="bg-gray-800 p-3 rounded mt-2 overflow-x-auto">{`401: { "error": "無效的 API Key", "code": "UNAUTHORIZED" }
429: { "error": "超過速率限制", "code": "RATE_LIMITED", "retryAfter": 60 }
400: { "error": "缺少 symbol 參數", "code": "BAD_REQUEST" }
500: { "error": "...", "code": "FETCH_ERROR" }`}</pre>
      </Section>
    </main>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-8 border border-gray-700 rounded-lg p-4">
      <h2 className="text-lg font-semibold mb-2">{title}</h2>
      {children}
    </section>
  );
}

function Params({ params }: { params: { name: string; desc: string; required: boolean }[] }) {
  if (!params.length) return <p className="text-gray-500 mt-1">無參數</p>;
  return (
    <table className="mt-2 w-full text-left">
      <thead><tr><th className="pr-4">參數</th><th className="pr-4">必填</th><th>說明</th></tr></thead>
      <tbody>
        {params.map(p => (
          <tr key={p.name}>
            <td className="pr-4"><code>{p.name}</code></td>
            <td className="pr-4">{p.required ? "✅" : "❌"}</td>
            <td>{p.desc}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Response({ example }: { example: string }) {
  return <pre className="bg-gray-800 p-3 rounded mt-2 overflow-x-auto text-xs">{example}</pre>;
}

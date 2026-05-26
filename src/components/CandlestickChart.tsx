"use client";
import { useEffect, useRef } from "react";
import { createChart, IChartApi, CandlestickData, HistogramData, Time, CandlestickSeries, LineSeries, HistogramSeries } from "lightweight-charts";
import { OHLCV, calcBOLL } from "@/lib/indicators";

interface Props {
  data: OHLCV[];
}

export default function CandlestickChart({ data }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);

  useEffect(() => {
    if (!containerRef.current || data.length === 0) return;

    // Sort by time ascending (TradingView API may return unordered)
    const sorted = [...data].sort((a, b) => a.time - b.time);

    const chart = createChart(containerRef.current, {
      layout: { background: { color: "transparent" }, textColor: "#8888aa" },
      grid: { vertLines: { color: "rgba(0,240,255,0.05)" }, horzLines: { color: "rgba(0,240,255,0.05)" } },
      crosshair: { mode: 0 },
      rightPriceScale: { borderColor: "rgba(0,240,255,0.2)" },
      timeScale: { borderColor: "rgba(0,240,255,0.2)", timeVisible: true },
      width: containerRef.current.clientWidth,
      height: containerRef.current.clientHeight || 300,
    });
    chartRef.current = chart;

    // Candlestick
    const candleSeries = chart.addSeries(CandlestickSeries, {
      upColor: "#00ff88",
      downColor: "#ff3366",
      borderUpColor: "#00ff88",
      borderDownColor: "#ff3366",
      wickUpColor: "#00ff88",
      wickDownColor: "#ff3366",
    });
    const candles: CandlestickData<Time>[] = sorted.map(d => ({
      time: d.time as Time,
      open: d.open,
      high: d.high,
      low: d.low,
      close: d.close,
    }));
    candleSeries.setData(candles);

    // Bollinger Bands
    const closes = sorted.map(d => d.close);
    const boll = calcBOLL(closes);

    const bollData = sorted.map((d, i) => ({ time: d.time as Time, mid: boll.mid[i], upper: boll.upper[i], lower: boll.lower[i] }))
      .filter(d => d.mid !== null);

    const bollMid = chart.addSeries(LineSeries, { color: "rgba(0,240,255,0.5)", lineWidth: 1 });
    const bollUpper = chart.addSeries(LineSeries, { color: "rgba(255,0,170,0.4)", lineWidth: 1, lineStyle: 2 });
    const bollLower = chart.addSeries(LineSeries, { color: "rgba(255,0,170,0.4)", lineWidth: 1, lineStyle: 2 });

    bollMid.setData(bollData.map(d => ({ time: d.time, value: d.mid! })));
    bollUpper.setData(bollData.map(d => ({ time: d.time, value: d.upper! })));
    bollLower.setData(bollData.map(d => ({ time: d.time, value: d.lower! })));

    // Volume
    const volumeSeries = chart.addSeries(HistogramSeries, {
      priceFormat: { type: "volume" },
      priceScaleId: "volume",
    });
    chart.priceScale("volume").applyOptions({ scaleMargins: { top: 0.85, bottom: 0 } });
    const volumes: HistogramData<Time>[] = sorted.map(d => ({
      time: d.time as Time,
      value: d.volume,
      color: d.close >= d.open ? "rgba(0,255,136,0.3)" : "rgba(255,51,102,0.3)",
    }));
    volumeSeries.setData(volumes);

    chart.timeScale().fitContent();

    const handleResize = () => {
      if (containerRef.current) chart.applyOptions({ width: containerRef.current.clientWidth, height: containerRef.current.clientHeight || 300 });
    };
    window.addEventListener("resize", handleResize);

    return () => {
      window.removeEventListener("resize", handleResize);
      chart.remove();
    };
  }, [data]);

  return <div ref={containerRef} className="w-full h-full" />;
}

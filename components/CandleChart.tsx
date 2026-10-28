"use client";

import { useEffect, useRef, useState } from "react";
import { usd } from "@/lib/format";
import { Tabs } from "./ui";

interface Candle {
  t: number;
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
}

type Tf = "1" | "5" | "15";

// Market cap candles (GeckoTerminal) with the call marked: dashed line at the call market cap, arrow on the call
// candle. Falls back to `fallback` (our own price series) when the pair is not indexed yet.
export function CandleChart({ mint, callAt, entry, fallback }: { mint: string; callAt?: number; entry?: number; fallback?: React.ReactNode }) {
  const el = useRef<HTMLDivElement>(null);
  const [tf, setTf] = useState<Tf>(() => (callAt && Date.now() - callAt > 6 * 3600_000 ? "15" : "1"));
  const [candles, setCandles] = useState<Candle[] | null>(null);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const r = await fetch(`/api/candles?mint=${mint}&tf=${tf}`);
        const j = await r.json();
        if (!alive) return;
        setCandles(j.candles ?? []);
        setNote(j.candles?.length ? null : j.reason ?? "no trades yet");
      } catch {
        if (alive) setNote("chart source unreachable");
      }
    };
    load();
    const t = setInterval(load, 30_000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [mint, tf]);

  // Chart objects live across refreshes; new candles only replace the data (keeps zoom and scroll).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const api = useRef<{ chart: any; series: any; vol: any; markers?: any; lc: typeof import("lightweight-charts"); fitted: boolean } | null>(null);
  const hasData = !!candles?.length;
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!el.current || !hasData) return;
    let disposed = false;
    let cleanup = () => {};
    (async () => {
      const lc = await import("lightweight-charts");
      if (disposed || !el.current) return;
      const chart = lc.createChart(el.current, {
        autoSize: true,
        layout: {
          background: { type: lc.ColorType.Solid, color: "transparent" },
          textColor: "#8b93a1",
          fontFamily: "JetBrains Mono, ui-monospace, monospace",
          fontSize: 10,
          attributionLogo: false,
        },
        grid: { vertLines: { color: "#14161b" }, horzLines: { color: "#14161b" } },
        rightPriceScale: { borderColor: "#1d2028" },
        timeScale: { borderColor: "#1d2028", timeVisible: true, secondsVisible: false },
        crosshair: { vertLine: { color: "#5d6371", labelBackgroundColor: "#16181e" }, horzLine: { color: "#5d6371", labelBackgroundColor: "#16181e" } },
      });
      const series = chart.addSeries(lc.CandlestickSeries, {
        upColor: "#4ade50",
        downColor: "#ff6b84",
        borderVisible: false,
        wickUpColor: "#4ade50",
        wickDownColor: "#ff6b84",
        priceFormat: { type: "custom", formatter: (p: number) => usd(p), minMove: 0.01 },
      });
      const vol = chart.addSeries(lc.HistogramSeries, { priceScaleId: "", priceFormat: { type: "volume" }, color: "#2a2f3a", lastValueVisible: false, priceLineVisible: false });
      vol.priceScale().applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });
      if (entry) series.createPriceLine({ price: entry, color: "#e0b738", lineWidth: 1, lineStyle: lc.LineStyle.Dashed, axisLabelVisible: true, title: "call" });
      api.current = { chart, series, vol, lc, fitted: false };
      setTick((n) => n + 1); // push the current candles into the new chart
      cleanup = () => {
        api.current = null;
        chart.remove();
      };
    })();
    return () => {
      disposed = true;
      cleanup();
    };
  }, [hasData, tf, entry, mint]);

  useEffect(() => {
    const a = api.current;
    if (!a || !candles?.length) return;
    const toTime = (s: number) => s as import("lightweight-charts").UTCTimestamp;
    a.series.setData(candles.map((k) => ({ time: toTime(k.t), open: k.o, high: k.h, low: k.l, close: k.c })));
    a.vol.setData(candles.map((k) => ({ time: toTime(k.t), value: k.v, color: k.c >= k.o ? "#4ade5040" : "#ff6b8440" })));
    if (callAt) {
      const step = Number(tf) * 60;
      const ct = Math.floor(callAt / 1000 / step) * step;
      if (candles.some((k) => k.t === ct)) {
        a.markers ??= a.lc.createSeriesMarkers(a.series, []);
        a.markers.setMarkers([{ time: toTime(ct), position: "belowBar", color: "#e0b738", shape: "arrowUp", text: "CALL" }]);
      }
    }
    // Fit once; later refreshes keep whatever zoom the viewer chose.
    if (!a.fitted) {
      a.fitted = true;
      a.chart.timeScale().fitContent();
    }
  }, [candles, tick, callAt, tf]);

  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <span className="label !text-[10px]">
          Market cap · <span className="text-narr">- - -</span> call
        </span>
        <Tabs
          value={tf}
          onChange={setTf}
          items={[
            { id: "1", label: "1m" },
            { id: "5", label: "5m" },
            { id: "15", label: "15m" },
          ]}
          label="Candle size"
        />
      </div>
      {candles?.length ? (
        <div ref={el} className="h-[320px] w-full" />
      ) : (
        <div>
          {fallback}
          <p className="mt-2 font-mono text-[10.5px] text-dim">{candles === null ? "Loading candles..." : `Candles: ${note}. Showing the scanner's own readings.`}</p>
        </div>
      )}
    </div>
  );
}

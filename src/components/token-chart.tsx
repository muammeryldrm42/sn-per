import { useEffect, useState } from "react";
import { Area, AreaChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { Candle } from "@/lib/gate";
import { loadCandles } from "@/lib/market-fns";

function priceLabel(n: number): string {
  if (!Number.isFinite(n)) return "—";
  if (n >= 1) return `$${n.toFixed(3)}`;
  if (n >= 0.01) return `$${n.toFixed(4)}`;
  return `$${n.toPrecision(3)}`;
}

export function TokenChart({ mint }: { mint: string }) {
  const [candles, setCandles] = useState<Candle[] | null>(null);

  useEffect(() => {
    let live = true;
    setCandles(null);
    void loadCandles({ data: { mint } })
      .then((rows) => {
        if (live) setCandles(rows);
      })
      .catch(() => {
        if (live) setCandles([]);
      });
    return () => {
      live = false;
    };
  }, [mint]);

  if (!candles) {
    return <div className="h-52 animate-pulse rounded-lg bg-row" />;
  }
  if (candles.length < 2) {
    return (
      <div className="grid h-52 place-items-center rounded-lg border border-line bg-row px-4 text-center text-sm text-muted">
        The candle feed did not answer. DexScreener below still has the live chart.
      </div>
    );
  }

  const up = candles[candles.length - 1].c >= candles[0].c;
  const color = up ? "var(--color-flow)" : "var(--color-warn)";

  return (
    <div className="h-52 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={candles} margin={{ top: 8, right: 0, left: 0, bottom: 0 }}>
          <XAxis dataKey="t" hide />
          <YAxis hide domain={["auto", "auto"]} />
          <Tooltip
            cursor={{ stroke: "var(--color-line)" }}
            contentStyle={{
              background: "var(--color-panel)",
              border: "1px solid var(--color-line)",
              borderRadius: 8,
              fontSize: 12,
            }}
            labelFormatter={(value) => new Date(Number(value)).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
            formatter={(value) => [priceLabel(Number(value)), "Price"]}
          />
          <Area type="monotone" dataKey="c" stroke={color} fill={color} fillOpacity={0.16} strokeWidth={2} dot={false} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

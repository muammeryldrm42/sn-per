"use client";

import { useState } from "react";
import type { Signal } from "@/lib/types";
import { mult, perf } from "@/lib/format";
import { CALLS_ENABLED } from "@/lib/calls";
import { NARRATIVE_ENABLED } from "@/lib/flags";

interface Row {
  label: string;
  n: number;
  hit2: number;
  median: number;
}

function bucket(items: { s: Signal; peak: number }[], key: (s: Signal) => string | null): Row[] {
  const groups = new Map<string, number[]>();
  for (const { s, peak } of items) {
    const k = key(s);
    if (!k) continue;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k)!.push(peak);
  }
  return [...groups.entries()]
    .map(([label, peaks]) => {
      const sorted = [...peaks].sort((a, b) => a - b);
      return { label, n: peaks.length, hit2: peaks.filter((p) => p >= 2).length, median: sorted[Math.floor(sorted.length / 2)] };
    })
    .sort((a, b) => b.hit2 / b.n - a.hit2 / a.n || b.n - a.n);
}

const SRC: Record<string, string> = {
  trends: "Google Trends",
  news: "Google News",
  reddit: "Reddit",
  coingecko: "CoinGecko",
  gecko: "GeckoTerminal",
  dexboost: "DexScreener boosts",
  wiki: "Wikipedia",
  youtube: "YouTube",
  watchlist: "Your watchlist",
};

// Which kinds of signals actually ran. Uses signals older than 15 min with price data.
export function Report({ signals, now }: { signals: Signal[]; now: number }) {
  const [open, setOpen] = useState(false);
  const items = signals
    .filter((s) => now - s.createdAt > 15 * 60_000)
    .map((s) => ({ s, peak: perf(s)?.peak }))
    .filter((x): x is { s: Signal; peak: number } => x.peak != null);

  const tables: { title: string; rows: Row[] }[] = [
    {
      title: "Score at fire time",
      rows: bucket(items, (s) => (s.score >= 65 ? "65+" : s.score >= 40 ? "40-64" : "under 40")),
    },
    { title: "Strong", rows: bucket(items, (s) => (s.strong ? "Strong" : "Not strong")) },
    { title: "Rising seen", rows: bucket(items, (s) => (s.risingSince ? "Went rising" : "Never rising")) },
    ...(NARRATIVE_ENABLED
      ? [
          { title: "Narrative source", rows: bucket(items, (s) => SRC[s.matchSources[0]] ?? s.matchSources[0] ?? null) },
          { title: "Sources confirming", rows: bucket(items, (s) => `${Math.min(3, s.matchSources.length)}${s.matchSources.length >= 3 ? "+" : ""}`) },
          { title: "Match type", rows: bucket(items, (s) => s.matchKind) },
        ]
      : [
          { title: "Why it reached the radar", rows: bucket(items, (s) => s.matchedDisplay) },
          { title: "Called", rows: bucket(items, (s) => (s.calledAt ? "Called" : "Radar only")) },
        ]),
    ...(CALLS_ENABLED
      ? [{ title: "Telegram calls", rows: bucket(items, (s) => ((s.callers?.length ?? 0) >= 2 ? "2+ channels" : (s.callers?.length ?? 0) === 1 ? "1 channel" : "Not called")) }]
      : []),
    { title: "Smart wallets", rows: bucket(items, (s) => ((s.smartBuyers?.length ?? 0) >= 2 ? "2+ smart" : (s.smartBuyers?.length ?? 0) === 1 ? "1 smart" : "None known")) },
    ...(NARRATIVE_ENABLED ? [{ title: "Fresh narrative", rows: bucket(items, (s) => (s.freshNarrative ? "Fresh" : "Established")) }] : []),
    { title: "Dev", rows: bucket(items, (s) => (s.devKnownDumper || s.devSerial ? "Flagged dev" : s.devSold ? "Dev sold" : "Clean dev")) },
  ];

  return (
    <section className="border-t border-line px-5 py-5 md:px-8" aria-labelledby="report-title">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-baseline justify-between text-left"
      >
        <h2 id="report-title" className="font-display text-lg font-bold">
          What actually ran
        </h2>
        <span className="text-sm text-muted">{open ? "Hide" : `Show report (${items.length} settled signals)`}</span>
      </button>
      {open &&
        (items.length < 5 ? (
          <p className="mt-3 max-w-prose text-sm text-muted">
            Needs at least 5 signals older than 15 minutes with price data. Leave the site open and this fills in.
          </p>
        ) : (
          <>
          <CheckLift items={items} />
          <TopNarratives items={items} />
          <div className="mt-6 grid gap-6 md:grid-cols-2 xl:grid-cols-4">
            {tables.map((t) => (
              <div key={t.title}>
                <h3 className="mb-2 text-sm font-semibold">{t.title}</h3>
                <table className="w-full text-sm tabular-nums">
                  <thead>
                    <tr className="text-left text-xs text-muted">
                      <th className="pb-1 font-normal">Group</th>
                      <th className="pb-1 text-right font-normal">n</th>
                      <th className="pb-1 text-right font-normal">2x</th>
                      <th className="pb-1 text-right font-normal">Median</th>
                    </tr>
                  </thead>
                  <tbody>
                    {t.rows.map((r) => (
                      <tr key={r.label} className="border-t border-line">
                        <td className="py-1 pr-2">{r.label}</td>
                        <td className="py-1 text-right">{r.n}</td>
                        <td className="py-1 text-right text-flow">{Math.round((r.hit2 / r.n) * 100)}%</td>
                        <td className="py-1 text-right">{mult(r.median)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ))}
          </div>
          </>
        ))}
    </section>
  );
}

// For every Strong check: 2x rate when it passed vs when it failed. Lift above 1 means the check helps.
function CheckLift({ items }: { items: { s: Signal; peak: number }[] }) {
  const stats = new Map<string, { pass: number[]; fail: number[] }>();
  for (const { s, peak } of items) {
    for (const c of s.strongChecks ?? []) {
      if (!stats.has(c.label)) stats.set(c.label, { pass: [], fail: [] });
      stats.get(c.label)![c.ok ? "pass" : "fail"].push(peak);
    }
  }
  const rate = (a: number[]) => (a.length ? a.filter((p) => p >= 2).length / a.length : null);
  const rows = [...stats.entries()]
    .map(([label, { pass, fail }]) => {
      const rp = rate(pass);
      const rf = rate(fail);
      const lift = rp != null && rf != null && rf > 0 ? rp / rf : rp != null && rf === 0 && rp > 0 ? Infinity : null;
      return { label, np: pass.length, nf: fail.length, rp, rf, lift };
    })
    .sort((a, b) => (b.lift ?? -1) - (a.lift ?? -1));

  if (!rows.length) return null;
  const fmt = (r: number | null) => (r == null ? "-" : `${Math.round(r * 100)}%`);
  return (
    <div className="mt-4">
      <h3 className="mb-1 text-sm font-semibold">Which checks matter</h3>
      <p className="mb-2 text-xs text-muted">
        2x rate when a check passed vs failed. Lift above 1 means the check is doing its job; groups under 10 signals are noisy.
      </p>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[520px] text-sm tabular-nums">
          <thead>
            <tr className="text-left text-xs text-muted">
              <th className="pb-1 font-normal">Check</th>
              <th className="pb-1 text-right font-normal">Passed (n)</th>
              <th className="pb-1 text-right font-normal">Failed (n)</th>
              <th className="pb-1 text-right font-normal">Lift</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.label} className="border-t border-line">
                <td className="py-1 pr-2">{r.label}</td>
                <td className="py-1 text-right">
                  {fmt(r.rp)} <span className="text-muted">({r.np})</span>
                </td>
                <td className="py-1 text-right">
                  {fmt(r.rf)} <span className="text-muted">({r.nf})</span>
                </td>
                <td
                  className={`py-1 text-right ${
                    r.lift == null ? "text-muted" : r.lift >= 1.2 ? "text-flow" : r.lift < 0.9 ? "text-warn" : ""
                  }`}
                >
                  {r.lift == null ? "-" : r.lift === Infinity ? "only passers ran" : `${r.lift.toFixed(2)}x`}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// Narratives that produced the best runs.
function TopNarratives({ items }: { items: { s: Signal; peak: number }[] }) {
  const byTerm = new Map<string, { display: string; peaks: number[]; best: Signal; bestPeak: number }>();
  for (const { s, peak } of items) {
    const cur = byTerm.get(s.matchedTerm);
    if (!cur) byTerm.set(s.matchedTerm, { display: s.matchedDisplay, peaks: [peak], best: s, bestPeak: peak });
    else {
      cur.peaks.push(peak);
      if (peak > cur.bestPeak) {
        cur.best = s;
        cur.bestPeak = peak;
      }
    }
  }
  const rows = [...byTerm.values()].sort((a, b) => b.bestPeak - a.bestPeak).slice(0, 8);
  if (!rows.length) return null;
  return (
    <div className="mt-6">
      <h3 className="mb-2 text-sm font-semibold">{NARRATIVE_ENABLED ? "Best narratives" : "Best by trigger"}</h3>
      <ul className="flex flex-wrap gap-2 text-sm">
        {rows.map((r) => (
          <li key={r.display} className="rounded-md border border-line px-2.5 py-1">
            <span className="text-narr">{r.display}</span>{" "}
            <span className="tabular-nums text-muted">
              {r.peaks.length} launch{r.peaks.length === 1 ? "" : "es"}, best ${r.best.symbol} {mult(r.bestPeak)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

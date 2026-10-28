"use client";

import { useEffect, useState } from "react";
import type { Signal } from "@/lib/types";
import { age, mult, perf } from "@/lib/format";
import { computeRecord, type RecordStats } from "@/lib/record";
import { callOutcomes, type CallRow } from "@/lib/archive";
import { NARRATIVE_ENABLED } from "@/lib/flags";

const RANGE_TABS = [
  { id: "24h", label: "24h" },
  { id: "7d", label: "7 days" },
  { id: "30d", label: "30 days" },
  { id: "all", label: "All time" },
];

// Shared worker version: every signal ever settled, with time ranges and the multiple distribution.
function RemoteRecord({ url, now, local }: { url?: string; now: number; local?: RecordStats }) {
  const [range, setRange] = useState("24h");
  const [data, setData] = useState<RecordStats | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!url) return;
    let alive = true;
    const load = async () => {
      try {
        const r = await fetch(`${url.replace(/\/$/, "")}/record?range=${range}`, { cache: "no-store" });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const j = (await r.json()) as RecordStats;
        if (alive) {
          setData(j);
          setError(null);
        }
      } catch (e) {
        if (alive) setError((e as Error).message);
      }
    };
    load();
    const t = setInterval(load, 60_000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [url, range]);

  const shown = (data ?? local)!;
  return (
    <section className="border-b border-line px-5 py-5 md:px-8" aria-labelledby="track-title">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="track-title" className="font-display text-lg font-bold">
          Track record
        </h2>
        {url && <div role="group" aria-label="Range" className="flex gap-1 text-sm">
          {RANGE_TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setRange(t.id)}
              aria-pressed={range === t.id}
              className={`rounded-full px-3 py-1 ${range === t.id ? "bg-text text-ink" : "text-muted hover:text-text"}`}
            >
              {t.label}
            </button>
          ))}
        </div>}
      </div>
      <p className="mt-1 text-xs text-muted">
        {NARRATIVE_ENABLED
          ? "Every signal is logged with its entry market cap and time. Multiples are entry to peak while it was tracked (up to 1 hour), not realized profit. Signals under 30 min old are not counted yet."
          : "Every call is logged forever with its market cap at the call. Multiples are call to the highest market cap seen in the next 7 days (checked every 30 s for the first hour, then every 10 min), not realized profit."}
      </p>
      {local && <p className="mt-1 text-xs text-muted">This tab only: the last 24h of calls it saw. The shared worker keeps every call forever.</p>}
      {!(data ?? local) ? (
        <p className="mt-3 text-sm text-muted">{error ? `Could not load (${error}).` : "Loading..."}</p>
      ) : shown.n === 0 ? (
        <p className="mt-3 text-sm text-muted">No settled signals in this range yet.</p>
      ) : (
        <div className="mt-3 grid gap-6 lg:grid-cols-3">
          <div>
            <p className="text-sm">
              <span className="font-display text-2xl font-extrabold tabular-nums">{shown.n.toLocaleString()}</span>{" "}
              <span className="text-muted">{NARRATIVE_ENABLED ? "signals" : "calls"}, median peak {mult(shown.median)}</span>
            </p>
            <dl className="mt-2 grid grid-cols-[auto_auto_auto] gap-x-5 gap-y-1 text-sm tabular-nums">
              {Object.entries(shown.hits).map(([x, c]) => (
                <div key={x} className="contents">
                  <dt className="text-muted">{x}x+</dt>
                  <dd className="text-right">{c.toLocaleString()}</dd>
                  <dd className="text-right text-flow">{Math.round((c / shown.n) * 100)}%</dd>
                </div>
              ))}
            </dl>
          </div>
          <dl className="grid grid-cols-[auto_auto_auto_auto] content-start gap-x-5 gap-y-1 text-sm tabular-nums">
            <dt className="text-xs text-muted">Group</dt>
            <dd className="text-right text-xs text-muted">Signals</dd>
            <dd className="text-right text-xs text-muted">2x</dd>
            <dd className="text-right text-xs text-muted">3x</dd>
            {shown.groups.map((g) => (
              <div key={g.label} className="contents">
                <dt>{g.label}</dt>
                <dd className="text-right">{g.n}</dd>
                <dd className="text-right text-flow">{Math.round((g.x2 / g.n) * 100)}%</dd>
                <dd className="text-right">{Math.round((g.x3 / g.n) * 100)}%</dd>
              </div>
            ))}
          </dl>
          <div>
            <h3 className="mb-1 text-xs text-muted">Best calls</h3>
            <ul className="space-y-1 text-sm">
              {shown.best.map((o) => (
                <li key={o.m}>
                  <a
                    href={`https://dexscreener.com/solana/${o.m}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="hover:text-narr"
                  >
                    ${o.s} <span className="font-semibold text-flow">{mult(o.p)}</span>{" "}
                    <span className="text-muted">
                      on {o.n}, {age(o.t, now)} ago
                    </span>
                  </a>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </section>
  );
}

interface Group {
  label: string;
  n: number;
  x2: number;
  x3: number;
}

// Public track record: how the last 24h of signals actually did. Only signals older than 30 min count.
export function TrackRecord({
  signals,
  now,
  remoteUrl,
  calls,
}: {
  signals: Signal[];
  now: number;
  remoteUrl?: string;
  calls?: CallRow[];
}) {
  if (remoteUrl) return <RemoteRecord url={remoteUrl} now={now} />;
  if (calls) return <RemoteRecord now={now} local={computeRecord(callOutcomes(calls), "24h", now)} />;
  return <LocalRecord signals={signals} now={now} />;
}

function LocalRecord({ signals, now }: { signals: Signal[]; now: number }) {
  const settled = signals
    .filter((s) => now - s.createdAt > 30 * 60_000 && now - s.createdAt < 24 * 3600_000)
    .map((s) => ({ s, p: perf(s) }))
    .filter((x): x is { s: Signal; p: { now: number; peak: number } } => x.p !== null);

  const group = (label: string, list: typeof settled): Group => ({
    label,
    n: list.length,
    x2: list.filter((x) => x.p.peak >= 2).length,
    x3: list.filter((x) => x.p.peak >= 3).length,
  });
  const groups = [
    group("All signals", settled),
    group("Strong", settled.filter((x) => x.s.strong)),
    group("Clean launch", settled.filter((x) => x.s.cleanLaunch)),
    group("Went rising", settled.filter((x) => x.s.risingSince)),
    group("Smart wallets bought early", settled.filter((x) => (x.s.smartBuyers?.length ?? 0) > 0)),
    group("Called on Telegram", settled.filter((x) => (x.s.callers?.length ?? 0) > 0)),
  ].filter((g) => g.n > 0);
  const best = [...settled].sort((a, b) => b.p.peak - a.p.peak).slice(0, 5);

  return (
    <section className="border-b border-line px-5 py-5 md:px-8" aria-labelledby="track-title">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="track-title" className="font-display text-lg font-bold">
          Track record, last 24h
        </h2>
        <p className="text-xs text-muted">Peak within tracking after the signal fired. Signals under 30 min old are not counted yet.</p>
      </div>
      {settled.length < 5 ? (
        <p className="mt-3 text-sm text-muted">
          {settled.length === 0 ? "No settled signals yet." : `Only ${settled.length} settled signals so far.`} The record fills in as signals age.
        </p>
      ) : (
        <div className="mt-3 grid gap-6 md:grid-cols-[auto_1fr]">
          <dl className="grid grid-cols-[auto_auto_auto_auto] gap-x-5 gap-y-1 text-sm tabular-nums">
            <dt className="text-xs text-muted">Group</dt>
            <dd className="text-right text-xs text-muted">Signals</dd>
            <dd className="text-right text-xs text-muted">Hit 2x</dd>
            <dd className="text-right text-xs text-muted">Hit 3x</dd>
            {groups.map((g) => (
              <div key={g.label} className="contents">
                <dt>{g.label}</dt>
                <dd className="text-right">{g.n}</dd>
                <dd className="text-right text-flow">{Math.round((g.x2 / g.n) * 100)}%</dd>
                <dd className="text-right">{Math.round((g.x3 / g.n) * 100)}%</dd>
              </div>
            ))}
          </dl>
          <div>
            <h3 className="mb-1 text-xs text-muted">Best calls</h3>
            <ul className="flex flex-wrap gap-2 text-sm">
              {best.map(({ s, p }) => (
                <li key={s.mint}>
                  <a
                    href={`https://dexscreener.com/solana/${s.mint}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-block rounded-md border border-line px-2.5 py-1 hover:border-narr"
                  >
                    ${s.symbol} <span className="font-semibold text-flow">{mult(p.peak)}</span>{" "}
                    <span className="text-muted">on {s.matchedDisplay}</span>
                  </a>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </section>
  );
}

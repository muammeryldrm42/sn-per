"use client";

// Public lab: every rule the site calls on, and every rule being considered, measured the same way on live data.
import { useEffect, useState } from "react";
import type { LabStat } from "@/lib/lab";
import { PageTitle, Tabs, multText } from "./ui";
import { age } from "@/lib/format";

type Range = "24h" | "7d" | "30d";
const RANGES: { id: Range; label: string }[] = [
  { id: "24h", label: "24h" },
  { id: "7d", label: "7 days" },
  { id: "30d", label: "30 days" },
];

interface Fire {
  m: string;
  s: string;
  t: number;
  c: number;
  peak: number;
  end: number;
  done: boolean;
}

export function LabView({ remoteUrl, now, onOpen }: { remoteUrl?: string; now: number; onOpen: (m: string) => void }) {
  const [range, setRange] = useState<Range>("7d");
  const [data, setData] = useState<{ rules: LabStat[]; horizonMin: number; updatedAt: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pick, setPick] = useState<string | null>(null);
  const [fires, setFires] = useState<Fire[] | null>(null);
  const base = remoteUrl?.replace(/\/$/, "");

  useEffect(() => {
    if (!base) return;
    let alive = true;
    const load = async () => {
      try {
        const r = await fetch(`${base}/lab?range=${range}`, { cache: "no-store" });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const j = await r.json();
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
  }, [base, range]);

  useEffect(() => {
    if (!base || !pick) return;
    setFires(null);
    fetch(`${base}/lab/recent?rule=${pick}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => setFires(j.fires ?? []))
      .catch(() => setFires([]));
  }, [base, pick]);

  const live = data?.rules.filter((r) => r.live) ?? [];
  const shadow = data?.rules.filter((r) => !r.live) ?? [];

  return (
    <div>
      <PageTitle dim="Public" bright="Lab" />
      <div className="card mb-4 px-4 py-3 text-[13px] leading-relaxed text-muted">
        <p>
          Every rule this site calls on, and every rule we are thinking about, measured the same way on live data. A rule fires the first time a radar
          token passes it (on a price under 90 seconds old). From there the market cap is followed for {data?.horizonMin ?? 45} minutes: peak, where it
          ended, and a paper trade with the same exit plan as the calls (half at 2x, cut at 0.6x before that, rest sold 35% off the high).{" "}
          <span className="text-text">No caps, no picking, losers included.</span>
        </p>
        <p className="mt-2">
          A live rule only changes when a variant beats it here on enough fires, and every change goes into the changelog on the{" "}
          <a href="#method" className="text-flow underline-offset-2 hover:underline">
            how it works
          </a>{" "}
          page. The range after the 2x rate is its 95% band: with few fires it is wide, read it before trusting a number. Net = after ~2.5% round-trip
          fees and slippage.
        </p>
      </div>

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <Tabs value={range} onChange={setRange} items={RANGES} label="Range" />
        {data && <p className="font-mono text-[11px] text-dim">updated {age(data.updatedAt, now)} ago</p>}
      </div>

      {!base ? (
        <p className="card px-4 py-8 text-center text-sm text-muted">The lab runs on the shared scanner. This tab is scanning on its own, so there is nothing to show here.</p>
      ) : !data ? (
        <p className="card px-4 py-8 text-center text-sm text-muted">{error ? `Could not load the lab (${error}).` : "Loading..."}</p>
      ) : (
        <div className="space-y-5">
          <RuleTable title="Live rules (the tiers, uncapped)" rows={live} pick={pick} setPick={setPick} />
          <RuleTable title="Variants being measured" rows={shadow} pick={pick} setPick={setPick} />
          {pick && (
            <section className="card overflow-hidden">
              <div className="flex items-center justify-between border-b border-line px-4 py-2.5">
                <h2 className="label">Latest fires · {data.rules.find((r) => r.id === pick)?.label}</h2>
                <button type="button" onClick={() => setPick(null)} className="font-mono text-[11px] uppercase text-dim hover:text-text">
                  close
                </button>
              </div>
              {!fires ? (
                <p className="px-4 py-6 text-sm text-muted">Loading...</p>
              ) : !fires.length ? (
                <p className="px-4 py-6 text-sm text-muted">No fires yet.</p>
              ) : (
                <ul>
                  {fires.map((f) => (
                    <li key={f.m + f.t} className="border-b border-line last:border-b-0">
                      <button
                        type="button"
                        onClick={() => onOpen(f.m)}
                        className="grid w-full grid-cols-[minmax(0,1fr)_90px_80px_80px] items-center gap-2 px-4 py-2 text-left font-mono text-[12px] hover:bg-row"
                      >
                        <span className="truncate text-text">${f.s}</span>
                        <span className="text-muted">${(f.c / 1000).toFixed(1)}K</span>
                        <span style={{ color: f.peak >= 2 ? "var(--flow)" : undefined }} className={f.peak >= 2 ? "" : "text-muted"}>
                          peak {multText(f.peak)}
                        </span>
                        <span className={f.end < 0.2 ? "text-warn" : "text-muted"}>
                          {f.done ? "end" : "now"} {multText(f.end)}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )}
        </div>
      )}
    </div>
  );
}

function RuleTable({ title, rows, pick, setPick }: { title: string; rows: LabStat[]; pick: string | null; setPick: (id: string) => void }) {
  return (
    <section className="card overflow-hidden">
      <h2 className="label border-b border-line px-4 py-2.5">{title}</h2>
      <div className="hidden grid-cols-[minmax(220px,1.6fr)_70px_70px_150px_70px_70px_90px_90px] gap-3 border-b border-line px-4 py-2 font-mono text-[10px] uppercase tracking-wider text-dim lg:grid">
        <span>Rule</span>
        <span>Fires</span>
        <span>A day</span>
        <span>2x (95% band)</span>
        <span>1.5x</span>
        <span>Rug</span>
        <span>Paper net</span>
        <span>Wins net</span>
      </div>
      <ul>
        {rows.map((r) => {
          const good = r.n >= 20 && r.paperNet >= 1;
          return (
            <li key={r.id} className="border-b border-line last:border-b-0">
              <button
                type="button"
                onClick={() => setPick(r.id)}
                aria-pressed={pick === r.id}
                className="grid w-full grid-cols-2 items-center gap-x-3 gap-y-1 px-4 py-3 text-left transition-colors hover:bg-row lg:grid-cols-[minmax(220px,1.6fr)_70px_70px_150px_70px_70px_90px_90px]"
              >
                <span className="col-span-2 min-w-0 lg:col-span-1">
                  <span className="flex items-center gap-2">
                    <span className={`rounded px-1 py-px font-mono text-[9px] font-bold uppercase ${r.live ? "bg-flow/15 text-flow" : "bg-raise text-dim"}`}>
                      {r.live ? "live" : "test"}
                    </span>
                    <span className="truncate text-[13.5px] font-semibold text-text">{r.label}</span>
                  </span>
                  <span className="mt-0.5 block text-[11.5px] leading-snug text-muted">{r.note}</span>
                </span>
                <Cell k="Fires" v={`${r.n}${r.open ? ` +${r.open}` : ""}`} />
                <Cell k="A day" v={String(r.perDay)} />
                <Cell k="2x" v={r.n ? `${r.hit2}% (${r.hit2Low}-${r.hit2High})` : "-"} tone={r.n >= 20 && r.hit2 >= 30 ? "up" : undefined} />
                <Cell k="1.5x" v={r.n ? `${r.hit15}%` : "-"} />
                <Cell k="Rug" v={r.n ? `${r.rug}%` : "-"} tone={r.n && r.rug >= 20 ? "down" : undefined} />
                <Cell k="Paper net" v={r.n ? `${r.paperNet.toFixed(2)}x` : "-"} tone={!r.n ? undefined : good ? "up" : r.paperNet < 0.95 ? "down" : undefined} />
                <Cell k="Wins net" v={r.n ? `${r.win}%` : "-"} />
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function Cell({ k, v, tone }: { k: string; v: string; tone?: "up" | "down" }) {
  return (
    <span className="flex items-baseline justify-between gap-2 font-mono text-[12px] tabular-nums lg:block">
      <span className="text-[10px] uppercase text-dim lg:hidden">{k}</span>
      <span className={tone === "up" ? "text-flow" : tone === "down" ? "text-warn" : "text-text"}>{v}</span>
    </span>
  );
}

"use client";

import { useEffect, useState } from "react";
import { callOutcomes, PAPER_RULES, type CallRow } from "@/lib/archive";
import { computeRecord, type RecordStats } from "@/lib/record";
import { rowsForTier, TIERS, tierOf, type TierId } from "@/lib/tiers";
import { age, usd } from "@/lib/format";
import { tick, multText, PageTitle, peakColor, Tabs, TokenIcon, TriggerChip, TRIGGER_COLOR } from "./ui";

type Range = "24h" | "7d" | "30d" | "all";
const RANGES: { id: Range; label: string }[] = [
  { id: "24h", label: "24h" },
  { id: "7d", label: "7 days" },
  { id: "30d", label: "30 days" },
  { id: "all", label: "All time" },
];
const LABEL_TO_TRIGGER: Record<string, string> = {
  Graduated: "graduated",
  Graduating: "graduating",
  Runner: "runner",
  "Smart money": "smart",
  Momentum: "momentum",
  "Fast curve": "curve",
  "DEX paid": "dexpaid",
  "Fresh launch": "fresh",
  "Early launch": "ultra",
};
const TIER_TABS = TIERS.map((t) => ({ id: t.id, label: t.label }));

// Public track record of every call, losers included.
export function RecordView({
  calls,
  early = [],
  ultra = [],
  now,
  remoteUrl,
  onOpen,
}: {
  calls: CallRow[];
  early?: CallRow[];
  ultra?: CallRow[];
  now: number;
  remoteUrl?: string;
  onOpen: (m: string) => void;
}) {
  const [range, setRange] = useState<Range>("7d");
  const [tier, setTier] = useState<TierId>("balanced");
  const [remote, setRemote] = useState<RecordStats | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!remoteUrl) return;
    let alive = true;
    setRemote(null);
    const load = async () => {
      try {
        const r = await fetch(`${remoteUrl.replace(/\/$/, "")}/record?range=${range}&tier=${tier}`, { cache: "no-store" });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const j = (await r.json()) as RecordStats;
        if (alive) {
          setRemote(j);
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
  }, [remoteUrl, range, tier]);

  const stats = remoteUrl ? remote : computeRecord(callOutcomes(rowsForTier(tier, calls, early, ultra)), range, now);
  const n = stats?.n ?? 0;
  const pctOf = (k: number) => (stats && n ? Math.round(((stats.hits[k] ?? 0) / n) * 100) : 0);
  const steps = stats ? Object.entries(stats.hits).sort((a, b) => parseFloat(a[0]) - parseFloat(b[0])) : [];
  const top = stats?.best[0];
  const rangeName = RANGES.find((r) => r.id === range)?.label.toLowerCase() ?? range;

  const share = () => {
    if (!stats || !n) return;
    const text = `Talons ${tierOf(tier).label.toLowerCase()} calls, ${rangeName}: ${n} calls, ${pctOf(2)}% hit 2x, ${pctOf(5)}% hit 5x${top ? `, best $${tick(top.s)} ${multText(top.p)}` : ""}. Free, every call logged.`;
    const url = typeof window !== "undefined" ? `${window.location.origin}/#record` : "";
    window.open(`https://x.com/intent/tweet?text=${encodeURIComponent(text)}&url=${encodeURIComponent(url)}`, "_blank", "noopener");
  };

  return (
    <div>
      <PageTitle dim="Track" bright="Record">
        <button
          type="button"
          onClick={share}
          disabled={!n}
          className="flex h-9 items-center gap-2 rounded-md border border-line px-3 font-mono text-[11px] uppercase tracking-wider text-muted hover:border-flow/50 hover:text-text disabled:opacity-40"
        >
          <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor" aria-hidden>
            <path d="M9.2 1h1.7L7.2 5.3 11.6 11H8.2L5.5 7.5 2.4 11H.7l4-4.6L.4 1h3.5l2.4 3.2zm-.6 9h.9L3.4 1.9h-1z" />
          </svg>
          Share
        </button>
      </PageTitle>

      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <Tabs value={tier} onChange={setTier} items={TIER_TABS} label="Which calls" />
          <span className="mx-1 hidden h-5 w-px bg-line sm:block" aria-hidden />
          <Tabs value={range} onChange={setRange} items={RANGES} label="Range" />
        </div>
        <p className="font-mono text-[11px] text-dim">Every call counts once it is 30 min old. Peak = highest market cap after the call, not profit.</p>
      </div>
      <p className="mb-4 font-mono text-[11px]" style={{ color: tierOf(tier).color }}>
        {tierOf(tier).label}: {tierOf(tier).blurb} Each tier has its own record.
      </p>
      {remoteUrl && (
        <p className="mb-4 font-mono text-[11px] text-dim">
          Every call of this tier, losers included:{" "}
          <a className="text-flow hover:underline" href={`${remoteUrl.replace(/\/$/, "")}/export?tier=${tier}`}>
            download CSV
          </a>{" "}
          ·{" "}
          <a className="text-flow hover:underline" href="#lab">
            every rule measured in the public lab
          </a>
        </p>
      )}
      {!remoteUrl && <p className="mb-4 font-mono text-[11px] text-narr">This tab only knows the calls it saw in the last 7 days. The shared scanner keeps them all.</p>}

      {!stats ? (
        <p className="card px-4 py-8 text-center text-sm text-muted">{error ? `Could not load the record (${error}).` : "Loading..."}</p>
      ) : n === 0 ? (
        <div className="card px-4 py-12 text-center">
          <p className="font-big text-[26px] uppercase text-dim">Nothing settled yet</p>
          <p className="mx-auto mt-2 max-w-md text-sm text-muted">Calls start counting 30 minutes after they are made. Nothing is ever removed.</p>
        </div>
      ) : (
        <div className="space-y-5">
          {/* headline numbers */}
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Card label="Calls" value={n.toLocaleString()} sub={`settled, ${rangeName}`} />
            <Card label="2x+ hit rate" value={`${pctOf(2)}%`} sub={plural(stats.hits[2] ?? 0, "call")} tone={pctOf(2) >= 30 ? "up" : undefined} />
            <Card label="5x+ hit rate" value={`${pctOf(5)}%`} sub={plural(stats.hits[5] ?? 0, "call")} tone={pctOf(5) >= 10 ? "up" : undefined} />
            <Card label="Median peak" value={multText(stats.median)} sub={stats.avg ? `average ${multText(stats.avg)}` : undefined} />
          </div>

          {/* paper trading: what following every call with one fixed exit plan returned */}
          {stats.paper && (
            <section className="card p-4">
              <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
                <h2 className="label">Paper P&amp;L, every call followed</h2>
                <p className="font-mono text-[10.5px] text-dim">
                  Buy at the call · sell half at {PAPER_RULES.tp}x · cut at {PAPER_RULES.stop}x before that · rest sold {Math.round((1 - PAPER_RULES.trail) * 100)}% off the high · closed after 7 days
                </p>
              </div>
              <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                <Mini
                  label="Average per call"
                  value={multText(stats.paper.avg)}
                  sub={`${multText(stats.paper.avg * 0.975)} after ~2.5% costs`}
                  tone={stats.paper.avg * 0.975 >= 1 ? "up" : "down"}
                />
                <Mini label="Median per call" value={multText(stats.paper.med)} tone={stats.paper.med >= 1 ? "up" : "down"} />
                <Mini label="Calls in profit" value={`${Math.round((stats.paper.win / stats.paper.n) * 100)}%`} sub={`${stats.paper.win} of ${stats.paper.n}`} />
                <Mini
                  label="$100 on every call"
                  value={`${stats.paper.pnl100 >= 0 ? "+" : "-"}$${Math.abs(stats.paper.pnl100).toLocaleString()}`}
                  sub={`on $${(stats.paper.n * 100).toLocaleString()} put in`}
                  tone={stats.paper.pnl100 >= 0 ? "up" : "down"}
                />
              </div>
              <p className="mt-3 font-mono text-[10.5px] leading-relaxed text-dim">
                Peaks show how far calls ran; this shows what a plain, rule-based follower would have kept. Open trades are marked at the last
                price. Before fees and slippage (about 2.5% a round trip on pump.fun), shown after costs under the average.
              </p>
            </section>
          )}

          {/* best performer */}
          {top && (
            <button
              type="button"
              onClick={() => onOpen(top.m)}
              className="card flex w-full flex-wrap items-center gap-4 border-flow/30 p-4 text-left transition-colors hover:border-flow/60 sm:p-5"
              style={{ background: "linear-gradient(90deg, #4ade5014, transparent 60%), var(--panel)" }}
            >
              <TokenIcon src={top.i} label={top.s} size={52} />
              <span className="min-w-0 flex-1">
                <span className="label block !text-[10px] !text-flow">Best call · {rangeName}</span>
                <span className="font-big mt-1 block text-[30px] uppercase leading-none">${tick(top.s)}</span>
                <span className="mt-1 block font-mono text-[11px] text-muted">
                  {top.e ? (
                    <>
                      called at {usd(top.e)} <span className="text-dim">→</span> <span className="text-flow">peak {usd(top.e * top.p)}</span> ·{" "}
                    </>
                  ) : null}
                  {top.n} · {age(top.t, now)} ago
                </span>
              </span>
              <span className="text-right">
                <span className="font-big block text-[44px] leading-none text-flow">{multText(top.p)}</span>
                <span className="label !text-[9.5px]">peak multiple</span>
              </span>
            </button>
          )}

          <div className="grid gap-5 lg:grid-cols-2">
            {/* breakdown */}
            <section className="card p-4">
              <h2 className="label mb-1">Win rate breakdown</h2>
              <p className="mb-3 font-mono text-[11px] text-dim">Based on {n.toLocaleString()} calls</p>
              <ul className="space-y-2.5">
                {steps.map(([x, c]) => {
                  const p = Math.round((c / n) * 100);
                  const low = parseFloat(x) < 2;
                  return (
                    <li key={x}>
                      <div className="mb-1 flex justify-between font-mono text-[12px] tabular-nums">
                        <span className="text-text">{x}x or higher</span>
                        <span>
                          <span className={low ? "text-narr" : "text-flow"}>{p}%</span> <span className="text-dim">({c})</span>
                        </span>
                      </div>
                      <span className="block h-2 overflow-hidden rounded-full bg-line">
                        <span className={`block h-full rounded-full ${low ? "bg-narr" : "bg-flow"}`} style={{ width: `${Math.max(p ? 1.5 : 0, p)}%` }} />
                      </span>
                    </li>
                  );
                })}
              </ul>
              <div className="mt-4 grid grid-cols-2 gap-2">
                <Fact big={ratioText(stats.hits[1.2] ?? 0, n)} small="calls ran to at least 1.2x" />
                <Fact big={ratioText(stats.hits[5] ?? 0, n)} small="calls reached 5x or more" />
              </div>
            </section>

            {/* by type */}
            <section className="card p-4">
              <h2 className="label mb-3">By call type</h2>
              <table className="w-full font-mono text-[12px] tabular-nums">
                <thead>
                  <tr className="text-left text-[10px] uppercase tracking-wider text-dim">
                    <th className="pb-2 font-normal">Type</th>
                    <th className="pb-2 text-right font-normal">Calls</th>
                    <th className="pb-2 text-right font-normal">2x</th>
                    <th className="pb-2 text-right font-normal">3x</th>
                  </tr>
                </thead>
                <tbody>
                  {stats.groups.map((g) => {
                    const label = g.label.replace(/^All signals$/, "All calls").replace(/^Type: /, "");
                    const trig = LABEL_TO_TRIGGER[label];
                    return (
                      <tr key={g.label} className="border-t border-line">
                        <td className="py-2 pr-2">
                          {trig ? <TriggerChip trigger={trig} small /> : <span className="text-text">{label}</span>}
                        </td>
                        <td className="py-2 text-right text-muted">{g.n}</td>
                        <td className="py-2 text-right" style={{ color: trig ? TRIGGER_COLOR[trig] : "var(--flow)" }}>
                          {Math.round((g.x2 / g.n) * 100)}%
                        </td>
                        <td className="py-2 text-right">{Math.round((g.x3 / g.n) * 100)}%</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <p className="mt-3 font-mono text-[10.5px] leading-relaxed text-dim">
                Older calls made on launch momentum, fast curves or DEX paid profiles are kept as they were; new calls need a proof (graduating,
                graduated, runner or smart money).
              </p>
            </section>

            {/* hot hours */}
            {stats.hours && (
              <section className="card p-4 lg:col-span-2">
                <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
                  <h2 className="label">Hot hours (UTC)</h2>
                  <span className="font-mono text-[10.5px] text-dim">
                    <span className="text-muted">■</span> calls <span className="ml-2 text-flow">■</span> hit 2x
                  </span>
                </div>
                <HotHours hours={stats.hours} />
              </section>
            )}

            {/* top winners */}
            <section className="card overflow-hidden">
              <h2 className="label border-b border-line px-4 py-2.5">Top 10 winners · {rangeName}</h2>
              <ol>
                {stats.best.map((o, i) => (
                  <li key={o.m} className="border-b border-line last:border-b-0">
                    <button type="button" onClick={() => onOpen(o.m)} className="flex w-full items-center gap-3 px-4 py-2.5 text-left hover:bg-row">
                      <span className="w-6 font-mono text-[11px] text-dim">#{i + 1}</span>
                      <TokenIcon src={o.i} label={o.s} size={28} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-mono text-[13px] font-bold">${tick(o.s)}</span>
                        <span className="block truncate font-mono text-[10.5px] text-muted">
                          {o.e ? `at ${usd(o.e)} · ` : ""}
                          {o.n} · {age(o.t, now)} ago
                        </span>
                      </span>
                      <span className="rounded bg-flow/10 px-2 py-0.5 font-mono text-[12px] font-bold" style={{ color: peakColor(o.p) }}>
                        {multText(o.p)}
                      </span>
                    </button>
                  </li>
                ))}
              </ol>
            </section>

            {/* daily */}
            <section className="card overflow-hidden">
              <h2 className="label border-b border-line px-4 py-2.5">Day by day</h2>
              {(stats.daily ?? []).length === 0 ? (
                <p className="px-4 py-6 text-center text-sm text-muted">No days yet.</p>
              ) : (
                <ul className="scroll-thin max-h-[460px] overflow-y-auto">
                  {(stats.daily ?? []).map((d) => (
                    <li key={d.d} className="flex items-center gap-3 border-b border-line px-4 py-2.5 last:border-b-0">
                      <span className="min-w-0 flex-1">
                        <span className="block font-mono text-[13px] text-text">
                          {new Date(`${d.d}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" })}
                        </span>
                        <span className="block font-mono text-[10.5px] text-muted">
                          {d.n} call{d.n === 1 ? "" : "s"} · {d.x2} hit 2x ({Math.round((d.x2 / d.n) * 100)}%)
                        </span>
                      </span>
                      <span className="text-right font-mono text-[11px]">
                        <span className="block text-text">median {multText(d.med)}</span>
                        <span className="block text-flow">best {multText(d.best)}</span>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>
        </div>
      )}
    </div>
  );
}

const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;

function ratioText(c: number, n: number) {
  if (!n) return "-";
  const r = c / n;
  if (r <= 0) return "none yet";
  const pairs: [number, number][] = [
    [9, 10], [4, 5], [3, 4], [2, 3], [3, 5], [1, 2], [2, 5], [1, 3], [1, 4], [1, 5], [1, 10], [1, 20], [1, 50], [1, 100],
  ];
  let best = pairs[0];
  for (const p of pairs) if (Math.abs(p[0] / p[1] - r) < Math.abs(best[0] / best[1] - r)) best = p;
  return `${best[0]} in ${best[1]}`;
}

function Card({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: "up" }) {
  return (
    <div className="card p-4">
      <span className="label block !text-[10px]">{label}</span>
      <span className="font-big mt-1.5 block text-[34px] leading-none" style={{ color: tone === "up" ? "var(--flow)" : "var(--text)" }}>
        {value}
      </span>
      {sub && <span className="mt-1 block font-mono text-[10.5px] text-dim">{sub}</span>}
    </div>
  );
}

function Fact({ big, small }: { big: string; small: string }) {
  return (
    <div className="rounded-lg border border-line bg-row px-3 py-2.5 text-center">
      <span className="font-big block text-[22px] leading-none text-text">{big}</span>
      <span className="mt-1 block font-mono text-[10px] text-muted">{small}</span>
    </div>
  );
}

function Mini({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: "up" | "down" }) {
  return (
    <div className="rounded-lg border border-line bg-row px-3 py-2.5">
      <span className="label block !text-[9.5px]">{label}</span>
      <span
        className="font-big mt-1 block text-[26px] leading-none"
        style={{ color: tone === "up" ? "var(--flow)" : tone === "down" ? "var(--warn)" : "var(--text)" }}
      >
        {value}
      </span>
      {sub && <span className="mt-1 block font-mono text-[10px] text-dim">{sub}</span>}
    </div>
  );
}

function HotHours({ hours }: { hours: { n: number; x2: number }[] }) {
  const max = Math.max(1, ...hours.map((h) => h.n));
  const nowH = new Date().getUTCHours();
  return (
    <div>
      <div className="flex h-28 items-end gap-[3px]" role="img" aria-label="Calls and 2x hits by hour of day, UTC">
        {hours.map((h, i) => (
          <div key={i} className="group relative flex h-full flex-1 flex-col justify-end" title={`${String(i).padStart(2, "0")}:00 UTC: ${h.n} calls, ${h.x2} hit 2x`}>
            <div className="relative w-full rounded-t-sm bg-raise" style={{ height: `${(h.n / max) * 100}%`, minHeight: h.n ? 3 : 0 }}>
              <div className="absolute inset-x-0 bottom-0 rounded-t-sm bg-flow" style={{ height: h.n ? `${(h.x2 / h.n) * 100}%` : 0 }} />
            </div>
            {i === nowH && <span className="absolute -top-1 left-1/2 h-1 w-1 -translate-x-1/2 rounded-full bg-narr" aria-hidden />}
          </div>
        ))}
      </div>
      <div className="mt-1 flex justify-between font-mono text-[9.5px] text-dim">
        <span>00</span>
        <span>06</span>
        <span>12</span>
        <span>18</span>
        <span>23</span>
      </div>
    </div>
  );
}

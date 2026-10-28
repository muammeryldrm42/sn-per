"use client";

// Gem Bot style pieces for the calls board: the tier switcher, the rug check and gem badges, the launch numbers
// stored with each call, and the board filters (kept per tier in this browser).
import { useEffect, useState } from "react";
import type { CallRow } from "@/lib/archive";
import { activeFilters, isGem, NO_FILTERS, rowRug, RUG_TEXT, TIERS, tierOf, type Filters, type TierId } from "@/lib/tiers";

interface Score {
  tier: string;
  n: number;
  hit2: number;
  down80: number;
  paper: number;
}

// Each tier's last 7 days side by side (settled calls only), so the choice is made on numbers.
function useScoreboard(remoteUrl?: string) {
  const [s, setS] = useState<Score[] | null>(null);
  useEffect(() => {
    if (!remoteUrl) return;
    let alive = true;
    const load = () =>
      fetch(`${remoteUrl.replace(/\/$/, "")}/scoreboard?range=7d`, { cache: "no-store" })
        .then((r) => r.json())
        .then((j) => alive && setS(j.tiers ?? null))
        .catch(() => {});
    load();
    const t = setInterval(load, 60_000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [remoteUrl]);
  return s;
}

export function TierSwitch({ tier, onTier, remoteUrl }: { tier: TierId; onTier: (t: TierId) => void; remoteUrl?: string }) {
  const cur = tierOf(tier);
  const score = useScoreboard(remoteUrl);
  return (
    <div className="card mb-4 overflow-hidden">
      <div className="grid grid-cols-2 sm:grid-cols-4" role="tablist" aria-label="Call tier">
        {TIERS.map((t) => {
          const on = t.id === tier;
          return (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={on}
              onClick={() => onTier(t.id)}
              className={`relative flex items-center justify-center gap-2 border-line px-3 py-3 font-mono text-[11.5px] font-bold uppercase tracking-wider transition-colors [&:not(:last-child)]:border-r ${
                on ? "bg-raise text-text" : "text-muted hover:bg-row hover:text-text"
              }`}
            >
              <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: t.color, boxShadow: on ? `0 0 10px ${t.color}` : undefined }} aria-hidden />
              <span className="flex flex-col items-start leading-tight">
                {t.label}
                {(() => {
                  const sc = score?.find((x) => x.tier === t.id);
                  if (!sc) return null;
                  return (
                    <span className="mt-0.5 font-mono text-[9.5px] font-normal normal-case tracking-normal text-dim">
                      {sc.n ? `7d ${sc.n} · 2x ${Math.round(sc.hit2)}% · ${sc.paper.toFixed(2)}x` : "7d no settled calls"}
                    </span>
                  );
                })()}
              </span>
              {on && <span className="absolute inset-x-0 bottom-0 h-[2px]" style={{ background: t.color }} aria-hidden />}
            </button>
          );
        })}
      </div>
      <p className="border-t border-line px-4 py-2.5 text-[12.5px] leading-relaxed text-muted">
        <span className="font-semibold" style={{ color: cur.color }}>
          {cur.label}.
        </span>{" "}
        {cur.blurb}
        {tier === "risky" && " Recordings: 30 calls, 40% hit 2x, none ended under 0.2x, 1.17x on average with the paper exit plan; most fell back to about 0.4x when nobody sold."}
        {tier === "ultra" && " Recordings: 40 calls (~270 a day), 35% hit 2x, 8% ended under 0.2x, 1.08x on average with the paper exit plan."}
        {(tier === "risky" || tier === "ultra") && <span className="text-warn"> Small size, take profit fast.</span>}
      </p>
    </div>
  );
}

export function RugBadge({ r, small = false }: { r: CallRow; small?: boolean }) {
  const v = rowRug(r);
  const t = RUG_TEXT[v];
  const cls = v === "clean" ? "bg-flow/10 text-flow ring-flow/30" : v === "rug" ? "bg-warn/10 text-warn ring-warn/30" : "bg-raise text-dim ring-line";
  return (
    <span title={`Rug check: ${t.label}. ${t.line}`} className={`inline-flex shrink-0 items-center rounded px-1 py-px font-mono font-bold uppercase tracking-wide ring-1 ${small ? "text-[9px]" : "text-[9.5px]"} ${cls}`}>
      {v === "rug" ? "! " : ""}
      {t.label}
    </span>
  );
}

export function GemBadge({ r }: { r: CallRow }) {
  if (!isGem(r)) return null;
  return (
    <span
      title="Clean launch: under 5% of supply bundled with the create, under 5% sniped in the next slots, dev bought under 5%, no heavy fresh or linked wallets. A signal, not a guarantee."
      className="inline-flex shrink-0 items-center gap-0.5 rounded bg-[#2bd49b]/10 px-1 py-px font-mono text-[9.5px] font-bold uppercase tracking-wide text-[#2bd49b] ring-1 ring-[#2bd49b]/30"
    >
      ◆ Gem
    </span>
  );
}

const pct = (v?: number) => (v == null ? "?" : `${v < 10 ? v.toFixed(1) : Math.round(v)}%`);

// "Bundled 3.1% · sniped 0% · dev 2.4%" at the call; "?" when the wallet read was not in yet.
export function LaunchStats({ r }: { r: CallRow }) {
  if (r.bp == null && r.sp == null && r.cb == null) return null;
  return (
    <span className="whitespace-nowrap" title="Launch block: share of supply bought with the create by other wallets (B, bundled), in the next 3 slots (S, sniped), and by the dev">
      <span className="text-dim">B</span> {pct(r.bp)} <span className="text-dim">· S</span> {pct(r.sp)}
      {r.cb != null && (
        <>
          {" "}
          <span className="text-dim">· Dev</span> {pct(r.cb)}
        </>
      )}
    </span>
  );
}

const KEY = (tier: TierId) => `tns.filters.${tier}.v1`;
export function useFilters(tier: TierId) {
  const [f, setF] = useState<Filters>(NO_FILTERS);
  useEffect(() => {
    try {
      const raw = localStorage.getItem(KEY(tier));
      setF(raw ? { ...NO_FILTERS, ...JSON.parse(raw) } : NO_FILTERS);
    } catch {
      setF(NO_FILTERS);
    }
  }, [tier]);
  const set = (next: Filters) => {
    setF(next);
    try {
      localStorage.setItem(KEY(tier), JSON.stringify(next));
    } catch {
      /* private mode: keep it in memory */
    }
  };
  return { f, set, count: activeFilters(f) };
}

function Num({ label, value, onChange, suffix, step = 1 }: { label: string; value: number | null; onChange: (v: number | null) => void; suffix: string; step?: number }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="label !text-[9.5px]">{label}</span>
      <span className="flex h-8 items-center rounded-md border border-line bg-panel px-2 focus-within:border-flow/50">
        <input
          type="number"
          inputMode="decimal"
          min={0}
          step={step}
          value={value ?? ""}
          onChange={(e) => onChange(e.target.value === "" ? null : Math.max(0, Number(e.target.value)))}
          className="w-full min-w-0 bg-transparent font-mono text-[12px] text-text outline-none placeholder:text-dim"
          placeholder="any"
        />
        <span className="font-mono text-[10.5px] text-dim">{suffix}</span>
      </span>
    </label>
  );
}

function Toggle({ on, onChange, children }: { on: boolean; onChange: (v: boolean) => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={() => onChange(!on)}
      className={`h-8 rounded-md px-2.5 font-mono text-[10.5px] font-bold uppercase tracking-wide ring-1 transition-colors ${
        on ? "bg-flow/15 text-flow ring-flow/40" : "text-muted ring-line hover:text-text"
      }`}
    >
      {children}
    </button>
  );
}

// Market cap is entered in $K. Launch filters drop calls whose wallet read was not in, like Gem Bot.
export function FilterPanel({ f, set }: { f: Filters; set: (f: Filters) => void }) {
  const k = (v: number | null) => (v == null ? null : Math.round(v / 100) / 10);
  const fromK = (v: number | null) => (v == null ? null : v * 1000);
  return (
    <div className="border-b border-line bg-row/40 px-3 py-3 sm:px-4">
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4 lg:grid-cols-7">
        <Num label="Mcap at call min" value={k(f.mcMin)} onChange={(v) => set({ ...f, mcMin: fromK(v) })} suffix="$K" step={0.5} />
        <Num label="Mcap at call max" value={k(f.mcMax)} onChange={(v) => set({ ...f, mcMax: fromK(v) })} suffix="$K" step={0.5} />
        <Num label="Bundled max" value={f.bundledMax} onChange={(v) => set({ ...f, bundledMax: v })} suffix="%" />
        <Num label="Sniped max" value={f.snipedMax} onChange={(v) => set({ ...f, snipedMax: v })} suffix="%" />
        <Num label="Dev bought max" value={f.creatorMax} onChange={(v) => set({ ...f, creatorMax: v })} suffix="%" />
        <Num label="Fresh wallets max" value={f.freshMax} onChange={(v) => set({ ...f, freshMax: v })} suffix="%" />
        <Num label="Peak at least" value={f.peakMin} onChange={(v) => set({ ...f, peakMin: v })} suffix="x" step={0.5} />
      </div>
      <div className="mt-2.5 flex flex-wrap items-center gap-2">
        <Toggle on={f.gemOnly} onChange={(v) => set({ ...f, gemOnly: v })}>
          ◆ Gems only
        </Toggle>
        <Toggle on={f.hideRug} onChange={(v) => set({ ...f, hideRug: v })}>
          Hide rug likely
        </Toggle>
        {activeFilters(f) > 0 && (
          <button type="button" onClick={() => set(NO_FILTERS)} className="ml-auto font-mono text-[10.5px] uppercase tracking-wider text-dim hover:text-text">
            Clear filters
          </button>
        )}
      </div>
    </div>
  );
}

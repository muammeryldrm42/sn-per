"use client";

import { useEffect, useMemo, useState } from "react";
import type { CallRow } from "@/lib/archive";
import { age, short, usd } from "@/lib/format";
import { Spark } from "./Spark";
import { BuyMenu, GradeChip, PaperPill, tick, multText, PageTitle, PeakMeter, peakColor, ShareButton, StarButton, StatPill, Tabs, TokenIcon, TriggerChip, XPill, TRIGGER_COLOR } from "./ui";
import { paperValue } from "@/lib/archive";
import { TRIGGER_LABEL } from "@/lib/archive";
import { useStars } from "@/lib/watch";
import { Tape, HowItWorks } from "./Tape";
import { passFilters, rowsForTier, type TierId } from "@/lib/tiers";
import { useTierFeed } from "@/lib/remote";
import { FilterPanel, GemBadge, LaunchStats, RugBadge, TierSwitch, useFilters } from "./TierBits";

type Sort = "movers" | "newest" | "nowcall" | "pnl" | "score" | "mcap";
type Range = "24h" | "7d" | "all";

const SORTS: { id: Sort; label: string }[] = [
  { id: "movers", label: "Top movers" },
  { id: "newest", label: "Newest" },
  { id: "nowcall", label: "Now vs call" },
  { id: "pnl", label: "Paper P&L" },
  { id: "score", label: "Score" },
  { id: "mcap", label: "Market cap" },
];
const RANGES: { id: Range; label: string }[] = [
  { id: "24h", label: "24h" },
  { id: "7d", label: "7d" },
  { id: "all", label: "All" },
];

const RANK_COLOR = ["var(--narr)", "var(--violet)", "var(--steel)"];
const SETTLE_MS = 30 * 60_000;

export function CallsBoard({
  main,
  early = [],
  ultra = [],
  now,
  remoteUrl,
  query,
  initialRange = "24h",
  watching,
  onOpen,
  tier = "balanced",
  onTier,
}: {
  main: CallRow[];
  early?: CallRow[];
  ultra?: CallRow[];
  now: number;
  remoteUrl?: string;
  query: string;
  initialRange?: Range;
  watching: number;
  onOpen: (mint: string) => void;
  tier?: TierId; // conservative, balanced, risky (fresh launch rule) or ultra risky: each its own list and record
  onTier?: (t: TierId) => void;
}) {
  const isEarly = tier === "risky" || tier === "ultra";
  const [sort, setSort] = useState<Sort>("movers");
  const [type, setType] = useState<string>("all");
  const [onlyStars, setOnlyStars] = useState(false);
  const stars = useStars();
  const [range, setRange] = useState<Range>(initialRange);
  const filters = useFilters(tier);
  const [showFilters, setShowFilters] = useState(false);
  // The risky tiers come from the worker's /feed (hundreds of calls a day); the others from the live stream.
  const fromFeed = isEarly && !!remoteUrl;
  const feed = useTierFeed(remoteUrl, tier, range === "24h" ? "24h" : "7d", fromFeed);
  const calls = useMemo(() => (fromFeed ? feed.rows : rowsForTier(tier, main, early, ultra)), [fromFeed, feed.rows, tier, main, early, ultra]);
  const [older, setOlder] = useState<CallRow[]>([]);
  const [total, setTotal] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  useEffect(() => setRange(initialRange), [initialRange]);

  const base = remoteUrl?.replace(/\/$/, "");
  const loadOlder = async (reset = false) => {
    if (!base) return;
    setLoading(true);
    try {
      const pool = reset ? calls : [...calls, ...older];
      const before = pool.length ? Math.min(...pool.map((r) => r.t)) : Date.now() + 1;
      const r = await fetch(`${base}/archive?before=${before}&limit=100&tier=${tier}`, { cache: "no-store" });
      const j = (await r.json()) as { calls: CallRow[]; total: number };
      setOlder((o) => (reset ? j.calls : [...o, ...j.calls]));
      setTotal(j.total);
    } catch {
      /* keep what we have */
    }
    setLoading(false);
  };
  useEffect(() => {
    if (range === "all" && base && total == null) loadOlder(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [range, base]);

  const inRange = useMemo(() => {
    const map = new Map<string, CallRow>();
    if (range === "all") for (const r of older) map.set(r.m, r);
    for (const r of calls) map.set(r.m, r);
    const span = range === "24h" ? 24 * 3600_000 : range === "7d" ? 7 * 24 * 3600_000 : Infinity;
    return [...map.values()].filter((r) => now - r.t <= span && r.c > 0);
  }, [calls, older, range, now]);

  const q = query.trim().toLowerCase();
  const rows = useMemo(() => {
    const list = (q
      ? inRange.filter((r) => r.s.toLowerCase().includes(q.replace(/^\$/, "")) || r.n.toLowerCase().includes(q) || r.m.toLowerCase() === q)
      : inRange
    )
      .filter((r) => type === "all" || r.tr === type)
      .filter((r) => !onlyStars || stars.has(r.m))
      .filter((r) => passFilters(r, filters.f));
    const key: Record<Sort, (r: CallRow) => number> = {
      movers: (r) => r.pk / r.c,
      newest: (r) => r.t,
      nowcall: (r) => r.now / r.c,
      pnl: (r) => paperValue(r) ?? 0,
      score: (r) => r.sc,
      mcap: (r) => r.now,
    };
    return [...list].sort((a, b) => key[sort](b) - key[sort](a) || b.t - a.t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inRange, q, sort, type, onlyStars, filters.f, stars.stars]);
  const types = [...new Set(inRange.map((r) => r.tr))];

  const settled = inRange.filter((r) => now - r.t >= SETTLE_MS);
  const hit2 = settled.length ? settled.filter((r) => r.pk / r.c >= 2).length / settled.length : null;
  const best = inRange.reduce((m, r) => Math.max(m, r.pk / r.c), 0);
  const rangeLabel = range === "all" ? "all" : range;

  return (
    <div>
      <PageTitle dim="Calls" bright="Live">
        <StatPill
          items={[
            { value: String(range === "all" && total != null ? total : inRange.length), label: `Calls · ${rangeLabel}` },
            { value: best ? multText(best) : "-", label: `Best peak · ${rangeLabel}`, tone: best >= 2 ? "up" : undefined },
            {
              value: hit2 == null ? "-" : `${Math.round(hit2 * 100)}%`,
              label: `Hit 2x (${settled.length})`,
              tone: hit2 != null && hit2 >= 0.3 ? "up" : undefined,
            },
          ]}
        />
      </PageTitle>

      {onTier && <TierSwitch tier={tier} onTier={onTier} remoteUrl={remoteUrl} />}
      {!isEarly && (
        <>
          <HowItWorks />
          <Tape calls={calls} now={now} onOpen={onOpen} />
        </>
      )}

      <section className="card overflow-hidden" aria-label="Calls">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-3 py-2.5 sm:px-4">
          <div className="flex flex-wrap items-center gap-2">
            <span className="label hidden sm:inline">Sort</span>
            <Tabs value={sort} onChange={setSort} items={SORTS} label="Sort calls" />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setOnlyStars((v) => !v)}
              aria-pressed={onlyStars}
              className={`flex items-center gap-1.5 rounded-md px-2.5 py-1.5 font-mono text-[11px] uppercase tracking-wider transition-colors ${
                onlyStars ? "bg-narr/15 text-narr" : "text-muted hover:bg-raise hover:text-text"
              }`}
            >
              ★ Watchlist{stars.stars.length ? ` ${stars.stars.length}` : ""}
            </button>
            <button
              type="button"
              onClick={() => setShowFilters((v) => !v)}
              aria-expanded={showFilters}
              className={`flex items-center gap-1.5 rounded-md px-2.5 py-1.5 font-mono text-[11px] uppercase tracking-wider transition-colors ${
                showFilters || filters.count ? "bg-raise text-text" : "text-muted hover:bg-raise hover:text-text"
              }`}
            >
              Filters{filters.count ? <span className="rounded bg-flow/20 px-1 text-flow">{filters.count}</span> : null}
            </button>
            <Tabs value={range} onChange={setRange} items={RANGES} label="Time range" />
          </div>
        </div>
        {showFilters && <FilterPanel f={filters.f} set={filters.set} />}
        {inRange.length > 0 && !isEarly && (
          <div className="flex flex-wrap items-center gap-1.5 border-b border-line px-3 py-2 sm:px-4" role="group" aria-label="Call type">

            <span className="label mr-1 hidden !text-[10px] sm:inline">Type</span>
            {["all", ...types].map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setType(t)}
                aria-pressed={type === t}
                className={`rounded px-2 py-1 font-mono text-[10.5px] uppercase tracking-wide transition-colors ${
                  type === t ? "bg-raise text-text" : "text-dim hover:text-text"
                }`}
                style={type === t && t !== "all" ? { color: TRIGGER_COLOR[t] } : undefined}
              >
                {t === "all" ? "All" : TRIGGER_LABEL[t] ?? t} <span className="text-dim">{t === "all" ? inRange.length : inRange.filter((r) => r.tr === t).length}</span>
              </button>
            ))}
          </div>
        )}

        {rows.length === 0 ? (
          onlyStars && inRange.length > 0 ? (
            <p className="px-4 py-10 text-center text-sm text-muted">No starred calls in this range. Tap ★ on a call to keep it in your watchlist.</p>
          ) : filters.count && inRange.length > 0 ? (
            <p className="px-4 py-10 text-center text-sm text-muted">No call in this range passes your filters.</p>
          ) : fromFeed && !feed.loaded ? (
            <p className="px-4 py-10 text-center text-sm text-muted">Loading...</p>
          ) : (
            <Empty q={q} range={range} watching={watching} hasAny={inRange.length > 0} early={isEarly} />
          )
        ) : (
          <>
            <div
              className="label hidden grid-cols-[40px_minmax(190px,1.5fr)_minmax(130px,1fr)_96px_128px_150px_minmax(140px,1.1fr)_150px] items-center gap-3 border-b border-line px-4 py-2 !text-[10px] xl:grid"
              aria-hidden
            >
              <span>#</span>
              <span>Token · why called</span>
              <span>Score · flags</span>
              <span>Called</span>
              <span>Now</span>
              <span>Peak since call</span>
              <span className="whitespace-nowrap">
                Chart <span className="text-narr">◆</span> call <span className="text-flow">▲</span> peak
              </span>
              <span />
            </div>
            <ol>
              {rows.map((r, i) => (
                <CallLine key={r.m} r={r} rank={i + 1} now={now} onOpen={onOpen} starred={stars.has(r.m)} onStar={() => stars.toggle(r.m)} />
              ))}
            </ol>
          </>
        )}
        {range === "all" && base && (total == null || inRange.length < total) && rows.length > 0 && !q && !filters.count && (
          <div className="border-t border-line p-3 text-center">
            <button
              type="button"
              onClick={() => loadOlder()}
              disabled={loading}
              className="rounded-md border border-line px-3 py-1.5 font-mono text-[11px] uppercase tracking-wider text-muted hover:text-text"
            >
              {loading ? "Loading..." : "Load older calls"}
            </button>
          </div>
        )}
      </section>
      <p className="mt-3 font-mono text-[11px] leading-relaxed text-dim">
        Called = market cap when the call was made. Peak = highest market cap seen after it (every 30 s for the first hour, then every 10
        min for 7 days). Not realized profit, not financial advice. Every call stays here forever, losers included.
        {isEarly ? " Risky and ultra risky calls have their own track records and never count toward the main calls." : ""}
        {!remoteUrl && range === "all" ? " This tab only keeps the last 7 days; the shared scanner keeps every call." : ""}
      </p>
    </div>
  );
}

function CallLine({
  r,
  rank,
  now,
  onOpen,
  starred,
  onStar,
}: {
  r: CallRow;
  rank: number;
  now: number;
  onOpen: (m: string) => void;
  starred: boolean;
  onStar: () => void;
}) {
  const px = r.pk / r.c;
  const nx = r.now / r.c;
  const fresh = now - r.t < 90_000;
  const top = rank === 1;
  const launchAge = r.la ? Math.max(0, Math.round((r.t - r.la) / 60_000)) : null;
  return (
    <li
      className={`group relative border-b border-line last:border-b-0 ${fresh ? "row-new" : ""}`}
      style={top ? { background: "linear-gradient(90deg, #4ade5012, transparent 45%)" } : undefined}
    >
      {top && <span className="absolute inset-y-0 left-0 w-[2px] bg-flow" aria-hidden />}
      <div
        role="button"
        tabIndex={0}
        onClick={() => onOpen(r.m)}
        onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), onOpen(r.m))}
        className="grid cursor-pointer grid-cols-[28px_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 px-3 py-3 transition-colors hover:bg-row sm:px-4 xl:grid-cols-[40px_minmax(190px,1.5fr)_minmax(130px,1fr)_96px_128px_150px_minmax(140px,1.1fr)_150px]"
        aria-label={`${r.n} ($${tick(r.s)}), called at ${usd(r.c)}, peak ${multText(px)}`}
      >
        <span className="font-big text-[22px] leading-none sm:text-[26px]" style={{ color: RANK_COLOR[rank - 1] ?? "var(--dim)" }}>
          {rank}
        </span>

        {/* token */}
        <span className="flex min-w-0 items-center gap-3">
          <TokenIcon src={r.img} label={r.s || r.n} size={36} />
          <span className="min-w-0">
            <span className="flex min-w-0 items-baseline gap-2">
              <span className="truncate font-mono text-[14px] font-bold text-text">${tick(r.s)}</span>
              <span className="hidden truncate font-mono text-[10px] text-dim sm:inline">{short(r.m)}</span>
            </span>
            <span className="mt-0.5 flex min-w-0 items-center gap-2">
              <TriggerChip trigger={r.tr} small />
              <span className="truncate font-mono text-[10.5px] text-muted">
                {age(r.t, now)} ago{launchAge != null ? ` · launch+${launchAge}m` : ""}
              </span>
            </span>
          </span>
        </span>

        {/* mobile right side */}
        <span className="text-right xl:hidden">
          <span className="font-big block text-[26px] leading-none" style={{ color: peakColor(px) }}>
            {multText(px)}
          </span>
          <span className="mt-1 flex items-center justify-end gap-1.5 font-mono text-[10.5px] text-muted">
            {usd(r.c)} <span className="text-dim">→</span> {usd(r.now)} <XPill x={nx} />
          </span>
          <span className="mt-1 flex justify-end gap-1">
            <RugBadge r={r} small />
            <GemBadge r={r} />
          </span>
        </span>

        {/* score + checks */}
        <span className="hidden min-w-0 xl:block">
          <span className="flex items-center gap-2">
            <span className="h-[5px] w-[64px] overflow-hidden rounded-full bg-line">
              <span className="block h-full rounded-full bg-flow" style={{ width: `${Math.max(4, Math.min(100, r.sc))}%` }} />
            </span>
            <span className="font-mono text-[12px] tabular-nums text-text">{r.sc}</span>
          </span>
          <span className="mt-1 flex flex-wrap items-center gap-1 font-mono text-[10px]">
            <GradeChip g={r.g} tr={r.tr} />
            <RugBadge r={r} />
            <GemBadge r={r} />
            {r.sm ? <span className="text-narr">{r.sm} smart</span> : null}
            {r.cl ? <span className="text-flow">clean</span> : null}
            {r.st ? <span className="text-steel">strong</span> : null}
            {!r.sm && !r.cl && !r.st && !r.g ? <span className="text-dim">passed gate</span> : null}
          </span>
          <span className="mt-1 block font-mono text-[10px] text-muted">
            <LaunchStats r={r} />
          </span>
        </span>

        {/* called */}
        <span className="hidden font-mono text-[13px] tabular-nums text-text xl:block">{usd(r.c)}</span>

        {/* now */}
        <span className="hidden xl:block">
          <span className="block font-mono text-[14px] font-bold tabular-nums text-text">{usd(r.now)}</span>
          <span className="mt-0.5 flex items-center gap-1.5">
            <XPill x={nx} />
            <span className="font-mono text-[10px] text-dim">{age(r.chk, now)}</span>
          </span>
        </span>

        {/* peak + paper trade */}
        <span className="hidden xl:block">
          <span className="flex items-center gap-2">
            <span className="font-big text-[28px] leading-none" style={{ color: peakColor(px) }}>
              {multText(px)}
            </span>
            <PeakMeter x={px} />
          </span>
          <span className="mt-1 block">
            <PaperPill pp={r.pp} now={r.now} c={r.c} />
          </span>
        </span>

        {/* chart */}
        <span className="hidden xl:block">
          <Spark row={r} width={160} height={36} />
        </span>

        <span className="hidden items-center justify-end gap-1.5 xl:flex">
          <BuyMenu mint={r.m} />
          <StarButton on={starred} onToggle={onStar} />
          <ShareButton mint={r.m} />
        </span>
      </div>
    </li>
  );
}

function Empty({ q, range, watching, hasAny, early }: { q: string; range: Range; watching: number; hasAny: boolean; early?: boolean }) {
  if (q && hasAny) return <p className="px-4 py-10 text-center text-sm text-muted">No call matches &ldquo;{q}&rdquo; in this range.</p>;
  return (
    <div className="px-4 py-12 text-center">
      <p className="font-big text-[26px] uppercase text-dim">
        No calls {range === "24h" ? "in the last 24h" : range === "7d" ? "in 7 days" : "yet"}
      </p>
      <p className="mx-auto mt-2 max-w-md text-sm text-muted">
        {early
          ? `Watching ${watching.toLocaleString()} launches. A call in this tier lands here in the token's first 3 minutes, the moment it clears the tier's rule.`
          : `The scanner is watching ${watching.toLocaleString()} fresh launches right now. A call lands here the moment one clears every check, and stays forever.`}
      </p>
    </div>
  );
}

"use client";

import { useEffect, useState } from "react";
import type { NarrativesResponse } from "@/lib/types";
import type { Hit } from "@/lib/engine";
import { age } from "@/lib/format";

const SOURCE_NAMES: Record<string, string> = {
  trends: "Google Trends",
  news: "Google News",
  reddit: "Reddit",
  coingecko: "CoinGecko",
  gecko: "GeckoTerminal",
  dexboost: "DexScreener boosts",
  wiki: "Wikipedia",
  youtube: "YouTube",
  watchlist: "your watchlist",
};

export function NarrativeWall({
  data,
  error,
  hits,
  fresh = [],
  children,
  watchWords = [],
}: {
  data: NarrativesResponse | null;
  error: string | null;
  hits: Record<string, Hit>;
  fresh?: string[];
  children?: React.ReactNode;
  watchWords?: string[];
}) {
  const freshSet = new Set(fresh);
  const [now, setNow] = useState(() => Date.now());
  const [source, setSource] = useState<string>("all");
  const [allOnPhone, setAllOnPhone] = useState(false);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 5000);
    return () => clearInterval(t);
  }, []);

  if (!data) {
    return (
      <section className="px-5 py-10 md:px-8">
        <p className="text-muted">
          {error ? `Could not load narratives (${error}). Retrying in 3 minutes.` : "Reading today's trends..."}
        </p>
        {children}
      </section>
    );
  }

  const pool =
    source === "all"
      ? data.terms
      : source === "watchlist"
        ? watchWords.map((w) => ({
            term: w.toLowerCase().replace(/[^a-z0-9]/g, ""),
            display: w,
            weight: 6,
            sources: ["watchlist"],
            context: "Your watchlist",
          }))
        : data.terms.filter((t) => t.sources.includes(source));
  const terms = pool.slice(0, 90);
  const countFor = (id: string) => data.terms.filter((t) => t.sources.includes(id)).length;
  const watchCount = watchWords.length;
  const max = Math.log(1 + (terms[0]?.weight ?? 1));

  return (
    <section className="border-b border-line px-5 py-6 md:px-8" aria-labelledby="wall-title">
      <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="wall-title" className="font-display text-lg font-bold">
          What people are talking about
        </h2>
        <p className="text-xs text-muted">
          {data.terms.length} narratives, refreshed {age(data.updatedAt, now)} ago. Pink means a new token just
          launched on it. Underlined terms just started trending.
        </p>
      </div>

      {terms.length === 0 ? (
        <p className="text-muted">
          {source === "all" ? "No sources returned data. Check the source list below." : "No narratives from this source right now."}
        </p>
      ) : (
        <ul className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
          {terms.map((t, idx) => {
            const size = 13 + (Math.log(1 + t.weight) / max) * 20;
            const hit = hits[t.term];
            const hot = hit && now - hit.at < 5 * 60_000;
            return (
              // On phones only the top 24 show until expanded, so the signals are not pushed far down.
              <li key={t.term} className={idx >= 24 && !allOnPhone ? "max-md:hidden" : undefined}>
                <span
                  key={hot ? hit.at : "idle"}
                  title={`${t.context}\nSources: ${t.sources.map((s) => SOURCE_NAMES[s] ?? s).join(", ")}`}
                  className={`font-display font-bold leading-tight ${hot ? "term-hit" : ""} ${
                    freshSet.has(t.term) ? "underline decoration-flow decoration-2 underline-offset-4" : ""
                  }`}
                  style={{ fontSize: `${size}px`, color: hot ? undefined : `rgba(238,234,246,${0.35 + (size - 13) / 32})` }}
                >
                  {t.display}
                </span>
                {hit && (
                  <sup className="ml-0.5 text-[10px] font-semibold text-narr" aria-label={`${hit.count} launches`}>
                    {hit.count}
                  </sup>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {terms.length > 24 && !allOnPhone && (
        <button type="button" onClick={() => setAllOnPhone(true)} className="mt-2 text-sm text-muted underline underline-offset-4 md:hidden">
          Show all {terms.length}
        </button>
      )}

      <div role="group" aria-label="Filter narratives by source" className="mt-5 flex flex-wrap gap-2 text-xs">
        <SourceChip active={source === "all"} onClick={() => setSource("all")} label="All" count={data.terms.length} />
        {data.sources.map((s) =>
          s.ok ? (
            <SourceChip
              key={s.id}
              active={source === s.id}
              onClick={() => setSource(source === s.id ? "all" : s.id)}
              label={s.label}
              count={countFor(s.id)}
            />
          ) : (
            <span
              key={s.id}
              title={s.error ? `Unavailable: ${s.error}` : "Unavailable right now"}
              className="cursor-not-allowed rounded-full border border-warn/40 px-2.5 py-1 text-warn opacity-70"
            >
              {s.label} unavailable
            </span>
          )
        )}
        {watchCount > 0 && (
          <SourceChip
            active={source === "watchlist"}
            onClick={() => setSource(source === "watchlist" ? "all" : "watchlist")}
            label="Your watchlist"
            count={watchCount}
          />
        )}
      </div>
      {children}
    </section>
  );
}

function SourceChip({
  active,
  onClick,
  label,
  count,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  count: number;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`rounded-full border px-2.5 py-1 transition-colors ${
        active ? "border-text bg-text text-ink" : "border-line text-muted hover:border-muted hover:text-text"
      }`}
    >
      {label} ({count})
    </button>
  );
}

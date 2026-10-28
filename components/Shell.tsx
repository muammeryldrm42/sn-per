"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { EngineStats, Signal } from "@/lib/types";
import type { CallRow } from "@/lib/archive";
import { short } from "@/lib/format";
import { Logo, multText, tick, TokenIcon } from "./ui";
import { Notices } from "./Notices";
import { TIERS } from "@/lib/tiers";

export type ViewName = "calls" | "conservative" | "risky" | "ultra" | "archive" | "live" | "traders" | "record" | "lab" | "method" | "smart" | "trending" | "token";

interface NavItem {
  id: ViewName;
  label: string;
  badge?: string | number;
  dot?: boolean;
  icon: React.ReactNode;
}

const ic = { width: 16, height: 16, viewBox: "0 0 16 16", fill: "none", stroke: "currentColor", strokeWidth: 1.5, "aria-hidden": true } as const;
export const ICONS: Record<string, React.ReactNode> = {
  calls: (
    <svg {...ic}>
      <path d="M2 8h1.5M5 5v6M8 3v10M11 6v4M14 8h-1" strokeLinecap="round" />
    </svg>
  ),
  fresh: (
    <svg {...ic}>
      <path d="M9 1.5L3.5 9h4l-1 5.5L12 7H8z" strokeLinejoin="round" />
    </svg>
  ),
  live: (
    <svg {...ic}>
      <circle cx="8" cy="8" r="2" />
      <path d="M4.5 4.5a5 5 0 000 7M11.5 4.5a5 5 0 010 7M2.5 2.5a8 8 0 000 11M13.5 2.5a8 8 0 010 11" strokeLinecap="round" />
    </svg>
  ),
  traders: (
    <svg {...ic}>
      <circle cx="5.5" cy="5.5" r="2.2" />
      <circle cx="11" cy="6.5" r="1.8" />
      <path d="M1.8 13c.5-2.4 2-3.6 3.7-3.6s3.2 1.2 3.7 3.6M9.6 10.2c.4-.3.9-.5 1.4-.5 1.4 0 2.6 1 3 3" strokeLinecap="round" />
    </svg>
  ),
  trending: (
    <svg {...ic}>
      <path d="M2 12l4-4 3 3 5-6M10 5h4v4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  record: (
    <svg {...ic}>
      <path d="M3 13V8M8 13V3M13 13V6" strokeLinecap="round" />
    </svg>
  ),
  smart: (
    <svg {...ic}>
      <path d="M2 5.5h12v7H2zM2 5.5l1.5-2.5h9L14 5.5M10.5 9h1.5" strokeLinejoin="round" />
    </svg>
  ),
  lab: (
    <svg {...ic}>
      <path d="M6 2h4M6.5 2v4.5L3 13a1 1 0 00.9 1.5h8.2A1 1 0 0013 13L9.5 6.5V2M5 10h6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  method: (
    <svg {...ic}>
      <circle cx="8" cy="8" r="6" />
      <path d="M8 7.2V11M8 5v.2" strokeLinecap="round" />
    </svg>
  ),
  archive: (
    <svg {...ic}>
      <path d="M2 3h12v3H2zM3 6v7h10V6M6.5 9h3" strokeLinejoin="round" />
    </svg>
  ),
};

export function Shell({
  view,
  go,
  stats,
  calls,
  early = [],
  signals,
  watching,
  solUsd,
  remote,
  link,
  workerError,
  alerts,
  query,
  setQuery,
  onOpen,
  children,
}: {
  view: ViewName;
  go: (v: ViewName) => void;
  stats: EngineStats;
  calls: CallRow[];
  early?: CallRow[];
  signals: Signal[];
  watching: number;
  solUsd: number | null;
  remote: boolean;
  link?: string;
  workerError: string | null;
  alerts: { enabled: boolean; toggle: () => void; permission: string };
  query: string;
  setQuery: (q: string) => void;
  onOpen: (mint: string) => void;
  children: React.ReactNode;
}) {
  const now = Date.now();
  const calls24 = calls.filter((r) => now - r.t < 24 * 3600_000).length;
  const onRadar = signals.filter((s) => s.promotedAt && !s.calledAt && now - s.promotedAt < 60 * 60_000).length;

  void early;
  const dot = (c: string) => (
    <span className="flex h-4 w-4 items-center justify-center" aria-hidden>
      <span className="block h-2 w-2 rounded-full" style={{ background: c, boxShadow: `0 0 6px ${c}` }} />
    </span>
  );
  // Feeds, like Gem Bot's: the same scanner, four levels of risk, each with its own list and track record.
  const feeds: NavItem[] = TIERS.map((t) => ({
    id: t.id === "balanced" ? "calls" : (t.id as ViewName),
    label: t.label,
    badge: t.id === "balanced" ? calls24 : t.id === "conservative" ? calls.filter((r) => r.g === "solid" && now - r.t < 24 * 3600_000).length || undefined : undefined,
    icon: dot(t.color),
  }));
  const market: NavItem[] = [
    { id: "live", label: "Live radar", badge: onRadar, dot: stats.ws === "open", icon: ICONS.live },
    { id: "traders", label: "Traders", icon: ICONS.traders },
    { id: "trending", label: "Trending pools", icon: ICONS.trending },
  ];
  const statsNav: NavItem[] = [
    { id: "record", label: "Track record", icon: ICONS.record },
    { id: "lab", label: "Public lab", icon: ICONS.lab },
    { id: "method", label: "How it works", icon: ICONS.method },
    { id: "smart", label: "Smart wallets", icon: ICONS.smart },
    { id: "archive", label: "Call archive", badge: calls.length || undefined, icon: ICONS.archive },
  ];
  const crumb = view === "token" ? "token" : [...feeds, ...market, ...statsNav].find((n) => n.id === view)?.label.toLowerCase() ?? view;

  return (
    <div className="grain min-h-screen">
      {/* sidebar */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-[232px] flex-col border-r border-line bg-panel lg:flex">
        <div className="flex h-[52px] items-center border-b border-line px-4">
          <button type="button" onClick={() => go("calls")} aria-label="Talons home">
            <Logo />
          </button>
        </div>
        <nav className="scroll-thin flex-1 overflow-y-auto px-2.5 py-3" aria-label="Main">
          <NavGroup title="Calls" items={feeds} view={view} go={go} />
          <NavGroup title="Market" items={market} view={view} go={go} />
          <NavGroup title="Stats" items={statsNav} view={view} go={go} />
        </nav>
        <div className="space-y-2 border-t border-line p-3">
          <div className="rounded-lg border border-flow/25 bg-flow/[0.06] p-3">
            <p className="font-mono text-[10px] font-bold uppercase tracking-[0.14em] text-flow">Free, no pack</p>
            <p className="mt-1 text-[12px] leading-snug text-muted">Every call is free and the same for everyone. Nothing is paywalled, nothing is deleted.</p>
          </div>
          <a
            href="https://jup.ag"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center justify-between rounded-lg px-2 py-1.5 font-mono text-[10px] uppercase tracking-[0.14em] text-dim hover:text-text"
          >
            Trade on Jupiter <span aria-hidden>↗</span>
          </a>
        </div>
      </aside>

      <div className="lg:pl-[232px]">
        {/* top bar */}
        <header className="sticky top-0 z-20 border-b border-line bg-[#08090ce6] backdrop-blur">
          <div className="flex h-[52px] items-center gap-3 px-4 md:px-6">
            <button type="button" onClick={() => go("calls")} className="lg:hidden" aria-label="Talons home">
              <Logo compact />
            </button>
            <p className="hidden shrink-0 font-mono text-[12px] text-dim sm:block">
              talons <span className="mx-1">/</span> <span className="text-text">{crumb}</span>
            </p>
            <Search calls={calls} signals={signals} query={query} setQuery={setQuery} onOpen={onOpen} />
            <div className="ml-auto flex shrink-0 items-center gap-2">
              <span className="hidden rounded-md border border-line px-2 py-1 font-mono text-[11px] text-muted md:inline">
                SOL {solUsd ? `$${solUsd.toFixed(2)}` : "-"}
              </span>
              <Notices calls={calls} alerts={alerts} onOpen={onOpen} />
            </div>
          </div>
          {workerError && (
            <p role="status" className="border-t border-warn/30 bg-warn/10 px-4 py-1.5 font-mono text-[11px] text-warn md:px-6">
              Cannot reach the signal server ({workerError}). Retrying.
            </p>
          )}
        </header>

        <main className="mx-auto max-w-[1400px] px-4 pb-28 md:px-6 lg:pb-14">{children}</main>
      </div>

      <StatusBar stats={stats} calls24={calls24} watching={watching} onRadar={onRadar} remote={remote} link={link} workerError={workerError} />
      <TabBar view={view} go={go} />
    </div>
  );
}

function NavGroup({ title, items, view, go }: { title: string; items: NavItem[]; view: ViewName; go: (v: ViewName) => void }) {
  return (
    <div className="mb-4">
      <p className="label mb-1.5 px-2 !text-[10px] !text-dim">{title}</p>
      <ul className="space-y-0.5">
        {items.map((n) => {
          const on = view === n.id;
          return (
            <li key={n.id}>
              <button
                type="button"
                onClick={() => go(n.id)}
                aria-current={on ? "page" : undefined}
                className={`relative flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-[13.5px] transition-colors ${
                  on ? "bg-flow/[0.09] text-text" : "text-muted hover:bg-raise hover:text-text"
                }`}
              >
                {on && <span className="absolute -left-2.5 top-1.5 h-[calc(100%-12px)] w-[3px] rounded-r bg-flow" aria-hidden />}
                <span className={on ? "text-flow" : ""}>{n.icon}</span>
                <span className="flex-1 text-left">{n.label}</span>
                {n.dot && <span className="pulse h-1.5 w-1.5 rounded-full bg-flow" aria-hidden />}
                {n.badge != null && n.badge !== 0 && (
                  <span className={`rounded px-1.5 font-mono text-[10.5px] ${on ? "bg-flow text-[#06210a]" : "bg-raise text-muted"}`}>{n.badge}</span>
                )}
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function Search({
  calls,
  signals,
  query,
  setQuery,
  onOpen,
}: {
  calls: CallRow[];
  signals: Signal[];
  query: string;
  setQuery: (q: string) => void;
  onOpen: (mint: string) => void;
}) {
  const [focus, setFocus] = useState(false);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      if ((e.key === "/" || (e.key === "k" && (e.metaKey || e.ctrlKey))) && document.activeElement?.tagName !== "INPUT") {
        e.preventDefault();
        ref.current?.focus();
      }
    };
    window.addEventListener("keydown", on);
    return () => window.removeEventListener("keydown", on);
  }, []);

  const q = query.trim().toLowerCase().replace(/^\$/, "");
  const results = useMemo(() => {
    if (!q) return [];
    const out: { mint: string; sym: string; name: string; img?: string; x?: number; tag: string }[] = [];
    const seen = new Set<string>();
    for (const r of calls) {
      if (out.length >= 8) break;
      if (r.s.toLowerCase().includes(q) || r.n.toLowerCase().includes(q) || r.m.toLowerCase() === q) {
        out.push({ mint: r.m, sym: r.s, name: r.n, img: r.img, x: r.pk / r.c, tag: "call" });
        seen.add(r.m);
      }
    }
    for (const s of signals) {
      if (out.length >= 8) break;
      if (seen.has(s.mint)) continue;
      if (s.symbol.toLowerCase().includes(q) || s.name.toLowerCase().includes(q) || s.mint.toLowerCase() === q) {
        out.push({ mint: s.mint, sym: s.symbol, name: s.name, img: s.image, tag: s.promotedAt ? "radar" : "watching" });
      }
    }
    return out;
  }, [q, calls, signals]);
  const isMint = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(query.trim());

  return (
    <div className="relative min-w-0 flex-1 md:max-w-[460px]">
      <label className="flex h-9 items-center gap-2 rounded-md border border-line bg-panel px-3 focus-within:border-flow/50">
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" className="shrink-0 text-dim" aria-hidden>
          <circle cx="6" cy="6" r="4.2" />
          <path d="M9.2 9.2L12.5 12.5" strokeLinecap="round" />
        </svg>
        <span className="sr-only">Search calls and radar</span>
        <input
          ref={ref}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => setFocus(true)}
          onBlur={() => setTimeout(() => setFocus(false), 150)}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              setQuery("");
              ref.current?.blur();
            }
            if (e.key === "Enter") {
              const m = isMint ? query.trim() : results[0]?.mint;
              if (m) {
                onOpen(m);
                setQuery("");
                ref.current?.blur();
              }
            }
          }}
          placeholder="Ticker, name or mint"
          className="min-w-0 flex-1 bg-transparent font-mono text-[12.5px] text-text placeholder:text-dim focus:outline-none"
          style={{ outline: "none" }}
        />
        <kbd className="hidden rounded border border-line px-1.5 font-mono text-[10px] text-dim sm:inline">/</kbd>
      </label>
      {focus && q && (
        <div className="card absolute left-0 right-0 top-[42px] z-40 overflow-hidden shadow-[0_16px_48px_-12px_#000000e6]">
          {results.length === 0 ? (
            <p className="px-3 py-3 font-mono text-[11.5px] text-muted">
              {isMint ? "Press Enter to open this mint." : "No call or radar token matches. The list below is filtered too."}
            </p>
          ) : (
            <ul>
              {results.map((r) => (
                <li key={r.mint}>
                  <button
                    type="button"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => {
                      onOpen(r.mint);
                      setQuery("");
                      ref.current?.blur();
                    }}
                    className="flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-row"
                  >
                    <TokenIcon src={r.img} label={r.sym} size={24} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-mono text-[12.5px] font-bold">${tick(r.sym)}</span>
                      <span className="block truncate font-mono text-[10px] text-dim">
                        {r.name} · {short(r.mint)}
                      </span>
                    </span>
                    <span className="font-mono text-[10px] uppercase text-muted">{r.tag}</span>
                    {r.x != null && <span className="font-mono text-[11px] text-flow">{multText(r.x)}</span>}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

function StatusBar({
  stats,
  calls24,
  watching,
  onRadar,
  remote,
  link,
  workerError,
}: {
  stats: EngineStats;
  calls24: number;
  watching: number;
  onRadar: number;
  remote: boolean;
  link?: string;
  workerError: string | null;
}) {
  const [clock, setClock] = useState("");
  useEffect(() => {
    const tick = () => setClock(new Date().toISOString().slice(11, 19));
    tick();
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, []);
  const live = stats.ws === "open" && !workerError;
  return (
    <footer className="fixed bottom-0 left-[232px] right-0 z-20 hidden h-7 items-center gap-4 border-t border-line bg-panel pr-4 font-mono text-[11px] lg:flex">
      <span className={`flex h-full items-center px-3 font-bold tracking-wider ${live ? "bg-flow text-[#06210a]" : "bg-warn/80 text-[#2a0710]"}`}>
        {live ? "LIVE" : stats.ws === "connecting" ? "CONNECTING" : "RECONNECTING"}
      </span>
      <span className="text-muted">
        launches/min <span className="text-text">{stats.perMin}</span>
      </span>
      <span className="text-muted">
        watching <span className="text-text">{watching.toLocaleString()}</span>
      </span>
      <span className="text-muted">
        radar <span className="text-text">{onRadar}</span>
      </span>
      <span className="text-muted">
        calls 24h <span className="text-flow">{calls24}</span>
      </span>
      <span className={live ? "text-flow" : "text-warn"} title={link === "poll" ? "Live push unavailable, refreshing every few seconds" : undefined}>
        {!live ? "waiting" : link === "stream" ? "live push" : link === "poll" ? "polling" : "streaming"}
      </span>
      <span className="text-dim">{remote ? "shared scanner" : "scanning in this tab"}</span>
      <span className="ml-auto text-dim">UTC {clock}</span>
    </footer>
  );
}

function TabBar({ view, go }: { view: ViewName; go: (v: ViewName) => void }) {
  const items: { id: ViewName; label: string }[] = [
    { id: "calls", label: "Calls" },
    { id: "live", label: "Radar" },
    { id: "traders", label: "Traders" },
    { id: "record", label: "Record" },
    { id: "trending", label: "Trending" },
  ];
  return (
    <nav
      aria-label="Main"
      className="fixed inset-x-2 bottom-2 z-30 grid grid-cols-5 rounded-xl border border-line bg-[#0d0e12f2] p-1 shadow-[0_16px_48px_-12px_#000000e6] backdrop-blur lg:hidden"
      style={{ paddingBottom: "max(4px, env(safe-area-inset-bottom))" }}
    >
      {items.map((t) => {
        const on = view === t.id || (t.id === "calls" && ["archive", "conservative", "risky", "ultra"].includes(view));
        return (
          <button
            key={t.id}
            type="button"
            onClick={() => go(t.id)}
            aria-current={on ? "page" : undefined}
            className={`flex flex-col items-center gap-0.5 rounded-lg py-1.5 text-[10.5px] ${on ? "bg-flow/10 text-flow" : "text-muted"}`}
          >
            {ICONS[t.id]}
            {t.label}
          </button>
        );
      })}
    </nav>
  );
}


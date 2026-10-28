"use client";

import { useMemo, useState } from "react";
import type { Signal, EngineStats } from "@/lib/types";
import type { CallRow } from "@/lib/archive";
import { age, perf, usd } from "@/lib/format";
import { tick, multText, PageTitle, peakColor, StatPill, TokenIcon, TriggerChip, XPill } from "./ui";
import { useTraders } from "./TradersView";

interface Move {
  key: string;
  t: number;
  mint: string;
  sym: string;
  img?: string;
  kind: "called" | "hit" | "radar" | "trader" | "fresh";
  text: string;
  x?: number;
  trigger?: string;
}

const STEPS = [2, 3, 5, 10, 25, 50, 100];

// Everything that happened, newest first: calls, multiples reached after a call, tokens reaching the radar.
function buildMoves(calls: CallRow[], signals: Signal[], now: number): Move[] {
  const out: Move[] = [];
  for (const r of calls) {
    out.push({ key: `c${r.m}`, t: r.t, mint: r.m, sym: r.s, img: r.img, kind: "called", text: `at ${usd(r.c)}`, trigger: r.tr });
    for (const k of STEPS) {
      const p = r.h?.find((pt) => pt[1] >= r.c * k);
      if (!p) break;
      out.push({ key: `h${r.m}${k}`, t: r.t + p[0] * 60_000, mint: r.m, sym: r.s, img: r.img, kind: "hit", text: `${k}x since call`, x: k });
    }
  }
  for (const s of signals) {
    if (s.earlyAt) out.push({ key: `f${s.mint}`, t: s.earlyAt, mint: s.mint, sym: s.symbol, img: s.image, kind: "fresh", text: `at ${usd(s.earlyMcapUsd ?? 0)}`, trigger: "fresh" });
    if (!s.promotedAt || s.calledAt) continue;
    out.push({ key: `r${s.mint}`, t: s.promotedAt, mint: s.mint, sym: s.symbol, img: s.image, kind: "radar", text: `${Math.max(0, Math.round((s.promotedAt - s.createdAt) / 60_000))}m after launch`, trigger: s.trigger });
  }
  return out.filter((m) => m.t <= now + 60_000).sort((a, b) => b.t - a.t).slice(0, 40);
}

export function LiveView({
  calls,
  signals,
  stats,
  watching,
  now,
  query,
  onOpen,
  remoteUrl,
  solUsd,
}: {
  calls: CallRow[];
  signals: Signal[];
  stats: EngineStats;
  watching: number;
  now: number;
  query: string;
  onOpen: (mint: string) => void;
  remoteUrl?: string;
  solUsd?: number | null;
}) {
  const day = calls.filter((r) => now - r.t < 24 * 3600_000);
  const traders = useTraders(remoteUrl).data;
  const moves = useMemo(() => {
    const base = buildMoves(calls, signals, now);
    // KOL and smart wallet buys join the feed (free transfers stay out).
    const tm: Move[] = (traders?.moves ?? [])
      .filter((m) => m.k === "buy" && !m.xfer)
      .slice(0, 40)
      .map((m, i) => {
        const amt = m.usd ?? (solUsd && m.sol > 0 ? m.sol * solUsd : 0);
        return {
          key: `t${m.sig ?? i}${m.w}${m.m}`,
          t: m.t,
          mint: m.m,
          sym: m.tok?.s ?? `${m.m.slice(0, 4)}...`,
          img: m.tok?.img,
          kind: "trader" as const,
          text: `${m.who.name}${amt ? ` · ${usd(amt)}` : ""}${m.via === "fomo" ? " · via Fomo" : ""}`,
        };
      });
    return [...base, ...tm].sort((a, b) => b.t - a.t).slice(0, 50);
  }, [calls, signals, now, traders, solUsd]);
  const topToday = [...day].sort((a, b) => b.pk / b.c - a.pk / a.c).slice(0, 6);
  const latest = day[0] ?? calls[0];
  const q = query.trim().toLowerCase().replace(/^\$/, "");
  const [showAll, setShowAll] = useState(false);
  const inWindow = (s: Signal) => !!s.calledAt || (now - (s.promotedAt ?? s.createdAt) < 60 * 60_000 && !s.junk);
  const radarAll = signals.filter((s) => s.promotedAt);
  const hiddenCount = radarAll.filter((s) => !inWindow(s)).length;
  const radar = radarAll
    .filter((s) => showAll || inWindow(s))
    .filter((s) => !q || s.symbol.toLowerCase().includes(q) || s.name.toLowerCase().includes(q) || s.mint.toLowerCase() === q)
    .sort((a, b) => (b.calledAt ?? 0) - (a.calledAt ?? 0) || (b.promotedAt ?? 0) - (a.promotedAt ?? 0));
  const onRadar = signals.filter((s) => s.promotedAt && !s.calledAt && now - s.promotedAt < 60 * 60_000).length;

  return (
    <div>
      <PageTitle dim="Radar" bright="Live">
        <StatPill
          items={[
            { value: String(stats.perMin), label: "Launches / min" },
            { value: watching.toLocaleString(), label: "Watching" },
            { value: String(onRadar), label: "On radar" },
          ]}
        />
      </PageTitle>
      <p className="-mt-2 mb-5 max-w-3xl text-sm text-muted">
        Every new launch is watched for its first 45 minutes. The ones that start moving (buy pressure, a fast bonding curve, smart wallets,
        graduation, a paid DEX profile) reach the radar and get the full check: wallet cohorts, dev history, RugCheck, holders. A radar token
        becomes a call only once it proves itself (graduated, a 5x run that holds, or 2+ independent smart wallets or KOLs buying into real volume) and passes the health checks:
        dev still in, buyers outnumber sellers, price not falling, no rug signs. Nothing is called in its first 3 minutes (where most rugs
        die), and fast movers only after the bundle check.
      </p>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
        <section className="min-w-0">
          <div className="mb-2 flex items-baseline justify-between">
            <h2 className="label">Latest moves</h2>
            <span className="font-mono text-[10px] text-dim">calls · multiples · radar</span>
          </div>
          <div className="card overflow-hidden">
            {moves.length === 0 ? (
              <p className="px-4 py-8 text-center text-sm text-muted">Nothing yet. Moves show up here as the scanner finds them.</p>
            ) : (
              <ul className="scroll-thin max-h-[440px] overflow-y-auto">
                {moves.map((m) => (
                  <li key={m.key} className="border-b border-line last:border-b-0">
                    <button
                      type="button"
                      onClick={() => onOpen(m.mint)}
                      className="flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-row"
                    >
                      <TokenIcon src={m.img} label={m.sym} size={30} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-mono text-[13px] font-bold">${tick(m.sym)}</span>
                        <span className="block truncate font-mono text-[11px]">
                          <span className={m.kind === "called" ? "text-narr" : m.kind === "hit" ? "text-flow" : m.kind === "trader" ? "text-violet" : m.kind === "fresh" ? "text-[#ff9f43]" : "text-steel"}>
                            {m.kind === "called" ? "called" : m.kind === "hit" ? "hit" : m.kind === "trader" ? "KOL buy" : m.kind === "fresh" ? "risky call" : "on radar"}
                          </span>{" "}
                          <span className="text-muted">{m.text}</span>
                        </span>
                      </span>
                      {m.trigger && <TriggerChip trigger={m.trigger} small />}
                      <span className="w-10 text-right font-mono text-[10.5px] text-dim">{age(m.t, now)}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>

        <aside className="space-y-5">
          <section>
            <h2 className="label mb-2">Right now</h2>
            <div className="grid grid-cols-2 gap-2">
              <Tile label="Calls 24h" value={String(day.length)} />
              <Tile
                label="Top call today"
                value={topToday[0] ? multText(topToday[0].pk / topToday[0].c) : "-"}
                sub={topToday[0] ? `$${tick(topToday[0].s)}` : "no call yet"}
                tone={topToday[0] && topToday[0].pk / topToday[0].c >= 2 ? "up" : undefined}
                onClick={topToday[0] ? () => onOpen(topToday[0].m) : undefined}
              />
              <Tile
                label="Latest call"
                value={latest ? `$${tick(latest.s)}` : "-"}
                sub={latest ? `${age(latest.t, now)} ago at ${usd(latest.c)}` : "waiting"}
                small
                onClick={latest ? () => onOpen(latest.m) : undefined}
              />
              <Tile label="Scanned" value={stats.seen.toLocaleString()} sub="launches this session" small />
            </div>
          </section>
          <section>
            <h2 className="label mb-2">Top calls today</h2>
            <div className="card overflow-hidden">
              {topToday.length === 0 ? (
                <p className="px-4 py-6 text-center text-sm text-muted">No call has run yet today.</p>
              ) : (
                <ol>
                  {topToday.map((r, i) => (
                    <li key={r.m} className="border-b border-line last:border-b-0">
                      <button type="button" onClick={() => onOpen(r.m)} className="flex w-full items-center gap-3 px-4 py-2.5 text-left hover:bg-row">
                        <span className="w-4 font-mono text-[11px] text-dim">{i + 1}</span>
                        <TokenIcon src={r.img} label={r.s} size={28} />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate font-mono text-[13px] font-bold">${tick(r.s)}</span>
                          <span className="block font-mono text-[10.5px] text-muted">at {usd(r.c)}</span>
                        </span>
                        <span className="font-big text-[22px]" style={{ color: peakColor(r.pk / r.c) }}>
                          {multText(r.pk / r.c)}
                        </span>
                      </button>
                    </li>
                  ))}
                </ol>
              )}
            </div>
          </section>
        </aside>
      </div>

      <section className="mt-6">
        <div className="mb-2 flex items-baseline justify-between">
          <h2 className="label">On the radar</h2>
          <span className="flex items-center gap-3 font-mono text-[10px] text-dim">
            <span className="hidden sm:inline">what each token still needs before a call</span>
            {hiddenCount > 0 && (
              <button type="button" onClick={() => setShowAll((v) => !v)} className="rounded border border-line px-2 py-0.5 uppercase tracking-wider text-muted hover:text-text">
                {showAll ? "Hide dropped" : `Show ${hiddenCount} dropped`}
              </button>
            )}
          </span>
        </div>
        <div className="card overflow-hidden">
          {radar.length === 0 ? (
            <p className="px-4 py-8 text-center text-sm text-muted">
              {q ? `Nothing on the radar matches "${query}".` : "Nothing on the radar yet. Tokens appear here the moment they start moving."}
            </p>
          ) : (
            <>
              <div className="label hidden grid-cols-[minmax(180px,1.4fr)_70px_110px_110px_90px_70px_minmax(160px,1.3fr)] gap-3 border-b border-line px-4 py-2 !text-[10px] lg:grid" aria-hidden>
                <span>Token · trigger</span>
                <span>Age</span>
                <span>Mcap</span>
                <span>Buys / sells 5m</span>
                <span>Curve</span>
                <span>Score</span>
                <span>Status</span>
              </div>
              <ul>
                {radar.slice(0, 80).map((s) => (
                  <RadarLine key={s.mint} s={s} now={now} onOpen={onOpen} />
                ))}
              </ul>
            </>
          )}
        </div>
      </section>
    </div>
  );
}

const PENDING = /not read yet|not in yet/;
function blockerText(b: string) {
  if (b === "wallets not read yet") return "wallet read";
  if (b === "RugCheck not in yet") return "RugCheck report";
  if (b.startsWith("no strong evidence")) return "stronger buying";
  if (b.startsWith("needs a proof")) return "proof: graduation, 5x run or 2+ smart wallets/KOLs";
  if (b.startsWith("too new")) return "age check: 3 min since launch (rug zone)";
  if (b.startsWith("just graduated")) return "holding on the pool after graduation";
  if (b.startsWith("instant graduation")) return "bundle check (instant graduation)";
  if (b.startsWith("fast mover")) return "bundle check (fast mover)";
  return b;
}

function RadarLine({ s, now, onOpen }: { s: Signal; now: number; onOpen: (m: string) => void }) {
  const p = perf(s);
  const blockers = s.callBlockers ?? [];
  const expired = !s.calledAt && now - (s.promotedAt ?? s.createdAt) > 60 * 60_000;
  return (
    <li className="border-b border-line last:border-b-0">
      <button
        type="button"
        onClick={() => onOpen(s.mint)}
        className="grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 px-4 py-2.5 text-left transition-colors hover:bg-row lg:grid-cols-[minmax(180px,1.4fr)_70px_110px_110px_90px_70px_minmax(160px,1.3fr)]"
      >
        <span className="flex min-w-0 items-center gap-3">
          <TokenIcon src={s.image} label={s.symbol} size={30} />
          <span className="min-w-0">
            <span className="block truncate font-mono text-[13px] font-bold">${tick(s.symbol)}</span>
            <span className="mt-0.5 flex items-center gap-2">
              <TriggerChip trigger={s.trigger} small />
              <span className="font-mono text-[10.5px] text-muted lg:hidden">{age(s.createdAt, now)}</span>
            </span>
          </span>
        </span>
        <span className="hidden font-mono text-[12px] text-muted lg:block">{age(s.createdAt, now)}</span>
        <span className="text-right lg:text-left">
          <span className="block font-mono text-[13px] tabular-nums">{usd(s.fdvUsd)}</span>
          {p && (
            <span className="mt-0.5 inline-block">
              <XPill x={p.now} />
            </span>
          )}
        </span>
        <span className="hidden font-mono text-[12px] tabular-nums lg:block">
          <span className="text-flow">{s.m5Buys ?? "-"}</span> / <span className="text-warn">{s.m5Sells ?? "-"}</span>
        </span>
        <span className="hidden lg:block">
          {s.curvePct != null ? (
            <>
              <span className="block font-mono text-[11px] text-muted">{s.graduated ? "graduated" : `${Math.round(s.curvePct)}%`}</span>
              <span className="mt-1 block h-[3px] w-16 overflow-hidden rounded bg-line">
                <span className="block h-full bg-steel" style={{ width: `${Math.min(100, s.curvePct)}%` }} />
              </span>
            </>
          ) : (
            <span className="font-mono text-[11px] text-dim">-</span>
          )}
        </span>
        <span className="hidden font-mono text-[13px] tabular-nums lg:block">{s.score}</span>
        <span className="col-span-2 min-w-0 font-mono text-[11px] lg:col-span-1">
          {s.calledAt ? (
            <span className="rounded bg-flow/15 px-1.5 py-0.5 font-bold text-flow">CALLED {age(s.calledAt, now)} ago</span>
          ) : s.earlyAt && now - s.earlyAt < 30 * 60_000 ? (
            <span className="rounded bg-[#ff9f43]/15 px-1.5 py-0.5 font-bold text-[#ff9f43]">RISKY CALL {age(s.earlyAt, now)} ago</span>
          ) : s.ultraAt && now - s.ultraAt < 30 * 60_000 ? (
            <span className="rounded bg-[#b07cff]/15 px-1.5 py-0.5 font-bold text-[#b07cff]">ULTRA CALL {age(s.ultraAt, now)} ago</span>
          ) : expired ? (
            <span className="text-dim">window closed, not called</span>
          ) : s.junk ? (
            <span className="text-warn">dropped: {s.rugLikely ? "rug signs" : s.devSold ? "dev sold" : s.dumpedFromPeak ? "dumped" : "failed checks"}</span>
          ) : blockers.length ? (
            <span className="block truncate text-muted" title={blockers.join(", ")}>
              <span className={PENDING.test(blockers[0]) ? "text-steel" : "text-narr"}>{PENDING.test(blockers[0]) ? "waiting" : "needs"}</span>{" "}
              {blockerText(blockers[0])}
              {blockers.length > 1 ? <span className="text-dim"> +{blockers.length - 1}</span> : null}
            </span>
          ) : (
            <span className="text-muted">checking...</span>
          )}
        </span>
      </button>
    </li>
  );
}

function Tile({
  label,
  value,
  sub,
  tone,
  small,
  onClick,
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: "up";
  small?: boolean;
  onClick?: () => void;
}) {
  const Inner = (
    <>
      <span className="label block !text-[9.5px]">{label}</span>
      <span
        className={`font-big mt-1 block truncate leading-none ${small ? "text-[20px]" : "text-[28px]"}`}
        style={{ color: tone === "up" ? "var(--flow)" : "var(--text)" }}
      >
        {value}
      </span>
      {sub && <span className="mt-1 block truncate font-mono text-[10.5px] text-muted">{sub}</span>}
    </>
  );
  return onClick ? (
    <button type="button" onClick={onClick} className="card block p-3 text-left transition-colors hover:border-flow/40">
      {Inner}
    </button>
  ) : (
    <div className="card p-3">{Inner}</div>
  );
}

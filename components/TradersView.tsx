"use client";

import { useEffect, useState } from "react";
import { age, short, usd } from "@/lib/format";
import { PageTitle, StatPill, tick, TokenIcon } from "./ui";

interface Who {
  name: string;
  src: "kol" | "smart";
  x?: string;
  pnl?: number;
}
interface Tok {
  s?: string;
  n?: string;
  img?: string;
  fdv?: number;
}
export interface TraderMove {
  t: number;
  w: string;
  k: "buy" | "sell";
  m: string;
  sol: number;
  mc?: number;
  sig?: string;
  via?: "fomo";
  xfer?: true;
  usd?: number;
  who: Who;
  tok: Tok | null;
}
interface Buzz extends Tok {
  mint: string;
  buyers: number;
  buys: number;
  sells: number;
  sol: number;
  per: number[];
  last: number;
  names: string[];
}
interface Person extends Who {
  w: string;
  buys: number;
  sells: number;
  sol: number;
  last: number;
  lastMint: string;
  lastK: string;
  tok: Tok | null;
}
interface TradersState {
  mode: "pumpportal" | "rpc";
  moves: TraderMove[];
  buzz: Buzz[];
  people: Person[];
  stats: { tracked: number; moves: number; kols: { kols: number; updatedAt: number; error: string | null } };
}

export function useTraders(remoteUrl?: string, mint?: string) {
  const [data, setData] = useState<TradersState | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!remoteUrl) return;
    let alive = true;
    const load = async () => {
      try {
        const r = await fetch(`${remoteUrl.replace(/\/$/, "")}/traders${mint ? `?mint=${mint}` : ""}`, { cache: "no-store" });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const j = (await r.json()) as TradersState;
        if (alive) {
          setData(j);
          setError(null);
        }
      } catch (e) {
        if (alive) setError((e as Error).message);
      }
    };
    load();
    const t = setInterval(load, mint ? 20_000 : 8_000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [remoteUrl, mint]);
  return { data, error };
}

export function TradersView({ remoteUrl, solUsd, now, onOpen }: { remoteUrl?: string; solUsd: number | null; now: number; onOpen: (m: string) => void }) {
  const { data, error } = useTraders(remoteUrl);
  const [showX, setShowX] = useState(false);
  const moves1h = data ? data.moves.filter((m) => now - m.t < 3600_000 && !m.xfer).length : 0;
  const xfers = data ? data.moves.filter((m) => m.xfer).length : 0;
  const shown = data ? data.moves.filter((m) => showX || !m.xfer) : [];

  return (
    <div>
      <PageTitle dim="Traders" bright="Live">
        <StatPill
          items={[
            { value: data ? String(data.stats.tracked) : "-", label: "Wallets tracked" },
            { value: data ? String(moves1h) : "-", label: "Moves · 1h" },
            { value: data ? (data.mode === "pumpportal" ? "LIVE" : "POLL") : "-", label: data?.mode === "pumpportal" ? "PumpPortal stream" : "Chain polling", tone: data?.mode === "pumpportal" ? "up" : undefined },
          ]}
        />
      </PageTitle>
      <p className="-mt-2 mb-5 max-w-3xl text-sm text-muted">
        What named KOLs and our learned smart wallets buy and sell, read from the chain. KOL names come from kolscan.io&apos;s public list. Two or
        more of them buying the same token within 30 minutes puts it on the radar and counts as the smart money proof for a call.
      </p>

      {!remoteUrl ? (
        <p className="card px-4 py-10 text-center text-sm text-muted">The trader network runs on the shared worker. Set NEXT_PUBLIC_WORKER_URL to see it.</p>
      ) : !data ? (
        <p className="card px-4 py-10 text-center text-sm text-muted">{error ? `Could not load traders (${error}).` : "Loading..."}</p>
      ) : (
        <>
          <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_380px]">
            <section className="min-w-0">
              <div className="mb-2 flex items-baseline justify-between">
                <h2 className="label">Latest moves</h2>
                <span className="flex items-center gap-3 font-mono text-[10px] text-dim">
                  <span className="hidden sm:inline">{data.mode === "pumpportal" ? "streamed live" : "polled every ~3 min per wallet"}</span>
                  {xfers > 0 && (
                    <button
                      type="button"
                      onClick={() => setShowX((v) => !v)}
                      aria-pressed={showX}
                      title="Tokens sent to wallets without a trade: airdropped spam, or a dev handing out bags"
                      className={`rounded border px-2 py-0.5 uppercase tracking-wider ${showX ? "border-narr/40 text-narr" : "border-line text-muted hover:text-text"}`}
                    >
                      {showX ? "Hide" : "Show"} {xfers} free transfers
                    </button>
                  )}
                </span>
              </div>
              <div className="card overflow-hidden">
                {shown.length === 0 ? (
                  <p className="px-4 py-8 text-center text-sm text-muted">No moves yet. The first ones show up a few minutes after the worker starts.</p>
                ) : (
                  <ul className="scroll-thin max-h-[560px] overflow-y-auto">
                    {shown.slice(0, 120).map((m, i) => (
                      <MoveRow key={`${m.sig ?? i}${m.w}${m.m}${m.k}`} m={m} solUsd={solUsd} now={now} onOpen={onOpen} />
                    ))}
                  </ul>
                )}
              </div>
            </section>

            <aside className="min-w-0">
              <div className="mb-2 flex items-baseline justify-between">
                <h2 className="label">Most bought · 1h</h2>
                <span className="font-mono text-[10px] text-dim">distinct traders</span>
              </div>
              <div className="card overflow-hidden">
                {data.buzz.length === 0 ? (
                  <p className="px-4 py-8 text-center text-sm text-muted">Nothing bought by tracked traders in the last hour.</p>
                ) : (
                  <ol>
                    {data.buzz.slice(0, 15).map((b, i) => (
                      <li key={b.mint} className="border-b border-line last:border-b-0">
                        <button type="button" onClick={() => onOpen(b.mint)} className="flex w-full items-center gap-3 px-3 py-2.5 text-left hover:bg-row">
                          <span className="w-4 font-mono text-[11px] text-dim">{i + 1}</span>
                          <TokenIcon src={b.img} label={b.s ?? b.mint} size={28} />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate font-mono text-[13px] font-bold">${tick(b.s ?? short(b.mint))}</span>
                            <span className="block truncate font-mono text-[10.5px] text-muted" title={b.names.join(", ")}>
                              {b.buyers} trader{b.buyers === 1 ? "" : "s"} · {b.names.slice(0, 3).join(", ")}
                            </span>
                          </span>
                          <Bars per={b.per} />
                        </button>
                      </li>
                    ))}
                  </ol>
                )}
              </div>
            </aside>
          </div>

          <section className="mt-6">
            <h2 className="label mb-2">Active traders · 24h</h2>
            <div className="card overflow-hidden">
              {data.people.length === 0 ? (
                <p className="px-4 py-8 text-center text-sm text-muted">No trader activity recorded yet.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[640px] font-mono text-[12px] tabular-nums">
                    <thead>
                      <tr className="text-left text-[10px] uppercase tracking-wider text-dim">
                        <th className="px-4 py-2 font-normal">Trader</th>
                        <th className="py-2 text-right font-normal">Buys</th>
                        <th className="py-2 text-right font-normal">Sells</th>
                        <th className="py-2 text-right font-normal">SOL in</th>
                        <th className="py-2 pl-4 font-normal">Last move</th>
                        <th className="px-4 py-2 text-right font-normal">Wallet</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.people.slice(0, 60).map((p) => (
                        <tr key={p.w} className="border-t border-line">
                          <td className="px-4 py-2">
                            <span className="flex items-center gap-2">
                              <SrcBadge src={p.src} />
                              {p.x ? (
                                <a href={p.x} target="_blank" rel="noopener noreferrer" className="text-text hover:text-flow">
                                  {p.name}
                                </a>
                              ) : (
                                <span className="text-text">{p.name}</span>
                              )}
                            </span>
                          </td>
                          <td className="py-2 text-right text-flow">{p.buys}</td>
                          <td className="py-2 text-right text-warn">{p.sells}</td>
                          <td className="py-2 text-right">{p.sol.toFixed(2)}</td>
                          <td className="py-2 pl-4">
                            <button type="button" onClick={() => onOpen(p.lastMint)} className="text-muted hover:text-text">
                              <span className={p.lastK === "buy" ? "text-flow" : "text-warn"}>{p.lastK}</span> ${tick(p.tok?.s ?? short(p.lastMint))}{" "}
                              <span className="text-dim">{age(p.last, now)} ago</span>
                            </button>
                          </td>
                          <td className="px-4 py-2 text-right">
                            <a href={`https://gmgn.ai/sol/address/${p.w}`} target="_blank" rel="noopener noreferrer" className="text-dim hover:text-text">
                              {short(p.w)}
                            </a>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
            <p className="mt-3 font-mono text-[10.5px] leading-relaxed text-dim">
              {data.stats.kols.kols} named KOL wallets in the list
              {data.stats.kols.updatedAt ? `, refreshed ${age(data.stats.kols.updatedAt, now)} ago` : ""}. Amounts are SOL moved in the trade, in dollars at
              today&apos;s SOL price. &quot;via Fomo&quot; = the trade was paid by the Fomo app&apos;s relayer.
            </p>
          </section>
        </>
      )}
    </div>
  );
}

export function MoveRow({ m, solUsd, now, onOpen, compact = false }: { m: TraderMove; solUsd: number | null; now: number; onOpen: (m: string) => void; compact?: boolean }) {
  const buy = m.k === "buy";
  const usdAmt = m.usd ?? (solUsd && m.sol > 0 ? m.sol * solUsd : null);
  return (
    <li className="border-b border-line last:border-b-0">
      <button type="button" onClick={() => onOpen(m.m)} className="flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-row">
        <span
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full font-mono text-[10px] font-bold"
          style={{ background: m.who.src === "kol" ? "#e0b7381f" : "#7fb3c91f", color: m.who.src === "kol" ? "var(--narr)" : "var(--steel)" }}
          aria-hidden
        >
          {m.who.name.replace(/[^a-z0-9]/gi, "").slice(0, 2).toUpperCase() || "?"}
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex min-w-0 items-center gap-1.5">
            <span className="truncate text-[13px] font-semibold text-text">{m.who.name}</span>
            <SrcBadge src={m.who.src} />
            {m.via === "fomo" && <span className="rounded bg-violet/15 px-1 font-mono text-[9px] uppercase text-violet">via Fomo</span>}
          </span>
          <span className="block truncate font-mono text-[11px]">
            {m.xfer ? (
              <span className="text-narr" title="Tokens moved without SOL changing hands, often a dev sending a bag to a KOL">
                {buy ? "received free" : "sent out"}
              </span>
            ) : (
              <span className={buy ? "text-flow" : "text-warn"}>{buy ? "bought" : "sold"}</span>
            )}{" "}
            <span className="text-text">${tick(m.tok?.s ?? short(m.m))}</span>
            {usdAmt != null && usdAmt > 0 ? <span className="text-muted"> · {usd(usdAmt)}</span> : null}
            {!compact && m.mc && solUsd ? <span className="text-dim"> · at {usd(m.mc * solUsd)}</span> : null}
          </span>
        </span>
        {!compact && <TokenIcon src={m.tok?.img} label={m.tok?.s ?? m.m} size={22} />}
        <span className="w-10 shrink-0 text-right font-mono text-[10.5px] text-dim">{age(m.t, now)}</span>
      </button>
    </li>
  );
}

function SrcBadge({ src }: { src: "kol" | "smart" }) {
  return (
    <span
      className={`shrink-0 rounded px-1 font-mono text-[9px] font-bold uppercase ${src === "kol" ? "bg-narr/10 text-narr" : "bg-steel/10 text-steel"}`}
      title={src === "kol" ? "Named KOL wallet" : "Smart wallet learned from the chain"}
    >
      {src === "kol" ? "KOL" : "Smart"}
    </span>
  );
}

function Bars({ per }: { per: number[] }) {
  const max = Math.max(1, ...per);
  return (
    <span className="flex h-6 w-16 items-end gap-px" aria-hidden>
      {per.map((v, i) => (
        <span key={i} className="flex-1 rounded-t-[1px] bg-flow/70" style={{ height: `${Math.max(v ? 12 : 0, (v / max) * 100)}%` }} />
      ))}
    </span>
  );
}

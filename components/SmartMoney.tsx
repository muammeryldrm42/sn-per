"use client";

import { useEffect, useState } from "react";
import type { SmartWalletRow, SmartBuy } from "@/lib/smart";
import { SMART_MIN_RATE, SMART_MIN_SEEN, SMART_MIN_WINS, WIN_X } from "@/lib/smart";
import { age, mult, short, usd } from "@/lib/format";

type Buy = Omit<SmartBuy, "wallets"> & { wallets: string[] };
interface SmartState {
  stats: { tracked: number; smart: number; seeds?: number; pending: number };
  leaderboard: SmartWalletRow[];
  buys: Buy[];
}

// Read the browser's own smart book (no worker): leaderboard only, no live wallet watching.
function localState(): SmartState | null {
  try {
    const raw = localStorage.getItem("tns.smartbook.v1");
    if (!raw) return { stats: { tracked: 0, smart: 0, pending: 0 }, leaderboard: [], buys: [] };
    const j = JSON.parse(raw) as { w: [string, { seen: number; wins: number; best: number; last: number }][]; p: unknown[] };
    const rows = (j.w ?? [])
      .filter(([, r]) => r.seen >= SMART_MIN_SEEN && r.wins >= SMART_MIN_WINS && r.wins / r.seen >= SMART_MIN_RATE)
      .map(([w, r]) => ({ wallet: w, wins: r.wins, seen: r.seen, rate: r.wins / r.seen, best: r.best, last: r.last }))
      .sort((a, b) => b.wins - a.wins || b.rate - a.rate);
    return { stats: { tracked: j.w?.length ?? 0, smart: rows.length, pending: j.p?.length ?? 0 }, leaderboard: rows.slice(0, 50), buys: [] };
  } catch {
    return null;
  }
}

export function SmartMoney({ remoteUrl, embedded = false }: { remoteUrl?: string; embedded?: boolean } = {}) {
  const [state, setState] = useState<SmartState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(true);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        if (remoteUrl) {
          const r = await fetch(`${remoteUrl.replace(/\/$/, "")}/smart`, { cache: "no-store" });
          if (!r.ok) throw new Error(`HTTP ${r.status}`);
          const j = (await r.json()) as SmartState;
          if (alive) setState(j);
        } else if (alive) setState(localState());
        if (alive) setError(null);
      } catch (e) {
        if (alive) setError((e as Error).message);
      }
      if (alive) setNow(Date.now());
    };
    load();
    const t = setInterval(load, 30_000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [remoteUrl]);

  return (
    <section className={embedded ? "" : "border-b border-line px-5 py-5 md:px-8"} aria-labelledby={embedded ? undefined : "smart-title"}>
      {!embedded && (<button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-baseline justify-between text-left"
      >
        <h2 id="smart-title" className="font-display text-lg font-bold">
          Smart money
        </h2>
        <span className="text-sm text-muted">
          {open ? "Hide" : "Show"} wallets that keep buying winners early, and what they buy now
        </span>
      </button>)}
      {open &&
        (!state ? (
          <p className="mt-3 text-sm text-muted">{error ? `Could not load (${error}).` : "Loading..."}</p>
        ) : (
          <div className="mt-3 grid gap-8 lg:grid-cols-2 [&>*]:min-w-0">
            <div>
              <h3 className="mb-2 text-sm font-semibold">Smart wallets buying together</h3>
              {!remoteUrl ? (
                <p className="text-sm text-muted">Live wallet watching runs on the shared worker only.</p>
              ) : state.buys.length === 0 ? (
                <p className="text-sm text-muted">
                  No token bought by 2+ smart wallets in the last 24h yet. Appears here the minute it happens.
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[520px] text-sm tabular-nums">
                    <thead>
                      <tr className="text-left text-xs text-muted">
                        <th className="pb-2 font-normal">Token</th>
                        <th className="pb-2 text-right font-normal">Wallets</th>
                        <th className="pb-2 text-right font-normal">Since</th>
                        <th className="pb-2 text-right font-normal">FDV then</th>
                        <th className="pb-2 text-right font-normal">Now</th>
                        <th className="pb-2 text-right font-normal">Peak</th>
                      </tr>
                    </thead>
                    <tbody>
                      {state.buys.map((b) => {
                        const x = b.baseFdv && b.fdv ? b.fdv / b.baseFdv : null;
                        const px = b.baseFdv && b.peakFdv ? b.peakFdv / b.baseFdv : null;
                        return (
                          <tr key={b.mint} className="border-t border-line">
                            <td className="py-2 pr-2">
                              <a
                                href={`https://dexscreener.com/solana/${b.mint}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="font-semibold hover:text-narr"
                              >
                                {b.name ?? short(b.mint)}
                              </a>{" "}
                              {b.symbol && <span className="text-muted">${b.symbol}</span>}
                            </td>
                            <td className="py-2 text-right" title={b.wallets.join("\n")}>
                              {b.wallets.length}
                            </td>
                            <td className="py-2 text-right">{age(b.clusterAt ?? b.firstAt, now)}</td>
                            <td className="py-2 text-right">{usd(b.baseFdv)}</td>
                            <td className={`py-2 text-right ${x != null && x >= 1 ? "text-flow" : "text-warn"}`}>
                              {usd(b.fdv)} {x != null ? `(${mult(x)})` : ""}
                            </td>
                            <td className="py-2 text-right">{px != null ? mult(px) : "-"}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            <div>
              <h3 className="mb-1 text-sm font-semibold">Smart wallet board</h3>
              <p className="mb-2 text-xs text-muted">
                Learned from the chain: a wallet counts once it bought {SMART_MIN_WINS}+ tokens early (first 10 min) that went on to {WIN_X}x,
                at a {Math.round(SMART_MIN_RATE * 100)}%+ hit rate over {SMART_MIN_SEEN}+ tokens; wallets that move as one operator count once. Bundlers and dev-funded wallets never count. {state.stats.tracked.toLocaleString()} wallets
                tracked, {state.stats.smart} smart so far.
              </p>
              {state.leaderboard.length === 0 ? (
                <p className="text-sm text-muted">
                  Still learning. Wallets show up once enough signals and sampled launches have played out, usually within a few hours of the
                  scanner running.
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[440px] text-sm tabular-nums">
                    <thead>
                      <tr className="text-left text-xs text-muted">
                        <th className="pb-2 font-normal">Wallet</th>
                        <th className="pb-2 text-right font-normal">Wins / seen</th>
                        <th className="pb-2 text-right font-normal">Hit rate</th>
                        <th className="pb-2 text-right font-normal">Best</th>
                        <th className="pb-2 text-right font-normal">Last</th>
                      </tr>
                    </thead>
                    <tbody>
                      {state.leaderboard.map((r) => (
                        <tr key={r.wallet} className="border-t border-line">
                          <td className="py-2 pr-2">
                            <a
                              href={`https://gmgn.ai/sol/address/${r.wallet}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="font-mono text-xs hover:text-narr"
                            >
                              {short(r.wallet)}
                            </a>
                            {r.seed && <span className="ml-1 text-xs text-muted">added</span>}
                          </td>
                          <td className="py-2 text-right">
                            {r.wins} / {r.seen}
                          </td>
                          <td className="py-2 text-right text-flow">{r.seen ? `${Math.round(r.rate * 100)}%` : "-"}</td>
                          <td className="py-2 text-right">{r.best ? mult(r.best) : "-"}</td>
                          <td className="py-2 text-right">{r.last ? `${age(r.last, now)} ago` : "-"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        ))}
    </section>
  );
}

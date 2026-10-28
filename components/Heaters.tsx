"use client";

import { useEffect, useState } from "react";
import type { Heater } from "@/app/api/heaters/route";
import { queueCohort, type Cohort } from "@/lib/cohort";
import { age, pct, usd } from "@/lib/format";

// Tokens heating up across Solana right now, narrative or not, with an on-demand wallet cohort read.
export function Heaters({ remoteUrl, embedded = false }: { remoteUrl?: string; embedded?: boolean } = {}) {
  const [list, setList] = useState<Heater[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(true);
  const [cohorts, setCohorts] = useState<Record<string, Cohort | "loading" | "failed">>({});
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const r = await fetch(remoteUrl ? `${remoteUrl.replace(/\/$/, "")}/heaters` : "/api/heaters", { cache: "no-store" });
        const j = await r.json();
        if (!alive) return;
        if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
        setList(j.heaters);
        // Shared worker reads the wallets for everyone; take its results as they are.
        if (remoteUrl && j.cohorts) setCohorts(j.cohorts);
        setError(null);
      } catch (e) {
        if (alive) setError((e as Error).message);
      }
      if (alive) setNow(Date.now());
    };
    load();
    const t = setInterval(load, remoteUrl ? 30_000 : 60_000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [remoteUrl]);

  // Read wallet cohorts for the top few automatically, one at a time.
  useEffect(() => {
    if (!list || remoteUrl) return;
    for (const h of list.slice(0, 3)) {
      if (cohorts[h.mint]) continue;
      read(h.mint);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [list]);

  const read = async (mint: string) => {
    setCohorts((c) => ({ ...c, [mint]: "loading" }));
    // Busy tokens have long histories: allow up to 25k transactions to reach the launch block.
    const c = await queueCohort(mint, undefined, 25, "low");
    setCohorts((cur) => ({ ...cur, [mint]: c ?? "failed" }));
  };

  return (
    <section className={embedded ? "" : "border-b border-line px-5 py-5 md:px-8"} aria-labelledby={embedded ? undefined : "heaters-title"}>
      {!embedded && (<button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-baseline justify-between text-left"
      >
        <h2 id="heaters-title" className="font-display text-lg font-bold">
          Heaters
        </h2>
        <span className="text-sm text-muted">
          {open ? "Hide" : "Show"} tokens under 24h heating up right now, narrative or not
        </span>
      </button>)}
      {open &&
        (list === null ? (
          <p className="mt-3 text-sm text-muted">{error ? `Could not load heaters (${error}).` : "Looking for heating tokens..."}</p>
        ) : list.length === 0 ? (
          <p className="mt-3 text-sm text-muted">Nothing under 24h is heating up right now.</p>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[760px] text-sm tabular-nums">
              <thead>
                <tr className="text-left text-xs text-muted">
                  <th className="pb-2 font-normal">Heat</th>
                  <th className="pb-2 font-normal">Token</th>
                  <th className="pb-2 font-normal">Age</th>
                  <th className="pb-2 text-right font-normal">FDV</th>
                  <th className="pb-2 text-right font-normal">5m</th>
                  <th className="pb-2 text-right font-normal">Buyers 5m</th>
                  <th className="pb-2 text-right font-normal">Buys / sells</th>
                  <th className="pb-2 pl-4 font-normal">Wallets</th>
                </tr>
              </thead>
              <tbody>
                {list.map((h) => {
                  const c = cohorts[h.mint];
                  return (
                    <tr key={h.mint} className="border-t border-line">
                      <td className="py-2 font-display text-lg font-extrabold">{h.heat}</td>
                      <td className="py-2 pr-2">
                        <a
                          href={`https://dexscreener.com/solana/${h.mint}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="font-semibold hover:text-narr"
                        >
                          {h.name.split(" / ")[0]}
                        </a>
                        <span className="ml-1 text-xs text-muted">{h.dex}</span>
                      </td>
                      <td className="py-2">{age(h.createdAt, now)}</td>
                      <td className="py-2 text-right">{usd(h.fdvUsd)}</td>
                      <td className="py-2 text-right text-flow">{pct(h.change5m)}</td>
                      <td className="py-2 text-right">{h.buyers5m}</td>
                      <td className="py-2 text-right">
                        {h.buys5m} / {h.sells5m}
                      </td>
                      <td className="py-2 pl-4 text-xs">
                        {!c && remoteUrl ? (
                          <span className="text-muted">queued</span>
                        ) : !c ? (
                          <button type="button" onClick={() => read(h.mint)} className="text-muted underline-offset-4 hover:text-text hover:underline">
                            Read wallets
                          </button>
                        ) : c === "loading" ? (
                          <span className="text-muted">reading...</span>
                        ) : c === "failed" ? (
                          <span className="text-muted" title="More than 25k transactions since launch, or the RPC refused">too busy to read</span>
                        ) : c.holdingsKnown === false ? (
                          <span className="text-muted">
                            {c.bundlerCount} bundlers, {c.sniperCount} snipers, balances unreadable
                          </span>
                        ) : (
                          <span
                            className={c.combinedRiskPct >= 30 ? "text-warn" : "text-flow"}
                            title={`Bundlers ${c.bundlerHoldPct}%, snipers ${c.sniperHoldPct}%, fresh ${c.freshHoldPct}%, linked ${c.linkedCount}`}
                          >
                            {c.combinedRiskPct >= 50 ? "Rug likely, " : c.cleanLaunch ? "Clean, " : ""}
                            risk wallets hold {c.combinedRiskPct}%
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ))}
    </section>
  );
}

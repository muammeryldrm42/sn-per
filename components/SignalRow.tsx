"use client";

import { useEffect, useState } from "react";
import type { Signal } from "@/lib/types";
import type { CallRow } from "@/lib/archive";
import { age, mult, pct, perf, sol, short, usd } from "@/lib/format";

const tierStyle: Record<Signal["tier"], string> = {
  hot: "bg-narr text-ink",
  warm: "bg-flow/20 text-flow",
  early: "bg-line text-muted",
};
const tierName: Record<Signal["tier"], string> = { hot: "Hot", warm: "Warm", early: "Early" };

const matchName: Record<Signal["matchKind"], string> = {
  exact: "exact name",
  word: "word in name",
  contains: "inside name",
  fuzzy: "close spelling",
};

export function SignalRow({
  s,
  now,
  solUsd,
  fresh,
  focus = false,
  call,
  detailsOnly = false,
}: {
  s: Signal;
  now: number;
  solUsd: number | null;
  fresh: boolean;
  focus?: boolean;
  call?: CallRow;
  detailsOnly?: boolean; // token page: only the detail panel, always open
}) {
  // Called tokens are measured from the call, radar tokens from when they reached the radar.
  const cx = call ? { now: call.now / call.c, peak: call.pk / call.c } : null;
  const [open, setOpen] = useState(focus || detailsOnly);
  useEffect(() => {
    if (focus) setOpen(true);
  }, [focus]);
  const [linked, setLinked] = useState(false);
  const shareLink = async () => {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}/?mint=${s.mint}`);
      setLinked(true);
      setTimeout(() => setLinked(false), 1500);
    } catch {
      /* clipboard blocked */
    }
  };
  const [copied, setCopied] = useState(false);

  const Wrap = detailsOnly ? "div" : "li";
  const mcapUsd = s.fdvUsd ?? (solUsd && s.marketCapSol ? s.marketCapSol * solUsd : undefined);
  const dangers = s.rug.risks.filter((r) => r.level === "danger");
  const p = perf(s);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(s.mint);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard blocked */
    }
  };

  return (
    <Wrap id={`sig-${s.mint}`} className={detailsOnly ? "" : `border-b border-line ${fresh ? "row-new" : ""} ${focus ? "bg-panel" : ""}`}>
      {!detailsOnly && (<button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="grid w-full grid-cols-[auto_1fr_auto] items-center gap-x-4 gap-y-1 px-5 py-3 text-left hover:bg-panel md:grid-cols-[3rem_2.5rem_minmax(0,1.4fr)_minmax(0,1fr)_7rem_7rem_6rem] md:px-8"
      >
        <span className="font-display text-2xl font-extrabold tabular-nums md:text-right">{s.score}</span>

        <span className="hidden md:block">
          <TokenImage src={s.image} label={s.symbol} />
        </span>

        <span className="min-w-0">
          <span className="block truncate font-semibold">
            {s.name} <span className="font-normal text-muted">${s.symbol}</span>
          </span>
          <span className="block text-xs text-muted">
            {s.trigger ? (
              <>
                launched {age(s.createdAt, now)} ago on {s.pool}
                {s.calledAt ? <span className="font-semibold text-narr">, called {age(s.calledAt, now)} ago</span> : null}
                {s.copyIndex > 0 ? `, name used ${s.copyIndex + 1}x today` : ""}
              </>
            ) : (
              <>
                {age(s.createdAt, now)} ago on {s.pool}
                {s.copyIndex > 0 ? `, copy #${s.copyIndex + 1}` : ", first on this narrative"}
              </>
            )}
            {s.devSold && <span className="text-warn">, dev sold</span>}
            {s.bundled && <span className="text-warn">, sniped at launch</span>}
            {s.strong && <span className="text-flow md:hidden">, strong</span>}
            {s.rising && <span className="text-flow md:hidden">, rising</span>}
            {s.freshNarrative && <span className="text-flow">, fresh narrative</span>}
            {s.graduated && <span className="text-narr md:hidden">, graduated</span>}
            {s.matchSources.includes("watchlist") && <span className="text-narr">, watchlist</span>}
            {s.devKnownDumper && <span className="text-warn">, dev dumped before</span>}
            {s.rugged && <span className="text-warn">, flagged rugged</span>}
            {s.rugLikely && <span className="font-semibold text-warn">, rug likely</span>}
            {s.cleanLaunch && <span className="text-flow">, clean launch</span>}
            {(s.smartBuyers?.length ?? 0) > 0 && (
              <span className="font-semibold text-flow">
                , {s.smartBuyers!.length} smart wallet{s.smartBuyers!.length === 1 ? "" : "s"} in
              </span>
            )}
            {s.gradEtaMin != null && s.gradEtaMin <= 30 && (s.curvePct ?? 0) < 100 && (
              <span className="text-flow">, graduating in ~{s.gradEtaMin} min</span>
            )}
            {(s.callers?.length ?? 0) > 0 && (
              <span className="text-narr" title={s.callers!.map((c) => `@${c}`).join(", ")}>
                , called by {s.callers!.length} channel{s.callers!.length === 1 ? "" : "s"}
              </span>
            )}
            {s.dexPaid && <span className="text-flow">, DEX paid</span>}
            {(s.holderGrowthPerMin ?? 0) >= 5 && (
              <span className="text-flow">, +{Math.round(s.holderGrowthPerMin ?? 0)} holders/min</span>
            )}
            {s.lowEffort && <span className="text-warn">, no socials</span>}
            {s.copycat && <span className="text-warn">, copy of a live token</span>}
            {s.dumpedFromPeak && <span className="text-warn">, dumped from peak</span>}
            {s.thinLiquidity && <span className="text-warn">, thin liquidity</span>}
            {s.narrativeFirstSeen ? (
              s.createdAt - s.narrativeFirstSeen <= 60 * 60_000 ? (
                <span className="text-flow">, narrative {Math.max(0, Math.round((s.createdAt - s.narrativeFirstSeen) / 60_000))}m old</span>
              ) : null
            ) : null}
            {((s.insiderPct ?? 0) > 15 || (s.insiders ?? 0) >= 5) && <span className="text-warn">, insider network</span>}
            {(s.top10Pct ?? 0) > 35 && <span className="text-warn">, top 10 hold {s.top10Pct}%</span>}
            {s.matchGeneric && <span>, everyday word</span>}
            {s.devSerial && <span className="text-warn">, serial dev ({s.devLaunches24h} launches 24h)</span>}
          </span>
        </span>

        <span className="col-span-3 min-w-0 md:col-span-1">
          <span className="inline-block max-w-full truncate rounded-md border border-narr/40 px-2 py-0.5 text-sm text-narr">
            {s.matchedDisplay}
          </span>
        </span>

        <span className="hidden text-sm tabular-nums md:block">
          <span className="block">{mcapUsd ? usd(mcapUsd) : s.marketCapSol ? sol(s.marketCapSol) : "-"}</span>
          <span className="block text-xs text-muted">
            {cx ? (
              <>
                <span className={cx.now >= 1 ? "text-flow" : "text-warn"}>{mult(cx.now)}</span> since call, peak {mult(cx.peak)}
              </>
            ) : p ? (
              <>
                <span className={p.now >= 1 ? "text-flow" : "text-warn"}>{mult(p.now)}</span>, peak {mult(p.peak)}
              </>
            ) : (
              "market cap"
            )}
          </span>
          {s.curvePct != null && (
            <span className="mt-1 block h-1 w-full overflow-hidden rounded bg-line" title={`Bonding curve ${s.curvePct.toFixed(0)}%`}>
              <span className="block h-full bg-flow" style={{ width: `${s.curvePct}%` }} />
            </span>
          )}
        </span>

        <span className="hidden text-sm tabular-nums text-flow md:block">
          <span className="block">
            {s.buys > 0 ? `${s.buyers} buyers` : s.m5Buys != null ? `${s.m5Buys} buys` : s.holders != null ? `${s.holders} holders` : "-"}
          </span>
          <span className="block text-xs text-muted">
            {s.buys > 0
              ? `${s.netSol >= 0 ? "+" : ""}${sol(s.netSol)}`
              : s.m5Buys != null
                ? `${s.m5Sells ?? 0} sells, 5 min`
                : s.holders != null
                  ? "RugCheck"
                  : "waiting for data"}
          </span>
        </span>

        <span className="hidden justify-self-end md:block">
          {s.graduated && (
            <span className="mr-1 rounded-full border border-narr px-2 py-0.5 text-xs font-semibold text-narr">Graduated</span>
          )}
          {s.rising && (
            <span className="mr-1 rounded-full bg-flow px-2 py-0.5 text-xs font-semibold text-ink">Rising</span>
          )}
          {s.strong && (
            <span className="mr-1 rounded-full border border-flow px-2 py-0.5 text-xs font-semibold text-flow">Strong</span>
          )}
          <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${tierStyle[s.tier]}`}>{tierName[s.tier]}</span>
          {dangers.length > 0 && (
            <span className="ml-1 text-xs text-warn" title={dangers.map((d) => d.name).join(", ")}>
              {dangers.length} risk
            </span>
          )}
        </span>
      </button>)}

      {open && (
        <div className="grid gap-5 bg-panel px-5 py-5 text-sm md:grid-cols-3 md:px-8">
          <div>
            {s.trigger ? (
              <>
                <h3 className="mb-1 font-display font-bold">Why it was picked</h3>
                <p>
                  <span className="text-narr">{s.matchedDisplay}:</span> {s.matchContext}
                </p>
                {s.calledAt ? (
                  <p className="mt-2">
                    Called {age(s.calledAt, now)} ago at {usd(s.callMcapUsd)}
                    {cx ? (
                      <>
                        , now <span className={cx.now >= 1 ? "text-flow" : "text-warn"}>{mult(cx.now)}</span>, peak{" "}
                        <span className="text-flow">{mult(cx.peak)}</span>
                      </>
                    ) : null}
                    .
                  </p>
                ) : (
                  <p className="mt-2 text-muted">
                    On the radar, not called
                    {s.callBlockers?.length ? `: ${s.callBlockers.join(", ")}.` : "."}
                  </p>
                )}
              </>
            ) : (
              <>
                <h3 className="mb-1 font-display font-bold">Why it matched</h3>
                <p>
                  &ldquo;{s.matchedDisplay}&rdquo; ({matchName[s.matchKind]}) is trending on{" "}
                  {s.matchSources.join(", ")}.
                </p>
                <p className="mt-1 text-muted">{s.matchContext}</p>
                <p className="mt-1 text-xs text-muted">
                  {s.narrativeFirstSeen
                    ? `Narrative first seen ${Math.max(0, Math.round((s.createdAt - s.narrativeFirstSeen) / 60_000))} min before this launch.`
                    : "Narrative was already trending when tracking started."}
                  {s.copycat ? " Name copies a token that is already live, so this is a copycat rather than a new story." : ""}
                </p>
              </>
            )}
            {s.description && <p className="mt-3 line-clamp-4 text-muted">{s.description}</p>}
            {s.strongChecks && (
              <>
                <h3 className="mb-1 mt-4 font-display font-bold">Checks</h3>
                <ul className="space-y-0.5">
                  {s.strongChecks.map((c) => (
                    <li key={c.label} className={c.ok ? "text-flow" : "text-muted line-through decoration-warn/60"}>
                      {c.label}
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>

          <div>
            <h3 className="mb-1 font-display font-bold">On-chain since launch</h3>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-1 tabular-nums">
              <dt className="text-muted">Dev buy</dt>
              <dd>{sol(s.initialBuySol)}</dd>
              <dt className="text-muted">Buys / sells</dt>
              <dd>
                {s.buys} / {s.sells}
              </dd>
              <dt className="text-muted">Unique buyers</dt>
              <dd>{s.buyers}</dd>
              <dt className="text-muted">Dev</dt>
              <dd className={s.devSold ? "text-warn" : ""}>
                {s.devSold ? `sold ${sol(s.devSoldSol ?? 0)}` : "holding"}
              </dd>
              <dt className="text-muted">Net flow</dt>
              <dd className={s.netSol >= 0 ? "text-flow" : "text-warn"}>{sol(s.netSol)}</dd>
              {s.liquidityUsd != null && (
                <>
                  <dt className="text-muted">Liquidity</dt>
                  <dd>{usd(s.liquidityUsd)}</dd>
                </>
              )}
            </dl>
            <h3 className="mb-1 mt-4 font-display font-bold">Momentum</h3>
            {s.buyers1m == null && s.m5Buys != null ? (
              <dl className="grid grid-cols-2 gap-x-4 gap-y-1 tabular-nums">
                <dt className="text-muted">Buys / sells 5m</dt>
                <dd>
                  {s.m5Buys} / {s.m5Sells ?? 0}
                </dd>
                <dt className="text-muted">Volume 5m</dt>
                <dd>{usd(s.volume5m)}</dd>
                <dt className="text-muted">Price 5m</dt>
                <dd className={(s.priceChange5m ?? 0) >= 0 ? "text-flow" : "text-warn"}>{pct(s.priceChange5m)}</dd>
                <dt className="text-muted">Mcap since tracked (5m)</dt>
                <dd className={(s.mcapChange5m ?? 0) >= 0 ? "text-flow" : "text-warn"}>{pct(s.mcapChange5m)}</dd>
                {s.curvePct != null && (
                  <>
                    <dt className="text-muted">Bonding curve</dt>
                    <dd>
                      {s.graduated ? "graduated" : `${s.curvePct.toFixed(1)}%`}
                      {!s.graduated && s.curveVelPerMin != null && (
                        <span className={s.curveVelPerMin > 0 ? "text-flow" : "text-warn"}>
                          {" "}
                          ({s.curveVelPerMin >= 0 ? "+" : ""}
                          {s.curveVelPerMin.toFixed(1)}%/min{s.gradEtaMin != null ? `, ~${s.gradEtaMin} min left` : ""})
                        </span>
                      )}
                    </dd>
                  </>
                )}
                {p && (
                  <>
                    <dt className="text-muted">Since signal</dt>
                    <dd>
                      {mult(p.now)} now, {mult(p.peak)} peak
                    </dd>
                  </>
                )}
              </dl>
            ) : s.buyers1m == null ? (
              <p className="text-muted">
                {Date.now() - s.createdAt < 60 * 60_000
                ? "Waiting for DexScreener to index the first trades."
                : "No longer tracked, momentum only runs for the first hour."}
              </p>
            ) : (
              <dl className="grid grid-cols-2 gap-x-4 gap-y-1 tabular-nums">
                <dt className="text-muted">New buyers 1m / 5m</dt>
                <dd>
                  {s.buyers1m} / {s.buyers5m ?? 0}
                </dd>
                <dt className="text-muted">Net SOL 1m / 5m</dt>
                <dd className={(s.netSol1m ?? 0) >= 0 ? "text-flow" : "text-warn"}>
                  {sol(s.netSol1m ?? 0)} / {sol(s.netSol5m ?? 0)}
                </dd>
                <dt className="text-muted">Mcap 5m</dt>
                <dd className={(s.mcapChange5m ?? 0) >= 0 ? "text-flow" : "text-warn"}>{pct(s.mcapChange5m)}</dd>
                <dt className="text-muted">Whale buys (2+ SOL)</dt>
                <dd>{s.whaleBuys ?? 0}</dd>
                <dt className="text-muted">Top 3 buyers share</dt>
                <dd className={(s.top3Share ?? 0) > 0.6 ? "text-warn" : ""}>
                  {s.top3Share != null ? `${Math.round(s.top3Share * 100)}%` : "-"}
                </dd>
                {s.curvePct != null && (
                  <>
                    <dt className="text-muted">Bonding curve</dt>
                    <dd>{s.curvePct.toFixed(1)}%</dd>
                  </>
                )}
                {p && (
                  <>
                    <dt className="text-muted">Since signal</dt>
                    <dd>
                      {mult(p.now)} now, {mult(p.peak)} peak
                    </dd>
                  </>
                )}
              </dl>
            )}

            <h3 className="mb-1 mt-4 font-display font-bold">Wallet cohorts</h3>
            {!s.cohort ? (
              <p className="text-muted">Reading the first trades from the chain, about 15 s after launch.</p>
            ) : (
              <>
                <dl className="grid grid-cols-2 gap-x-4 gap-y-1 tabular-nums">
                  <dt className="text-muted">Dev holds</dt>
                  <dd>{s.cohort.devHoldPct}%</dd>
                  <dt className="text-muted">Bundlers (launch block)</dt>
                  <dd className={s.cohort.bundlerHoldPct >= 10 ? "text-warn" : ""}>
                    {s.cohort.bundlerCount} wallets, {s.cohort.bundlerHoldPct}%
                    {s.cohort.bundleBuySol > 0 ? `, bought ${s.cohort.bundleBuySol} SOL` : ""}
                  </dd>
                  <dt className="text-muted">Snipers (first 1.5 s)</dt>
                  <dd className={s.cohort.sniperHoldPct >= 20 ? "text-warn" : ""}>
                    {s.cohort.sniperCount} wallets, {s.cohort.sniperHoldPct}%
                  </dd>
                  <dt className="text-muted">Fresh wallets</dt>
                  <dd className={s.cohort.freshHoldPct >= 15 ? "text-warn" : ""}>
                    {s.cohort.freshCount} wallets, {s.cohort.freshHoldPct}%
                  </dd>
                  {(s.cohort.fomoBuyers ?? 0) > 0 && (
                    <>
                      <dt className="text-muted">Bought through Fomo</dt>
                      <dd className="text-violet">{s.cohort.fomoBuyers} early buyers</dd>
                    </>
                  )}
                  <dt className="text-muted">Smart wallets among buyers</dt>
                  <dd className={(s.smartBuyers?.length ?? 0) > 0 ? "text-flow" : ""}>
                    {(s.smartBuyers?.length ?? 0) === 0
                      ? "none known"
                      : s.smartBuyers!.map((w, i) => (
                          <a
                            key={w}
                            href={`https://gmgn.ai/sol/address/${w}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="mr-1 font-mono text-xs underline-offset-4 hover:underline"
                          >
                            {short(w)}
                            {i < s.smartBuyers!.length - 1 ? "," : ""}
                          </a>
                        ))}
                  </dd>
                  <dt className="text-muted">Linked to dev / shared funder</dt>
                  <dd className={s.cohort.linkedCount >= 2 ? "text-warn" : ""}>{s.cohort.linkedCount} wallets</dd>
                  <dt className="text-muted">All of the above hold</dt>
                  <dd className={s.cohort.combinedRiskPct >= 30 ? "font-semibold text-warn" : "text-flow"}>
                    {s.cohort.combinedRiskPct}%
                  </dd>
                </dl>
                {s.cohort.holdingsKnown === false && (
                  <p className="mt-1 text-xs text-warn">Current balances could not be read, hold % are unknown. Counts are real.</p>
                )}
                <p className="mt-1 text-xs text-muted">
                  Read from chain {age(s.cohort.at, now)} ago, each wallet counted once
                  {s.cohort.partial ? ". Some lookups failed, treat as a minimum" : ""}.
                </p>
              </>
            )}

            <h3 className="mb-1 mt-4 font-display font-bold">Dev history</h3>
            {!s.creator ? (
              <p className="text-muted">Creator unknown for this source.</p>
            ) : (
              <dl className="grid grid-cols-2 gap-x-4 gap-y-1 tabular-nums">
                <dt className="text-muted">Wallet</dt>
                <dd>
                  <a
                    href={`https://solscan.io/account/${s.creator}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-mono text-xs underline-offset-4 hover:underline"
                  >
                    {short(s.creator)}
                  </a>
                </dd>
                <dt className="text-muted">Still holds initial buy</dt>
                <dd className={s.devHeldPct != null && s.devHeldPct < 0.5 ? "text-warn" : ""}>
                  {!s.initialBuyTokens
                    ? "dev did not buy"
                    : s.devHeldPct == null
                      ? "checking"
                      : `${Math.round(s.devHeldPct * 100)}%`}
                </dd>
                <dt className="text-muted">Other launches 24h</dt>
                <dd className={s.devSerial ? "text-warn" : ""}>{s.devLaunches24h ?? 0}</dd>
                <dt className="text-muted">Previous tokens dumped</dt>
                <dd className={s.devKnownDumper ? "text-warn" : ""}>
                  {s.devPrevChecked ? `${s.devPrevDumps ?? 0} of ${s.devPrevChecked} checked` : "none seen yet"}
                </dd>
                {s.devPrevTokens != null && (
                  <>
                    <dt className="text-muted">All earlier launches</dt>
                    <dd className={s.devPrevTokens >= 10 && (s.devPrevDead ?? 0) / s.devPrevTokens >= 0.8 ? "text-warn" : ""}>
                      {s.devPrevTokens === 0 ? "first launch" : `${s.devPrevTokens}, ${s.devPrevDead ?? 0} dead`}
                    </dd>
                    {s.devPrevBest != null && s.devPrevTokens > 0 && (
                      <>
                        <dt className="text-muted">Best earlier token</dt>
                        <dd className={s.devPrevBest >= 100_000 ? "text-flow" : ""}>{usd(s.devPrevBest)}</dd>
                      </>
                    )}
                  </>
                )}
              </dl>
            )}
            <p className="mt-1 text-xs text-muted">Built from launches this browser has seen, kept for 7 days.</p>

            <h3 className="mb-1 mt-4 font-display font-bold">RugCheck</h3>
            {s.rug.status === "pending" && <p className="text-muted">Checking once the token is indexed.</p>}
            {s.rug.status === "unavailable" && <p className="text-muted">RugCheck has no report for this token yet.</p>}
            {s.rug.status === "ok" && s.top10Pct != null && (
              <dl className="mb-2 grid grid-cols-2 gap-x-4 gap-y-1 tabular-nums">
                <dt className="text-muted">Holders</dt>
                <dd>
                  {s.holders?.toLocaleString() ?? "-"}
                  {s.holderGrowthPerMin != null && (
                    <span className={s.holderGrowthPerMin > 0 ? "text-flow" : "text-warn"}>
                      {" "}
                      ({s.holderGrowthPerMin >= 0 ? "+" : ""}
                      {s.holderGrowthPerMin.toFixed(1)}/min)
                    </span>
                  )}
                </dd>
                <dt className="text-muted">DEX paid</dt>
                <dd className={s.dexPaid ? "text-flow" : ""}>
                  {s.dexPaid
                    ? `yes${s.dexPaidAt ? `, ${Math.max(0, Math.round((s.dexPaidAt - s.createdAt) / 60_000))} min after launch` : ""}`
                    : "not yet"}
                  {(s.boosts ?? 0) > 0 ? `, ${s.boosts} boosts` : ""}
                </dd>
                <dt className="text-muted">Top 10 (ex pools)</dt>
                <dd className={s.top10Pct > 35 ? "text-warn" : "text-flow"}>{s.top10Pct}%</dd>
                <dt className="text-muted">Largest wallet</dt>
                <dd className={(s.top1Pct ?? 0) > 10 ? "text-warn" : ""}>{s.top1Pct ?? 0}%</dd>
                <dt className="text-muted">Insider network</dt>
                <dd className={(s.insiderPct ?? 0) > 15 || (s.insiders ?? 0) >= 5 ? "text-warn" : ""}>
                  {s.insiders ? `${s.insiders} wallets, ${s.insiderPct ?? 0}%` : "none found"}
                </dd>
              </dl>
            )}
            {s.rug.status === "ok" &&
              (s.rug.risks.length === 0 ? (
                <p className="text-flow">No risks reported.</p>
              ) : (
                <ul className="space-y-0.5">
                  {s.rug.risks.map((r) => (
                    <li key={r.name} className={r.level === "danger" ? "text-warn" : "text-muted"}>
                      {r.name}
                    </li>
                  ))}
                </ul>
              ))}
          </div>

          <div>
            <h3 className="mb-1 font-display font-bold">Open</h3>
            <div className="flex flex-wrap gap-2">
              <Ext href={`https://jup.ag/swap/SOL-${s.mint}`}>Buy on Jupiter</Ext>
              <Ext href={`https://neo.bullx.io/terminal?chainId=1399811149&address=${s.mint}`}>BullX</Ext>
              <Ext href={`https://pump.fun/coin/${s.mint}`}>Pump.fun</Ext>
              <Ext href={`https://dexscreener.com/solana/${s.mint}`}>DexScreener</Ext>
              <Ext href={`https://gmgn.ai/sol/token/${s.mint}`}>GMGN</Ext>
              <Ext href={`https://axiom.trade/t/${s.mint}`}>Axiom</Ext>
              <Ext href={`https://solscan.io/token/${s.mint}`}>Solscan</Ext>
              {s.twitter && <Ext href={s.twitter}>X</Ext>}
              {s.telegram && <Ext href={s.telegram}>Telegram</Ext>}
              {s.website && <Ext href={s.website}>Website</Ext>}
            </div>
            <button
              type="button"
              onClick={copy}
              className="mt-3 rounded-md border border-line px-3 py-1.5 font-mono text-xs hover:border-flow"
            >
              {copied ? "Copied" : `Copy ${short(s.mint)}`}
            </button>
            <button
              type="button"
              onClick={shareLink}
              className="ml-2 mt-3 rounded-md border border-line px-3 py-1.5 text-xs hover:border-flow"
            >
              {linked ? "Link copied" : "Copy signal link"}
            </button>
          </div>
        </div>
      )}
    </Wrap>
  );
}

function Ext({ href, children }: { href: string; children: React.ReactNode }) {
  const safe = /^https?:\/\//.test(href) ? href : undefined;
  if (!safe) return null;
  return (
    <a
      href={safe}
      target="_blank"
      rel="noopener noreferrer"
      className="rounded-md border border-line px-3 py-1.5 hover:border-narr hover:text-narr"
    >
      {children}
    </a>
  );
}

function TokenImage({ src, label }: { src?: string; label: string }) {
  const [bad, setBad] = useState(false);
  if (!src || bad) {
    return (
      <span className="flex h-10 w-10 items-center justify-center rounded-full bg-line text-xs font-bold text-muted">
        {label.slice(0, 2).toUpperCase()}
      </span>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt=""
      width={40}
      height={40}
      loading="lazy"
      referrerPolicy="no-referrer"
      onError={() => setBad(true)}
      className="h-10 w-10 rounded-full object-cover"
    />
  );
}

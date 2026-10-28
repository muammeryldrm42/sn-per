"use client";

import { useEffect, useState } from "react";
import type { Signal } from "@/lib/types";
import { TRIGGER_LABEL, type CallRow } from "@/lib/archive";
import { age, perf, short, usd } from "@/lib/format";
import { SignalRow } from "./SignalRow";
import { Spark } from "./Spark";
import { GemBadge, LaunchStats, RugBadge } from "./TierBits";
import { RUG_TEXT, rowRug } from "@/lib/tiers";
import { BuyMenu, tick, Ext, GradeChip, multText, peakColor, ShareButton, StarButton, TokenIcon, TriggerChip, XPill } from "./ui";
import { CandleChart } from "./CandleChart";
import { MoveRow, useTraders } from "./TradersView";
import { PAPER_RULES } from "@/lib/archive";
import { useStars } from "@/lib/watch";

// One token: the call (if any) with its chart, and the full on-chain read while it is still tracked.
export function TokenView({
  mint,
  calls,
  signals,
  now,
  solUsd,
  remoteUrl,
  onBack,
}: {
  mint: string;
  calls: CallRow[];
  signals: Signal[];
  now: number;
  solUsd: number | null;
  remoteUrl?: string;
  onBack: () => void;
}) {
  const s = signals.find((x) => x.mint === mint);
  const local = calls.find((r) => r.m === mint);
  const [fetched, setFetched] = useState<CallRow | null | undefined>(undefined);
  const [copied, setCopied] = useState(false);
  const stars = useStars();

  // Calls older than 7 days are not in the live state; ask the worker's archive.
  useEffect(() => {
    if (local || !remoteUrl) return;
    let alive = true;
    fetch(`${remoteUrl.replace(/\/$/, "")}/call?m=${encodeURIComponent(mint)}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : { call: null }))
      .then((j) => alive && setFetched(j.call ?? null))
      .catch(() => alive && setFetched(null));
    return () => {
      alive = false;
    };
  }, [mint, local, remoteUrl]);

  const call = local ?? fetched ?? undefined;
  const sym = call?.s ?? s?.symbol ?? "";
  const name = call?.n ?? s?.name ?? "";
  const img = call?.img ?? s?.image;
  const trigger = call?.tr ?? s?.trigger;
  const p = s ? perf(s) : null;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(mint);
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    } catch {
      /* blocked */
    }
  };

  return (
    <div className="pb-6 pt-5">
      <button type="button" onClick={onBack} className="mb-4 font-mono text-[11px] uppercase tracking-wider text-muted hover:text-text">
        ← Back
      </button>

      <header className="flex flex-wrap items-center gap-4">
        <TokenIcon src={img} label={sym || mint} size={56} />
        <div className="min-w-0 flex-1">
          <h1 className="font-big text-[clamp(30px,4vw,48px)] uppercase leading-none">
            {sym ? `$${tick(sym)}` : short(mint)}
          </h1>
          <p className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted">
            <span className="truncate">{name}</span>
            <button type="button" onClick={copy} className="rounded border border-line px-1.5 py-0.5 font-mono text-[10.5px] hover:text-text">
              {copied ? "copied" : short(mint)}
            </button>
            {trigger && <TriggerChip trigger={trigger} />}
          </p>
        </div>
        <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
          <BuyMenu mint={mint} big />
          <StarButton on={stars.has(mint)} onToggle={() => stars.toggle(mint)} />
          <ShareButton mint={mint} />
          {call && (
            <a
              href={`https://x.com/intent/tweet?text=${encodeURIComponent(
                `$${tick(call.s)} called by Talons at ${usd(call.c)}, peak ${multText(call.pk / call.c)} since the call.`
              )}&url=${encodeURIComponent(typeof window !== "undefined" ? `${window.location.origin}/t/${mint}` : "")}`}
              target="_blank"
              rel="noopener noreferrer"
              aria-label="Share this call on X"
              className="flex h-[30px] items-center gap-1.5 rounded-md border border-line px-2.5 font-mono text-[11px] text-muted hover:border-flow/50 hover:text-text"
            >
              <svg width="11" height="11" viewBox="0 0 12 12" fill="currentColor" aria-hidden>
                <path d="M9.2 1h1.7L7.2 5.3 11.6 11H8.2L5.5 7.5 2.4 11H.7l4-4.6L.4 1h3.5l2.4 3.2zm-.6 9h.9L3.4 1.9h-1z" />
              </svg>
              Post
            </a>
          )}
        </div>
      </header>

      {call ? (
        <section className="card mt-6 overflow-hidden">
          <div className="grid grid-cols-2 divide-line border-b border-line sm:grid-cols-4 sm:divide-x">
            <Stat label="Called" value={usd(call.c)} sub={`${age(call.t, now)} ago, ${new Date(call.t).toISOString().slice(0, 16).replace("T", " ")} UTC`} />
            <Stat label="Now" value={usd(call.now)} pill={call.now / call.c} sub={`checked ${age(call.chk, now)} ago`} />
            <Stat label="Peak since call" value={multText(call.pk / call.c)} color={peakColor(call.pk / call.c)} sub={`${usd(call.pk)}, 1h peak ${multText(call.p1 / call.c)}`} />
            <PaperStat call={call} />
          </div>
          <div className="px-4 py-4">
            <CandleChart mint={mint} callAt={call.t} entry={call.c} fallback={<ResponsiveSpark row={call} />} />
            <div className="mt-4 flex flex-wrap items-center gap-2">
              <TriggerChip trigger={call.tr} />
              <GradeChip g={call.g} tr={call.tr} />
              <RugBadge r={call} />
              <GemBadge r={call} />
              <span className="text-sm text-muted">{call.why}</span>
            </div>
            <p className="mt-2 font-mono text-[11px] text-muted">
              At the call: <LaunchStats r={call} />
              {call.fw != null ? <span className="text-dim"> · fresh wallets {call.fw}%</span> : null}
              <span className="text-dim"> · rug check: {RUG_TEXT[rowRug(call)].line}</span>
            </p>
            {call.bc?.length ? (
              <ul className="mt-3 grid gap-x-6 gap-y-1 sm:grid-cols-2">
                {call.bc.map((b) => (
                  <li key={b} className="flex items-start gap-2 font-mono text-[11.5px] text-muted">
                    <span className={/sold|warning|not in yet|running|unreadable/i.test(b) ? "text-narr" : "text-flow"} aria-hidden>
                      {/sold|warning|not in yet|running|unreadable/i.test(b) ? "!" : "✓"}
                    </span>
                    {b}
                  </li>
                ))}
              </ul>
            ) : null}
            <p className="mt-3 font-mono text-[11px] text-dim">
              {call.rt ? `Reached the radar on ${TRIGGER_LABEL[call.rt] ?? call.rt}. ` : ""}Score {call.sc} at the call{call.sm ? `, ${call.sm} smart wallets in early` : ""}
              {call.cl ? ", clean launch" : ""}
              {call.la ? `, called ${Math.max(0, Math.round((call.t - call.la) / 60_000))} min after launch` : ""}.
            </p>
            {call.sw?.length ? (
              <p className="mt-2 flex flex-wrap items-center gap-1.5 font-mono text-[11px]">
                <span className="text-narr">Smart wallets in:</span>
                {call.sw.map((w) => (
                  <a
                    key={w}
                    href={`https://gmgn.ai/sol/address/${w}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="rounded border border-line px-1.5 py-0.5 text-muted hover:border-narr/50 hover:text-text"
                  >
                    {short(w)}
                  </a>
                ))}
              </p>
            ) : null}
          </div>
        </section>
      ) : (
        <section className="card mt-6 px-4 py-5">
          {s ? (
            <>
              <div className="mb-4">
                <CandleChart mint={mint} />
              </div>
              <p className="font-big text-[22px] uppercase text-text">On the radar, not called</p>
              <p className="mt-1 text-sm text-muted">
                {s.callBlockers?.length ? `Still needs: ${s.callBlockers.join(", ")}.` : "Checks are still running."}
                {p ? (
                  <>
                    {" "}
                    Since it reached the radar: <XPill x={p.now} /> now, peak {multText(p.peak)}.
                  </>
                ) : null}
              </p>
            </>
          ) : fetched === undefined && remoteUrl ? (
            <p className="text-sm text-muted">Looking up this token...</p>
          ) : (
            <p className="text-sm text-muted">
              This token was never called and is not on the radar right now. The scanner only tracks a launch while it is fresh.
            </p>
          )}
        </section>
      )}

      <TokenTraders mint={mint} remoteUrl={remoteUrl} solUsd={solUsd} now={now} />

      {s && (
        <section className="card mt-5 overflow-hidden">
          <h2 className="label border-b border-line px-4 py-2.5">On-chain read</h2>
          <SignalRow s={s} now={now} solUsd={solUsd} fresh={false} call={call} detailsOnly />
        </section>
      )}

      <section className="mt-5 flex flex-wrap gap-2">
        <Ext href={`https://dexscreener.com/solana/${mint}`}>DexScreener</Ext>
        <Ext href={`https://axiom.trade/t/${mint}`}>Axiom</Ext>
        <Ext href={`https://neo.bullx.io/terminal?chainId=1399811149&address=${mint}`}>BullX</Ext>
        <Ext href={`https://gmgn.ai/sol/token/${mint}`}>GMGN</Ext>
        <Ext href={`https://pump.fun/coin/${mint}`}>Pump.fun</Ext>
        <Ext href={`https://rugcheck.xyz/tokens/${mint}`}>RugCheck</Ext>
        <Ext href={`https://solscan.io/token/${mint}`}>Solscan</Ext>
      </section>
    </div>
  );
}

function ResponsiveSpark({ row }: { row: CallRow }) {
  const [w, setW] = useState(900);
  useEffect(() => {
    const on = () => setW(Math.max(260, Math.min(1100, window.innerWidth - (window.innerWidth >= 1024 ? 330 : 60))));
    on();
    window.addEventListener("resize", on);
    return () => window.removeEventListener("resize", on);
  }, []);
  return <Spark row={row} width={w} height={150} axis />;
}

function Stat({ label, value, sub, pill, color }: { label: string; value: string; sub?: string; pill?: number; color?: string }) {
  return (
    <div className="border-b border-line px-4 py-3 sm:border-b-0">
      <span className="label block !text-[10px]">{label}</span>
      <span className="mt-1 flex items-center gap-2">
        <span className="font-big text-[30px] leading-none" style={{ color: color ?? "var(--text)" }}>
          {value}
        </span>
        {pill != null && <XPill x={pill} />}
      </span>
      {sub && <span className="mt-1 block truncate font-mono text-[10.5px] text-dim">{sub}</span>}
    </div>
  );
}

function PaperStat({ call }: { call: CallRow }) {
  const pp = call.pp;
  if (!pp) return <Stat label="Paper P&L" value="-" sub="no paper trade on this call" />;
  const v = pp.x + pp.q * (call.now / call.c);
  const state = pp.q > 0 ? (pp.tp ? "half sold at 2x, rest riding" : "open") : pp.ex === "stop" ? `stopped at ${multText(pp.x)}` : pp.ex === "trail" ? "closed on the trailing stop" : "closed after 7 days";
  return (
    <div className="border-b border-line px-4 py-3 sm:border-b-0" title={`Buy at the call, sell half at ${PAPER_RULES.tp}x, cut at ${PAPER_RULES.stop}x before that, after that sell the rest ${Math.round((1 - PAPER_RULES.trail) * 100)}% off the high, close after 7 days.`}>
      <span className="label block !text-[10px]">Paper P&amp;L</span>
      <span className="mt-1 flex items-center gap-2">
        <span className="font-big text-[30px] leading-none" style={{ color: v >= 1 ? "var(--flow)" : "var(--warn)" }}>
          {multText(v)}
        </span>
      </span>
      <span className="mt-1 block truncate font-mono text-[10.5px] text-dim">{state}</span>
    </div>
  );
}

// KOLs and smart wallets that traded this token (shared worker only).
function TokenTraders({ mint, remoteUrl, solUsd, now }: { mint: string; remoteUrl?: string; solUsd: number | null; now: number }) {
  const { data } = useTraders(remoteUrl, mint);
  if (!remoteUrl || !data || !data.moves.length) return null;
  const buyers = new Set(data.moves.filter((m) => m.k === "buy").map((m) => m.w)).size;
  return (
    <section className="card mt-5 overflow-hidden">
      <h2 className="label flex justify-between border-b border-line px-4 py-2.5">
        <span>Traders in this token</span>
        <span className="text-flow">{buyers} bought</span>
      </h2>
      <ul className="scroll-thin max-h-[320px] overflow-y-auto">
        {data.moves.map((m, i) => (
          <MoveRow key={`${m.sig ?? i}${m.w}${m.k}`} m={m} solUsd={solUsd} now={now} onOpen={() => {}} compact />
        ))}
      </ul>
    </section>
  );
}

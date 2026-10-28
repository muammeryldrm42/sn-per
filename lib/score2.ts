// Scoring for the on-chain scanner (no narrative). Every launch is watched; the ones that move get promoted to
// the radar, get the full checks, and only the best become calls.
import type { Signal, Tier } from "./types";
import { CALL_MIN_SCORE } from "./flags";

export function scoreV2(s: Signal) {
  const ageMin = (Date.now() - s.createdAt) / 60_000;
  let plus = 0;
  let penalty = 0;

  // Momentum
  const buys = s.m5Buys ?? 0;
  const sells = s.m5Sells ?? 0;
  plus += Math.min(15, buys * 0.35);
  const ratio = buys / (sells + 1);
  if (ratio > 1) plus += Math.min(8, (ratio - 1) * 6);
  if ((s.priceChange5m ?? 0) > 0) plus += Math.min(8, (s.priceChange5m ?? 0) / 10);
  if (s.launchMcapUsd && s.fdvUsd && s.fdvUsd > s.launchMcapUsd) plus += Math.min(8, Math.log2(s.fdvUsd / s.launchMcapUsd) * 3);
  if (s.rising) plus += 8;
  if ((s.curveVelPerMin ?? 0) >= 3 && (s.curvePct ?? 0) >= 20) plus += 4;
  if (s.graduated) plus += 5;

  // Smart money
  const nSmart = s.smartBuyers?.length ?? 0;
  plus += nSmart >= 3 ? 25 : nSmart === 2 ? 18 : nSmart === 1 ? 10 : 0;

  // Quality
  if (s.dexPaid) plus += s.dexPaidAt && s.dexPaidAt - s.createdAt < 30 * 60_000 ? 12 : 8;
  if ((s.boosts ?? 0) > 0) plus += 3;
  if ((s.holderGrowthPerMin ?? 0) > 0) plus += Math.min(8, s.holderGrowthPerMin ?? 0);
  if ((s.devPrevBest ?? 0) >= 100_000) plus += 5;
  if ((s.devPrevTokens ?? -1) === 0) plus += 3;
  // Backtest (811 launches): dev buys of 0.5-10 SOL ran ~1.4x more often, under 0.5 SOL ~0.6x.
  if (s.initialBuySol >= 0.5 && s.initialBuySol < 10) plus += 4;
  else if (s.initialBuySol > 0 && s.initialBuySol < 0.5) penalty += 4;
  plus += (s.twitter ? 2 : 0) + (s.website ? 1 : 0) + (s.telegram ? 1 : 0);
  if (s.lowEffort) penalty += 6;

  // Same name or ticker launched again: copies rarely run.
  penalty += Math.min(10, s.copyIndex * 3);

  // Risk
  if (s.rug.status === "ok") penalty += Math.min(25, s.rug.risks.filter((r) => r.level === "danger").length * 10);
  if (s.sells > 10 && s.sells > s.buys * 1.5) penalty += 10;
  if (s.devSold) penalty += 25;
  if (s.bundled) penalty += 10;
  const launches = s.devLaunches24h ?? 0;
  if (launches >= 6) penalty += 10;
  else if (launches >= 1) penalty += 5;
  const dumps = s.devPrevDumps ?? 0;
  if (dumps >= 2) penalty += 30;
  else if (dumps === 1) penalty += 20;
  if (s.rugged) penalty += 50;
  if ((s.top10Pct ?? 0) > 35) penalty += 15;
  if ((s.top1Pct ?? 0) > 10) penalty += 10;
  // RugCheck's insider network: what they hold matters, not how many there are. In both recordings tokens with 5+
  // insider wallets holding 15% or less did no worse than the rest (2x 19% vs 15%, under 0.2x 13% vs 29%), but the
  // old count rule threw 46 of 602 radar tokens away as junk, Frongus among them (6 insiders holding 2.6%; it ran from
  // $12K when the radar found it to $767K).
  const insiderHeavy = (s.insiderPct ?? 0) > 15;
  if (insiderHeavy) penalty += 15;
  const prev = s.devPrevTokens ?? 0;
  const serialRugger = prev >= 10 && (s.devPrevDead ?? 0) / prev >= 0.8;
  if (serialRugger) penalty += 20;
  else if (prev >= 1 && prev < 10) penalty += 5;

  const curve = s.pool === "pump" || s.pool === "bonk" || s.pool === "pumpfun";
  const thin = !curve && !!s.liquidityUsd && !!s.fdvUsd && s.liquidityUsd / s.fdvUsd < 0.05;
  if (thin) penalty += 10;

  const sinceSignal = (Date.now() - (s.promotedAt ?? s.createdAt)) / 60_000;
  const nowMc = s.fdvUsd;
  const peakMc = s.peakFdvUsd;
  const dumped = (sinceSignal > 10 && !!nowMc && !!peakMc && nowMc / peakMc < 0.35) || (sinceSignal > 3 && (s.priceChange5m ?? 0) <= -50);

  const c = s.cohort;
  const known = !!c && c.holdingsKnown !== false;
  const rugLikely =
    !!c && known && (c.combinedRiskPct >= 50 || c.bundlerHoldPct >= 25 || c.linkedCount >= 4 || (c.freshHoldPct >= 30 && c.freshCount >= 3));
  const cleanLaunch = !!c && c.cleanLaunch && !s.devSold;
  if (c && !known && c.linkedCount >= 4) penalty += 15;
  if (c && c.bundlerCount >= 10) penalty += 10;
  if (c && known) {
    if (c.combinedRiskPct >= 30) penalty += 15;
    else if (c.combinedRiskPct >= 20) penalty += 7;
    if (c.bundlerHoldPct >= 10) penalty += 10;
    if (c.sniperHoldPct >= 20) penalty += 8;
    if (c.freshHoldPct >= 15) penalty += 8;
    if (c.linkedCount >= 2) penalty += 10;
    if (cleanLaunch) plus += 8;
  }
  if (rugLikely) penalty += 25;

  const score = Math.max(0, Math.min(100, Math.round(plus - penalty)));
  const tier: Tier = score >= 65 ? "hot" : score >= 40 ? "warm" : "early";

  const dangers = s.rug.status === "ok" ? s.rug.risks.filter((r) => r.level === "danger").length : 0;
  const checks: [boolean, string][] = [
    [s.copyIndex === 0, "first token with this name"],
    [buys >= 20 || s.buyers >= 8, "real buyers coming in"],
    [!s.devSold, "dev still holding"],
    [!s.bundled, "no heavy sniping at launch"],
    [s.rug.status === "ok" && dangers === 0, "RugCheck clean"],
    [!(s.sells > 10 && s.sells > s.buys * 1.5) && !dumped, "not being dumped"],
    [!s.devSerial && !s.devKnownDumper && !serialRugger, "dev has clean history"],
    [s.top10Pct != null && s.top10Pct <= 35 && (s.top1Pct ?? 0) <= 10, "holders spread out"],
    [!insiderHeavy, "no insider network"],
    [!s.rugged, "not flagged rugged"],
    [!thin, "healthy liquidity"],
    [known && c!.combinedRiskPct < 20, "bundlers, snipers and fresh wallets hold under 20%"],
    [!!c && c.linkedCount < 2, "no wallets funded by the dev or a shared funder"],
  ];
  const strong = checks.every(([ok]) => ok);

  const junk =
    !!s.rugged ||
    !!s.devKnownDumper ||
    serialRugger ||
    insiderHeavy ||
    !!s.devSold ||
    rugLikely ||
    (ageMin > 8 && score < 15) ||
    dumped;

  return {
    score,
    tier,
    strong,
    junk,
    dumpedFromPeak: dumped,
    thinLiquidity: thin,
    rugLikely,
    cleanLaunch,
    strongChecks: checks.map(([ok, label]) => ({ label, ok })),
  };
}

// Previous gate (score 60 + wallet read + RugCheck + evidence). Kept for reference; the live gate is callBlockers below.
export function callBlockersLegacy(s: Signal): string[] {
  const out: string[] = [];
  const c = s.cohort;
  if (!c) out.push("wallets not read yet");
  else {
    if (c.holdingsKnown === false) out.push("wallet balances unreadable");
    if (c.combinedRiskPct >= 30) out.push("risk wallets hold 30%+");
    if (c.bundlerHoldPct >= 15) out.push("bundlers hold 15%+");
  }
  if (s.rugLikely) out.push("rug likely");
  if (s.junk) out.push("junk");
  if (s.rug.status !== "ok") out.push("RugCheck not in yet");
  if (s.score < (CALL_MIN_SCORE || 60)) out.push(`score under ${CALL_MIN_SCORE || 60}`);
  const evidence = s.rising || (s.smartBuyers?.length ?? 0) >= 1 || ((s.curveVelPerMin ?? 0) >= 3 && (s.curvePct ?? 0) >= 20) || s.strong;
  if (!evidence) out.push("no strong evidence yet (rising, smart wallets, fast curve or strong)");
  return out;
}

// ---------------------------------------------------------------------------------------------------------
// Call gate v3, from a 2 hour live recording of 214 radar tokens (every 15 s) and what they did in the next
// 45 min. What it showed:
//  - Calls on launch momentum alone hit 2x ~25% of the time and most were back under the call price within the
//    hour (median 0.5x). Waiting for the wallet read and RugCheck before calling made it worse, the move was over.
//  - Tokens that already proved themselves did much better: graduated pump.fun tokens, 5x+ runners still holding
//    their highs, and tokens 2+ smart wallets bought: ~35-40% hit 2x, and the median call was still at ~1x
//    after 45 min instead of 0.5x.
//  - Dev sold (3%), dumped from peak (3%), DEX paid profiles alone (13%) were all below the 16% base rate.
// So a call needs one of three proofs plus health checks. The wallet read and RugCheck are vetoes when they are
// in, but the call does not wait for them. Launch momentum, fast curves and DEX paid only put tokens on the radar.

export type CallPath = "graduated" | "graduating" | "runner" | "smart";
export const CALL_PATH_LABEL: Record<CallPath, string> = {
  graduated: "Graduated",
  graduating: "Graduating",
  runner: "Runner",
  smart: "Smart money",
};

// Graduating: pump.fun curve 75%+ full and still on the curve. In the recording the 75-95% band was the best
// curve bucket (~40% hit 2x), and it is where the graduation move starts.
// Off by default: on the second (unseen) recording the 75%+ curve calls went 0 for 5 at 2x, 2 of 10 over both
// recordings, which is the base rate. Set GRADUATING_PCT=75 to turn it back on.
const GRADUATING_PCT = Number(process.env.NEXT_PUBLIC_GRADUATING_PCT || process.env.GRADUATING_PCT || 0);

const RUNNER_X = Number(process.env.NEXT_PUBLIC_RUNNER_X || process.env.RUNNER_X || 5);
const RUNNER_MIN_USD = Number(process.env.NEXT_PUBLIC_RUNNER_MIN_USD || process.env.RUNNER_MIN_USD || 30_000);

export function callPath(s: Signal, now = Date.now()): CallPath | null {
  const ageMin = (now - s.createdAt) / 60_000;
  // Graduated: real post-migration price only (right after migration some feeds print a tiny market cap).
  if (s.graduated && s.marketCapSol >= 150 && ageMin < 60) return "graduated";
  if (GRADUATING_PCT > 0 && !s.graduated && s.pool === "pump" && (s.curvePct ?? 0) >= GRADUATING_PCT && (s.curvePct ?? 0) < 100 && ageMin < 60) return "graduating";
  if (!s.graduated && s.launchMcapUsd && s.fdvUsd && s.fdvUsd / s.launchMcapUsd >= RUNNER_X && s.fdvUsd >= RUNNER_MIN_USD && ageMin < 45)
    return "runner";
  // Two independent smart wallets or KOLs, with real buying around them (30+ buys in 5 min held up out of sample).
  if ((s.smartBuyers?.length ?? 0) >= 2 && (s.m5Buys ?? 0) >= 30) return "smart";
  return null;
}

// Anti-rug seasoning, from both live recordings together (3.6 h, 601 radar tokens, 191 decision points on healthy
// tokens over $15K): tokens under 2 min old ended under 0.2x within 45 min 47% of the time, under 5 min 37% (48% for
// young copycats of a name already launched), 5 min and older 18%. Launch to migration in 1-2 minutes is mostly a
// bundled launch that dumps on the new pool. Inside the proof paths the sample is small (20 calls) and waiting
// longer than ~3 minutes did not lower the rug rate further, it only cut calls, so the defaults are: no call in the
// first 3 minutes, and a fast mover is never called before the wallet read (bundle check) is in.
// CALL_GRAD_HOLD_MIN makes a graduated token hold on its pool for that many minutes first (off by default).
const CALL_MIN_AGE_MIN = Number(process.env.NEXT_PUBLIC_CALL_MIN_AGE_MIN || process.env.CALL_MIN_AGE_MIN || 3);
const CALL_GRAD_HOLD_MIN = Number(process.env.NEXT_PUBLIC_CALL_GRAD_HOLD_MIN || process.env.CALL_GRAD_HOLD_MIN || 0);
const INSTANT_GRAD_MIN = 3;

export function callBlockers(s: Signal, now = Date.now()): string[] {
  const out: string[] = [];
  const path = callPath(s, now);
  if (!path) out.push("needs a proof: graduation, a 5x run or 2+ smart wallets with 30+ buys");
  const ageMin = (now - s.createdAt) / 60_000;
  if (ageMin < CALL_MIN_AGE_MIN) out.push(`too new: under ${CALL_MIN_AGE_MIN} min old, most rugs happen here`);
  if (CALL_GRAD_HOLD_MIN > 0 && path === "graduated" && s.graduatedAt && (now - s.graduatedAt) / 60_000 < CALL_GRAD_HOLD_MIN)
    out.push(`just graduated: holding ${CALL_GRAD_HOLD_MIN} min on the pool first`);
  // Fast movers: launch to migration in under 3 minutes, or a proof while still under 6 minutes old. That is the
  // classic bundled launch, so it is never called blind: the wallet read (bundlers, snipers and what they still
  // hold) has to be in first. It runs first in line as soon as the proof shows, during the age wait.
  const ci = s.cohort;
  const instantGrad = path === "graduated" && !!s.graduatedAt && s.graduatedAt - s.createdAt < INSTANT_GRAD_MIN * 60_000;
  if (path && (instantGrad || ageMin < 6) && (!ci || ci.holdingsKnown === false))
    out.push(instantGrad ? "instant graduation: needs the wallet read (bundle check)" : "fast mover: needs the wallet read (bundle check)");
  // Health, from fast data
  if (s.devSold) out.push("dev sold");
  if (s.junk) out.push("failed checks");
  if (s.dumpedFromPeak) out.push("dumped from peak");
  if (s.fdvUsd && s.peakFdvUsd && s.fdvUsd / s.peakFdvUsd < 0.8) out.push("more than 20% off its high");
  const buys = s.m5Buys ?? 0;
  const sells = s.m5Sells ?? 0;
  if (buys < sells + 1) out.push("more sells than buys (5 min)");
  if ((s.priceChange5m ?? 0) < 0) out.push("price falling (5 min)");
  // Real trading (Gem Bot's "barely any trading" check): a market cap that was never traded into is not real.
  // Volume since launch should be at least ~30% of the market cap; fake caps sit far below that.
  if (s.volume24h != null && s.fdvUsd && s.volume24h < s.fdvUsd * 0.3) out.push("barely any trading for its market cap");
  // Vetoes from slower checks, only once they are in
  if (s.rugLikely) out.push("rug signs in wallets");
  const c = s.cohort;
  if (c && c.holdingsKnown !== false) {
    if (c.combinedRiskPct >= 30) out.push("risk wallets hold 30%+");
    if (c.bundlerHoldPct >= 15) out.push("bundlers hold 15%+");
  }
  if (s.rugged) out.push("flagged rugged");
  if (s.rug.status === "ok" && s.rug.risks.some((r) => r.level === "danger" && /rugged|creator history/i.test(r.name)))
    out.push("creator has rugged before");
  if (CALL_MIN_SCORE > 0 && s.score < CALL_MIN_SCORE) out.push(`score under ${CALL_MIN_SCORE}`);
  return out;
}

// One line on why the call was made, from the data at the moment of the call.
export function callWhy(s: Signal, path: CallPath, solUsd: number | null, now = Date.now()): string {
  const age = Math.max(0, Math.round((now - s.createdAt) / 60_000));
  const flow = `${s.m5Buys ?? 0} buys vs ${s.m5Sells ?? 0} sells in 5 min, ${(s.priceChange5m ?? 0) >= 0 ? "+" : ""}${Math.round(s.priceChange5m ?? 0)}%`;
  const mc = s.fdvUsd ?? (solUsd ? s.marketCapSol * solUsd : 0);
  const k = mc >= 1e6 ? `$${(mc / 1e6).toFixed(2)}M` : `$${Math.round(mc / 1000)}K`;
  if (path === "graduated") {
    const g = s.graduatedAt ? Math.max(0, Math.round((s.graduatedAt - s.createdAt) / 60_000)) : null;
    return `Graduated${g != null ? ` ${g} min after launch` : ""}, holding at ${k}, ${flow}`;
  }
  if (path === "graduating") {
    return `Bonding curve ${Math.round(s.curvePct ?? 0)}% full ${age} min after launch${
      s.curveVelPerMin && s.curveVelPerMin > 0 ? `, filling ${s.curveVelPerMin.toFixed(1)}% a minute` : ""
    }, ${k}, ${flow}`;
  }
  if (path === "runner") {
    const x = s.launchMcapUsd && s.fdvUsd ? s.fdvUsd / s.launchMcapUsd : 0;
    return `${x.toFixed(1)}x since launch ${age} min ago and holding near its high at ${k}, ${flow}`;
  }
  return `${s.smartBuyers?.length ?? 0} smart wallets bought, ${k}, ${flow}`;
}

// Grade at the call. Solid: the wallet read and RugCheck were both in and clean. Risky: called before they were
// in (speed first) or with a soft warning. The track record shows both groups separately.
export function callGrade(s: Signal): "solid" | "risky" {
  const c = s.cohort;
  const walletsOk = !!c && c.holdingsKnown !== false && c.combinedRiskPct < 20 && c.linkedCount < 2;
  const rugOk = s.rug.status === "ok" && !s.rug.risks.some((r) => r.level === "danger");
  const holdersOk = s.top10Pct == null || s.top10Pct <= 35;
  return walletsOk && rugOk && holdersOk && !s.devKnownDumper && !s.devSerial ? "solid" : "risky";
}

// The checks behind a call in plain words, as they stood at the moment of the call.
export function callReasons(s: Signal): string[] {
  const out: string[] = [];
  const b = s.m5Buys ?? 0;
  const se = s.m5Sells ?? 0;
  out.push(`${b} buys vs ${se} sells in the last 5 min${se ? ` (${(b / se).toFixed(1)}x)` : ""}`);
  if (s.priceChange5m != null) out.push(`Price ${s.priceChange5m >= 0 ? "+" : ""}${Math.round(s.priceChange5m)}% over 5 min`);
  if (s.fdvUsd && s.peakFdvUsd) out.push(`${Math.round((s.fdvUsd / s.peakFdvUsd) * 100)}% of its high since the radar`);
  if (s.volume24h != null && s.fdvUsd) out.push(`Traded ${Math.round((s.volume24h / s.fdvUsd) * 100)}% of its market cap since launch (real trading)`);
  if (s.initialBuyTokens) out.push(s.devSold ? "Dev sold" : s.devHeldPct != null ? `Dev holds ${Math.round(s.devHeldPct * 100)}% of the initial buy` : "Dev has not sold");
  const c = s.cohort;
  if (!c) out.push("Wallet read still running");
  else if (c.holdingsKnown === false) out.push(`${c.bundlerCount} bundlers, ${c.sniperCount} snipers (balances unreadable)`);
  else out.push(`Bundlers, snipers, fresh and linked wallets hold ${c.combinedRiskPct}%`);
  if ((s.smartBuyers?.length ?? 0) > 0) out.push(`${s.smartBuyers!.length} smart wallet${s.smartBuyers!.length === 1 ? "" : "s"} or KOL${s.smartBuyers!.length === 1 ? "" : "s"} among the buyers`);
  if ((c?.fomoBuyers ?? 0) > 0) out.push(`${c!.fomoBuyers} early buyers came through the Fomo app`);
  if (s.rug.status === "ok") {
    const d = s.rug.risks.filter((r) => r.level === "danger").length;
    out.push(d ? `RugCheck: ${d} warning${d === 1 ? "" : "s"}` : "RugCheck: no risks");
  } else out.push("RugCheck report not in yet");
  if (s.top10Pct != null) out.push(`Top 10 holders own ${s.top10Pct}%${s.holders ? `, ${s.holders} holders` : ""}`);
  if (s.devPrevTokens != null) out.push(s.devPrevTokens === 0 ? "Dev's first launch" : `Dev launched ${s.devPrevTokens} tokens before, ${s.devPrevDead ?? 0} dead`);
  return out.slice(0, 9);
}

// ---------------------------------------------------------------------------------------------------------
// Fresh launch tier (ultra risky, separate feed and track record; never mixed into the main calls or their stats).
// Called in the first 3 minutes, on the bonding curve, before any proof. From both live recordings (3.6 h,
// 601 radar tokens), first moment a young radar token matched, outcome over the next 45 minutes:
//  - every healthy token under 3 min and $6K+: 24% hit 2x, 20% ended under 0.2x
//  - this rule: 30 calls, 40% hit 2x (50% on the first recording, 36% on the second), none under 0.2x, but most
//    fell back to ~0.4x when not sold. Entry low on the curve bounds the downside (the curve floor is ~$3K).
// What the rule keeps and why (both recordings agreed on each):
//  - curve 65% full or less: above that it went 11% at 2x (the move is mostly done)
//  - dev's own first buy under 1 SOL: bigger dev buys went 12% at 2x (dev sells into the buyers)
//  - 2x+ since launch with buys at least 1.5x sells over 5 min: real demand, not one wallet
const EARLY_ON = (process.env.NEXT_PUBLIC_EARLY_CALLS || process.env.EARLY_CALLS || "1") !== "0";
const EARLY_MAX_AGE_MIN = Number(process.env.NEXT_PUBLIC_EARLY_MAX_AGE_MIN || process.env.EARLY_MAX_AGE_MIN || 3);
const EARLY_MIN_USD = Number(process.env.NEXT_PUBLIC_EARLY_MIN_USD || process.env.EARLY_MIN_USD || 6000);
const EARLY_MAX_USD = Number(process.env.NEXT_PUBLIC_EARLY_MAX_USD || process.env.EARLY_MAX_USD || 16000);
const EARLY_MAX_CURVE = Number(process.env.NEXT_PUBLIC_EARLY_MAX_CURVE || process.env.EARLY_MAX_CURVE || 65);
const EARLY_MAX_DEV_SOL = Number(process.env.NEXT_PUBLIC_EARLY_MAX_DEV_SOL || process.env.EARLY_MAX_DEV_SOL || 1);
// The rule matches ~8 launches an hour; the cap only guards against a flood.
export const EARLY_MAX_PER_HOUR = Number(process.env.NEXT_PUBLIC_EARLY_MAX_PER_HOUR || process.env.EARLY_MAX_PER_HOUR || 15);
export const EARLY_MAX_PER_DAY = Number(process.env.NEXT_PUBLIC_EARLY_MAX_PER_DAY || process.env.EARLY_MAX_PER_DAY || 300);
export const EARLY_ENABLED = EARLY_ON;
export const EARLY_WINDOW_MS = EARLY_MAX_AGE_MIN * 60_000;

export function earlyBlockers(s: Signal, now = Date.now()): string[] {
  const out: string[] = [];
  if (now - s.createdAt >= EARLY_MAX_AGE_MIN * 60_000) out.push(`older than ${EARLY_MAX_AGE_MIN} min`);
  if (s.graduated) out.push("already graduated");
  const mc = s.fdvUsd ?? 0;
  if (mc < EARLY_MIN_USD) out.push(`under $${EARLY_MIN_USD / 1000}K`);
  if (mc > EARLY_MAX_USD) out.push(`over $${EARLY_MAX_USD / 1000}K`);
  if (!s.launchMcapUsd || mc / s.launchMcapUsd < 2) out.push("not 2x since launch");
  if ((s.m5Buys ?? 0) < 1.5 * ((s.m5Sells ?? 0) + 1)) out.push("buys not 1.5x sells");
  if (s.curvePct != null && s.curvePct > EARLY_MAX_CURVE) out.push(`curve over ${EARLY_MAX_CURVE}%`);
  if ((s.initialBuySol ?? 0) >= EARLY_MAX_DEV_SOL) out.push(`dev bought ${EARLY_MAX_DEV_SOL}+ SOL`);
  if (s.devSold) out.push("dev sold");
  if (s.junk) out.push("failed checks");
  if (s.dumpedFromPeak) out.push("dumped from peak");
  if (s.rugLikely || s.rugged) out.push("rug signs");
  if (s.rug.status === "ok" && s.rug.risks.some((r) => r.level === "danger" && /rugged|creator history/i.test(r.name))) out.push("creator has rugged before");
  const c = s.cohort;
  if (c && c.holdingsKnown !== false && (c.combinedRiskPct >= 30 || c.bundlerHoldPct >= 15)) out.push("bundled launch");
  return out;
}

export function earlyWhy(s: Signal, now = Date.now()): string {
  const sec = Math.max(0, Math.round((now - s.createdAt) / 1000));
  const t = sec < 60 ? `${sec}s` : `${Math.floor(sec / 60)}m ${sec % 60}s`;
  const x = s.launchMcapUsd && s.fdvUsd ? s.fdvUsd / s.launchMcapUsd : 0;
  const mc = s.fdvUsd ?? 0;
  return `Fresh launch ${t} old, ${x.toFixed(1)}x since launch at $${(mc / 1000).toFixed(1)}K, curve ${Math.round(s.curvePct ?? 0)}% full, ${s.m5Buys ?? 0} buys vs ${s.m5Sells ?? 0} sells, dev bought ${(s.initialBuySol ?? 0).toFixed(2)} SOL`;
}

// ---------------------------------------------------------------------------------------------------------
// Ultra risky tier: launches over $6K in their first 3 minutes, before any proof, with the three cuts both recordings
// agreed on. Every healthy launch over $6K (the first version, ~1,080 a day): 23% hit 2x, 21% ended under 0.2x within
// 45 min, and following them all lost money (0.96x on average with the paper exit plan). With the cuts below
// (40 calls, ~270 a day): 35% hit 2x, 8% ended under 0.2x, 1.08x on average. The cuts:
//  - 2x+ since launch and more buys than sells (5 min): the launch is being bought, not just printed
//  - bonding curve 80% full or less: later than that the move is mostly done
//  - the dev's own first buy under 1 SOL: bigger dev buys get sold into the first buyers
// The first version keeps running in the public lab ("Ultra, every launch") so the difference stays measured.
const ULTRA_ON = (process.env.NEXT_PUBLIC_ULTRA_CALLS || process.env.ULTRA_CALLS || "1") !== "0";
const ULTRA_MIN_USD = Number(process.env.NEXT_PUBLIC_ULTRA_MIN_USD || process.env.ULTRA_MIN_USD || 6000);
export const ULTRA_ENABLED = ULTRA_ON;
export const ULTRA_MAX_PER_HOUR = Number(process.env.NEXT_PUBLIC_ULTRA_MAX_PER_HOUR || process.env.ULTRA_MAX_PER_HOUR || 40);
export const ULTRA_MAX_PER_DAY = Number(process.env.NEXT_PUBLIC_ULTRA_MAX_PER_DAY || process.env.ULTRA_MAX_PER_DAY || 600);

const ULTRA_MAX_CURVE = Number(process.env.NEXT_PUBLIC_ULTRA_MAX_CURVE || process.env.ULTRA_MAX_CURVE || 80);

// The first ultra rule, kept for the lab: every healthy launch over $6K in its first 3 minutes.
export function ultraAllBlockers(s: Signal, now = Date.now()): string[] {
  const out: string[] = [];
  if (now - s.createdAt >= EARLY_MAX_AGE_MIN * 60_000) out.push(`older than ${EARLY_MAX_AGE_MIN} min`);
  if (s.graduated) out.push("already graduated");
  if ((s.fdvUsd ?? 0) < ULTRA_MIN_USD) out.push(`under $${ULTRA_MIN_USD / 1000}K`);
  if (s.devSold) out.push("dev sold");
  if (s.junk) out.push("failed checks");
  if (s.dumpedFromPeak) out.push("dumped from peak");
  if (s.rugLikely || s.rugged) out.push("rug signs");
  if (s.rug.status === "ok" && s.rug.risks.some((r) => r.level === "danger" && /rugged|creator history/i.test(r.name))) out.push("creator has rugged before");
  const c = s.cohort;
  if (c && c.holdingsKnown !== false && (c.combinedRiskPct >= 30 || c.bundlerHoldPct >= 15)) out.push("bundled launch");
  return out;
}

export function ultraBlockers(s: Signal, now = Date.now()): string[] {
  const out: string[] = [];
  if (now - s.createdAt >= EARLY_MAX_AGE_MIN * 60_000) out.push(`older than ${EARLY_MAX_AGE_MIN} min`);
  if (s.graduated) out.push("already graduated");
  if ((s.fdvUsd ?? 0) < ULTRA_MIN_USD) out.push(`under $${ULTRA_MIN_USD / 1000}K`);
  const mc = s.fdvUsd ?? 0;
  if (!s.launchMcapUsd || mc / s.launchMcapUsd < 2) out.push("not 2x since launch");
  if ((s.m5Buys ?? 0) < (s.m5Sells ?? 0) + 1) out.push("more sells than buys (5 min)");
  if (s.curvePct != null && s.curvePct > ULTRA_MAX_CURVE) out.push(`curve over ${ULTRA_MAX_CURVE}%`);
  if ((s.initialBuySol ?? 0) >= EARLY_MAX_DEV_SOL) out.push(`dev bought ${EARLY_MAX_DEV_SOL}+ SOL`);
  if (s.devSold) out.push("dev sold");
  if (s.junk) out.push("failed checks");
  if (s.dumpedFromPeak) out.push("dumped from peak");
  if (s.rugLikely || s.rugged) out.push("rug signs");
  if (s.rug.status === "ok" && s.rug.risks.some((r) => r.level === "danger" && /rugged|creator history/i.test(r.name))) out.push("creator has rugged before");
  const c = s.cohort;
  if (c && c.holdingsKnown !== false && (c.combinedRiskPct >= 30 || c.bundlerHoldPct >= 15)) out.push("bundled launch");
  return out;
}

export function ultraWhy(s: Signal, now = Date.now()): string {
  const sec = Math.max(0, Math.round((now - s.createdAt) / 1000));
  const t = sec < 60 ? `${sec}s` : `${Math.floor(sec / 60)}m ${sec % 60}s`;
  const mc = s.fdvUsd ?? 0;
  const x = s.launchMcapUsd && mc ? `, ${(mc / s.launchMcapUsd).toFixed(1)}x since launch` : "";
  return `Launch ${t} old at $${(mc / 1000).toFixed(1)}K${x}, ${s.m5Buys ?? 0} buys vs ${s.m5Sells ?? 0} sells`;
}

// Launch numbers stored with every call (Gem Bot shows "bundled X%, sniped Y% at first call"): what launch bundles,
// snipers and fresh wallets still hold, the dev's own first buy as a share of supply, linked wallets.
export function launchStats(s: Signal) {
  const c = s.cohort;
  const known = !!c && c.holdingsKnown !== false;
  const r1 = (x: number) => Math.round(x * 10) / 10;
  const L = s.launch;
  return {
    ...(L ? { bp: L.bundlePct, sp: L.snipedPct } : {}),
    ...(known ? { fw: r1(c!.freshHoldPct), lk: c!.linkedCount } : {}),
    ...(s.initialBuyTokens ? { cb: r1((s.initialBuyTokens / 1e9) * 100) } : L ? { cb: L.devPct } : {}),
    ...(s.volume24h != null ? { vol: Math.round(s.volume24h) } : {}),
  };
}

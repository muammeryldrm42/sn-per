import type { Signal, Tier } from "./types";

export function scoreSignal(s: Signal): {
  score: number;
  tier: Tier;
  strong: boolean;
  junk: boolean;
  dumpedFromPeak: boolean;
  thinLiquidity: boolean;
  rugLikely: boolean;
  cleanLaunch: boolean;
  strongChecks: { label: string; ok: boolean }[];
} {
  const narrative = Math.min(50, 12 * Math.log2(1 + s.narrativeWeight) * s.matchStrength);

  const streamTraction = s.buyers * 1.5 + Math.max(0, s.netSol) * 2;
  const dexTraction = (s.m5Buys ?? 0) * 0.3;
  const traction = Math.min(35, Math.max(streamTraction, dexTraction));

  // Backtest: an X link at launch did not raise the 2x rate (7.6% vs 8.7% base), so socials weigh little.
  const social = (s.twitter ? 2 : 0) + (s.website ? 1 : 0) + (s.telegram ? 1 : 0);

  // A narrative seen on several independent sources is far more reliable than a single headline.
  const nSources = s.matchSources.length;
  const confirm = nSources >= 3 ? 12 : nSources >= 2 ? 8 : 0;

  let penalty = Math.min(15, s.copyIndex * 5);
  if (s.rug.status === "ok") {
    const danger = s.rug.risks.filter((r) => r.level === "danger").length;
    penalty += Math.min(25, danger * 10);
  }
  if (s.sells > 10 && s.sells > s.buys * 1.5) penalty += 10;
  if (s.devSold) penalty += 25;
  if (s.bundled) penalty += 10;
  if (s.matchKind === "fuzzy") penalty += 5;

  // Momentum: is it moving right now, not just how much it moved in total.
  let momentum = Math.min(10, (s.buyers1m ?? 0) * 1.5);
  if ((s.mcapChange5m ?? 0) > 0) momentum += Math.min(5, (s.mcapChange5m ?? 0) / 20);
  if (s.rising) momentum += 8;
  momentum += Math.min(6, (s.whaleBuys ?? 0) * 3);
  if (s.freshNarrative) momentum += 8;
  if (s.graduated) momentum += 5;
  if (s.buyers >= 5 && (s.top3Share ?? 0) > 0.6) penalty += 10;

  // Dev history
  const launches = s.devLaunches24h ?? 0;
  // Backtest: many launches in a short window alone made no difference, the dead-token record does.
  // Three runs: a dev with other launches in the same window reached 2x at 0.68x the average (n=437).
  if (launches >= 6) penalty += 10;
  else if (launches >= 1) penalty += 5;
  const dumps = s.devPrevDumps ?? 0;
  if (dumps >= 2) penalty += 30;
  else if (dumps === 1) penalty += 20;

  // Holder structure (RugCheck full report)
  if (s.rugged) penalty += 50;
  if ((s.top10Pct ?? 0) > 35) penalty += 15;
  if ((s.top1Pct ?? 0) > 10) penalty += 10;
  const insiderHeavy = (s.insiderPct ?? 0) > 15 || (s.insiders ?? 0) >= 5;
  if (insiderHeavy) penalty += 15;

  // Dev track record across all launches, not just the ones this browser saw
  const prev = s.devPrevTokens ?? 0;
  const deadRatio = prev ? (s.devPrevDead ?? 0) / prev : 0;
  const serialRugger = prev >= 10 && deadRatio >= 0.8;
  if (serialRugger) penalty += 20;
  // Two runs: devs with 1-9 earlier launches reached 2x at 6.5% vs 11% for first-time devs.
  else if (prev >= 1 && prev < 10) penalty += 5;
  if ((s.devPrevBest ?? 0) >= 100_000) momentum += 5;

  if (s.matchGeneric) penalty += 5;

  // Quality signals
  if (s.dexPaid) {
    momentum += 10;
    if (s.dexPaidAt && s.dexPaidAt - s.createdAt < 30 * 60_000) momentum += 5;
  }
  if ((s.boosts ?? 0) > 0) momentum += 3;
  if ((s.holderGrowthPerMin ?? 0) > 0) momentum += Math.min(10, s.holderGrowthPerMin ?? 0);
  if (s.lowEffort) penalty += 10;

  // Backtest: dev buys of 0.5-2 SOL reached 2x at 13.8% vs 6.2% for under 0.5 SOL and 5.4% for 2-10 SOL.
  // Three runs (811 launches): dev buys of 0.5-2 SOL and 2-10 SOL both reached 2x ~1.43x more often than average.
  if (s.origin === "pumpportal" && s.initialBuySol >= 0.5 && s.initialBuySol < 10) momentum += 4;
  // Two runs (554 launches): dev buys under 0.5 SOL reached 2x at 6.5% vs 9.7% base, same direction both times.
  else if (s.origin === "pumpportal" && s.initialBuySol > 0 && s.initialBuySol < 0.5) penalty += 4;

  // Copy of a token that already exists and trends: rarely a new run.
  // Backtest: copies of live tokens 0/5 reached 2x, real narrative matches 2/8.
  if (s.copycat) penalty += 20;

  // Launched within an hour of the narrative first appearing: first mover on a new story.
  const narrAgeMin = s.narrativeFirstSeen ? (s.createdAt - s.narrativeFirstSeen) / 60_000 : null;
  if (narrAgeMin != null && narrAgeMin <= 60) momentum += 6;

  // Thin pool on a normal AMM (launchpad curves are excluded): easy to pull, easy to push around.
  const curve = s.pool === "pump" || s.pool === "bonk" || s.pool === "pumpfun";
  const thin = !curve && !!s.liquidityUsd && !!s.fdvUsd && s.liquidityUsd / s.fdvUsd < 0.05;
  if (thin) penalty += 10;

  // Already pumped and dumped: under 35% of its peak after 10 min, or down 50%+ in 5 min.
  const ageMinutes = (Date.now() - s.createdAt) / 60_000;
  const nowMc = s.mcapAtSignal && s.marketCapSol ? s.marketCapSol : s.fdvUsd;
  const peakMc = s.mcapAtSignal && s.marketCapSol ? s.peakMcapSol : s.peakFdvUsd;
  const dumped =
    (ageMinutes > 10 && !!nowMc && !!peakMc && nowMc / peakMc < 0.35) || (ageMinutes > 3 && (s.priceChange5m ?? 0) <= -50);

  // Wallet cohorts: how much of the supply sits with bundlers, snipers, fresh and linked wallets.
  const c = s.cohort;
  const known = !!c && c.holdingsKnown !== false;
  const rugLikely =
    !!c && known && (c.combinedRiskPct >= 50 || c.bundlerHoldPct >= 25 || c.linkedCount >= 4 || (c.freshHoldPct >= 30 && c.freshCount >= 3));
  const cleanLaunch = !!c && c.cleanLaunch && !s.devSold;
  if (c && !known && c.linkedCount >= 4) penalty += 15;
  if (c && c.bundlerCount >= 10) penalty += 10; // heavily bundled launch, whatever is still held
  if (c && known) {
    if (c.combinedRiskPct >= 30) penalty += 15;
    else if (c.combinedRiskPct >= 20) penalty += 7;
    if (c.bundlerHoldPct >= 10) penalty += 10;
    if (c.sniperHoldPct >= 20) penalty += 8;
    if (c.freshHoldPct >= 15) penalty += 8;
    if (c.linkedCount >= 2) penalty += 10;
    if (cleanLaunch) momentum += 6;
  }
  if (rugLikely) penalty += 25;

  // Smart wallets (learned from past winners) among the early buyers. Not backtested yet.
  const nSmart = s.smartBuyers?.length ?? 0;
  if (nSmart >= 3) momentum += 18;
  else if (nSmart === 2) momentum += 12;
  else if (nSmart === 1) momentum += 6;

  // Bonding curve filling fast: on pace to graduate.
  if ((s.curveVelPerMin ?? 0) >= 3 && (s.curvePct ?? 0) >= 20) momentum += 4;

  // Called by followed Telegram channels (not backtested yet, kept modest).
  const nCallers = s.callers?.length ?? 0;
  if (nCallers >= 3) momentum += 12;
  else if (nCallers === 2) momentum += 8;
  else if (nCallers === 1) momentum += 4;

  const score = Math.max(0, Math.min(100, Math.round(narrative + traction + social + confirm + momentum - penalty)));
  const tier: Tier = score >= 65 ? "hot" : score >= 40 ? "warm" : "early";

  // "Strong" = every safety box ticked, not just a high number.
  const dangers = s.rug.status === "ok" ? s.rug.risks.filter((r) => r.level === "danger").length : 0;
  const traded = s.buyers >= 8 || (s.m5Buys ?? 0) >= 20;
  const checks: [boolean, string][] = [
    [s.copyIndex === 0, "first token on this narrative"],
    [nSources >= 2 || s.narrativeWeight >= 6, "multi-source or heavy trend"],
    [s.matchKind === "exact" || s.matchKind === "word" || s.matchKind === "contains", "clean name match"],
    [traded, "real buyers coming in"],
    [!s.devSold, "dev still holding"],
    [!s.bundled, "no heavy sniping at launch"],
    [s.rug.status === "ok" && dangers === 0, "RugCheck clean"],
    [!(s.sells > 10 && s.sells > s.buys * 1.5), "not being dumped"],
    [!(s.buyers >= 5 && (s.top3Share ?? 0) > 0.6), "buying spread across wallets"],
    [!s.devSerial && !s.devKnownDumper && !serialRugger, "dev has clean history"],
    [s.top10Pct != null && s.top10Pct <= 35 && (s.top1Pct ?? 0) <= 10, "holders spread out"],
    [!insiderHeavy, "no insider network"],
    [!s.rugged, "not flagged rugged"],
    [!s.matchGeneric, "specific narrative, not an everyday word"],
    [!s.lowEffort, "has socials or a description"],
    [!s.copycat, "new narrative, not a copy of a live token"],
    [!thin, "healthy liquidity"],
    [known && c!.combinedRiskPct < 20, "bundlers, snipers and fresh wallets hold under 20%"],
    [!!c && c.linkedCount < 2, "no wallets funded by the dev or a shared funder"],
  ];
  const strong = checks.every(([ok]) => ok);

  // Junk: clearly bad or dead signals, hidden from the feed by default.
  const ageMin = (Date.now() - s.createdAt) / 60_000;
  const junk =
    !!s.rugged ||
    !!s.devKnownDumper ||
    serialRugger ||
    insiderHeavy ||
    !!s.devSold ||
    !!s.lowEffort ||
    rugLikely ||
    (ageMin > 5 && score < 20) ||
    (ageMin > 15 && s.rug.status === "ok" && (s.holders ?? 0) < 15 && !s.rising) ||
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

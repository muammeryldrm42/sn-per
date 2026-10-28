import type { NarrativeTerm } from "./narrative";
import type { Cohort } from "./cohort";

export interface SourceStatus {
  id: string;
  label: string;
  ok: boolean;
  count: number;
  error?: string;
}

export interface NarrativesResponse {
  terms: NarrativeTerm[];
  sources: SourceStatus[];
  solUsd: number | null;
  updatedAt: number;
}

export interface RugRisk {
  name: string;
  level: string;
  description?: string;
}

export interface RugInfo {
  status: "pending" | "ok" | "unavailable";
  score?: number;
  risks: RugRisk[];
}

export type Tier = "hot" | "warm" | "early";
export type MatchKind = "exact" | "word" | "contains" | "fuzzy";

export interface Signal {
  mint: string;
  name: string;
  symbol: string;
  pool: string;
  origin: "pumpportal" | "dexprofile";
  creator?: string;
  createdAt: number;
  uri?: string;

  matchedTerm: string;
  matchedDisplay: string;
  matchContext: string;
  matchSources: string[];
  matchKind: MatchKind;
  matchStrength: number;
  narrativeWeight: number;
  copyIndex: number;

  initialBuySol: number;
  marketCapSol: number;
  buys: number;
  sells: number;
  buyers: number;
  netSol: number;
  lastTradeAt?: number;

  fdvUsd?: number;
  liquidityUsd?: number;
  m5Buys?: number;
  m5Sells?: number;

  description?: string;
  image?: string;
  twitter?: string;
  telegram?: string;
  website?: string;

  rug: RugInfo;
  score: number;
  tier: Tier;

  // quality checks
  devSold?: boolean;
  devSoldSol?: number;
  earlyBuys?: number;
  bundled?: boolean;
  strong?: boolean;
  strongChecks?: { label: string; ok: boolean }[];

  // momentum (computed from the live trade stream)
  buyers1m?: number;
  buyers5m?: number;
  netSol1m?: number;
  netSol5m?: number;
  mcapChange5m?: number; // percent
  rising?: boolean;
  risingSince?: number;
  whaleBuys?: number;
  top3Share?: number; // 0..1 share of buy SOL from the 3 biggest buyers
  curvePct?: number; // pump.fun bonding curve progress 0..100
  freshNarrative?: boolean;
  trackedUntil?: number;

  // performance since the signal fired
  mcapAtSignal?: number; // SOL
  peakMcapSol?: number;
  fdvAtSignal?: number; // USD, for DexScreener sourced tokens
  peakFdvUsd?: number;

  // dev history (built from every launch this browser has seen, plus RPC balance checks)
  initialBuyTokens?: number;
  devHeldPct?: number; // share of the dev's initial buy still held, 0..1
  devLaunches24h?: number; // other tokens this dev launched in the last 24h
  devPrevChecked?: number; // previous tokens whose dev balance we checked
  devPrevDumps?: number; // previous tokens the dev dumped
  devSerial?: boolean;
  devKnownDumper?: boolean;

  // DexScreener momentum (free source, works without the paid trade stream)
  priceChange5m?: number;
  volume5m?: number;

  graduated?: boolean;
  graduatedAt?: number;

  // holder analysis (RugCheck full report, refreshed during the first 20 min)
  holders?: number;
  top10Pct?: number; // % of supply held by the top 10 non-pool wallets
  top1Pct?: number;
  insiders?: number; // wallets in linked insider networks
  insiderPct?: number; // % of supply held by insider networks
  rugged?: boolean;
  devPrevTokens?: number; // all earlier launches by this dev (RugCheck)
  devPrevDead?: number;
  devPrevBest?: number | null; // best current market cap among them, USD

  matchGeneric?: boolean;

  // quality signals
  dexPaid?: boolean;
  dexPaidAt?: number | null;
  dexPaidTypes?: string[];
  boosts?: number;
  holdersFirst?: number;
  holdersFirstAt?: number;
  holderGrowthPerMin?: number;
  metaChecked?: boolean;
  lowEffort?: boolean; // no socials and no description
  junk?: boolean; // hidden by default in the feed

  copycat?: boolean; // exact copy of a token that is already live and trending
  narrativeFirstSeen?: number | null; // when this narrative first entered the dictionary (0/null = before tracking)
  dumpedFromPeak?: boolean;
  thinLiquidity?: boolean;

  // Wallet cohorts from raw chain data (bundlers, snipers, fresh and linked wallets)
  cohort?: Cohort;
  smartBuyers?: string[]; // learned or added smart wallets among the early buyers
  curveVelPerMin?: number; // bonding curve progress per minute (estimated from market cap)
  gradEtaMin?: number; // minutes to graduation at the current pace
  callers?: string[]; // followed Telegram channels that called this token
  firstCalledAt?: number;
  // On-chain scanner (no narrative)
  trigger?: string; // why it reached the radar: momentum, smart, graduated, dexpaid
  promotedAt?: number; // when it reached the radar
  launchMcapUsd?: number;
  calledAt?: number; // when it passed the call gate
  callMcapUsd?: number;
  callBlockers?: string[]; // what still keeps a radar token from being called
  callPath?: string; // which proof the call was made on: graduated, runner, smart
  callWhy?: string;
  earlyAt?: number; // when it was called as a fresh launch (ultra risky tier, separate track record)
  earlyMcapUsd?: number;
  // Launch block read (bundled, sniped, dev buy as % of supply), for young radar tokens.
  launch?: { bundlePct: number; snipedPct: number; devPct: number; bundleWallets: number; sniperWallets: number };
  ultraAt?: number; // when it was called in the ultra risky tier
  ultraMcapUsd?: number;
  volume24h?: number; // DexScreener 24h volume (for young tokens: everything since launch)
  updatedAt?: number; // set by the shared worker when anything about the signal changed
  rugLikely?: boolean;
  cleanLaunch?: boolean;
}

export interface EngineStats {
  ws: "connecting" | "open" | "closed";
  seen: number;
  perMin: number;
  matched: number;
  unnamedPending: number;
}

export interface TokenLookup {
  address: string;
  name: string;
  symbol: string;
  dexId: string;
  pairUrl: string;
  pairAddress?: string;
  fdvUsd?: number;
  liquidityUsd?: number;
  m5Buys?: number;
  m5Sells?: number;
  pairCreatedAt?: number;
  image?: string;
  priceChange5m?: number;
  volume5m?: number;
  priceUsd?: number;
  volume24h?: number;
}

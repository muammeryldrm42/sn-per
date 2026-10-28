// Framework-free scanning engine. Same logic as the browser engine (lib/engine.ts), but it takes its
// storage, timers, HTTP and WebSocket from the outside, so it runs 24/7 on a server (worker/index.ts)
// and every visitor of the site sees the same signals.

import { Matcher, compact, type NarrativeTerm } from "./narrative";
import { scoreSignal } from "./score";
import { CALLS_ENABLED } from "./calls";
import { perf } from "./format";
import { curveFromMcapSol } from "./curve";
import type { SmartBook } from "./smart";
import { computeRecord, type Outcome } from "./record";
import type { TierId } from "./tiers";
import { createLab } from "./lab";
import { CALL_MAX_PER_DAY, CALL_MAX_PER_HOUR, NARRATIVE_ENABLED } from "./flags";
import { callBlockers, callGrade, callPath, callReasons, callWhy, EARLY_ENABLED, EARLY_MAX_PER_DAY, EARLY_MAX_PER_HOUR, EARLY_WINDOW_MS, earlyBlockers, earlyWhy, launchStats, scoreV2, ULTRA_ENABLED, ULTRA_MAX_PER_DAY, ULTRA_MAX_PER_HOUR, ultraBlockers, ultraWhy } from "./score2";
import { callOutcomes, createArchive, TRIGGER_LABEL, type CallRow } from "./archive";
import { queueCohort, queueLaunch, rpc, TX_OPTS, type ParsedTx, type SigInfo } from "./cohort";
import type { EngineStats, NarrativesResponse, Signal, TokenLookup } from "./types";

const WS_URL = "wss://pumpportal.fun/api/data";
const TRACK_MS = 15 * 60_000;
const MAX_SIGNALS = 600;
const STORE_KEY = "tns.signals.v1";
const NARRATIVE_REFRESH_MS = 3 * 60_000;
const PROFILE_POLL_MS = 30_000;
const UNNAMED_POLL_MS = 15_000;
const TRACK_MAX_MS = 60 * 60_000;
const DEX_REFRESH_MS = 60_000;
const WHALE_SOL = 2;
const DICT_KEY = "tns.dict.v1";
const FIRST_KEY = "tns.firstseen.v1";
const FIRST_KEEP_MS = 3 * 24 * 3600_000;
const CRYPTO_SOURCES = new Set(["coingecko", "gecko", "dexboost"]);
const DEV_KEY = "tns.devs.v1";
const WATCH_WEIGHT = 6;
const DEV_KEEP_MS = 7 * 24 * 3600_000;
const DEX_POLL_MS = 20_000;
const PUMP_V_TOKENS_START = 1_073_000_000;
const PUMP_MINT_AUTHORITY = "TSLvdd1pWpHVjahSpsvCXUbgwsL3JAcvokwaKt1eokM"; // signs every pump.fun mint
const PUMP_PROGRAM_ID = "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P";
const PUMP_REAL_TOKENS = 793_100_000;
const OUTCOME_KEY = "tns.outcomes.v1";

interface Launch {
  mint: string;
  at: number;
  buy: number;
}
interface DevRec {
  launches: Launch[];
  dumped: string[];
  clean: string[];
}
interface Trade {
  t: number;
  buy: boolean;
  sol: number;
  mcap: number;
}
interface BuyerStat {
  sol: number;
  first: number;
}
interface Candidate {
  mint: string;
  name: string;
  symbol: string;
  pool: string;
  origin: Signal["origin"];
  creator?: string;
  uri?: string;
  createdAt: number;
  initialBuySol: number;
  marketCapSol: number;
  extra?: Partial<Signal>;
}
interface Cand {
  mint: string;
  name: string;
  symbol: string;
  creator?: string;
  pool: string;
  at: number;
  launchMcapSol: number;
  initialBuySol: number;
  initialBuyTokens: number;
  uri?: string;
  hist: { t: number; fdv: number }[];
  buys5?: number;
  sells5?: number;
  pc5?: number;
  vol5?: number;
  liq?: number;
  fdv?: number;
  image?: string;
}


interface Unnamed {
  mint: string;
  pool: string;
  creator?: string;
  initialBuySol: number;
  marketCapSol: number;
  at: number;
  tries: number;
}

export interface Hit {
  at: number;
  count: number;
}

export interface CoreState {
  narratives: NarrativesResponse | null;
  narrError: string | null;
  signals: Signal[];
  hits: Record<string, Hit>;
  stats: EngineStats;
  fresh: string[];
  watch: string[];
  graduations: number;
  calls: CallRow[]; // calls of the last 7 days (older ones: archive)
  early?: CallRow[]; // risky tier (fresh launch rule) calls of the last 7 days
  ultra?: CallRow[]; // ultra risky tier calls of the last 2 days
  solUsd: number | null;
  radar: number; // tokens currently watched for momentum
}

export interface CoreEnv {
  api: (path: string) => Promise<Response>;
  storage: { get(key: string): string | null; set(key: string, value: string): void };
  every: (ms: number, fn: () => void) => () => void;
  after: (ms: number, fn: () => void) => () => void;
  watchlist?: string[];
  onFlush?: (state: CoreState) => void;
  smart?: SmartBook; // learns smart wallets from early buyers
  smartWalletsFor?: (mint: string) => string[]; // smart wallets seen buying this token (watcher)
  learnSample?: boolean; // also read early buyers of a sample of all launches (worker)
  backfillCreates?: boolean; // re-read pump.fun launches from the chain that the PumpPortal stream dropped (worker)
  smartClusters?: () => string[]; // tokens 2+ smart wallets bought recently (worker)
  // PumpPortal API key (worker only, never in the browser): unlocks account trade streams, billed per message.
  pumpKey?: string;
  accountWallets?: () => string[]; // wallets to stream trades for (KOLs, smart wallets)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  onAccountTrade?: (d: Record<string, any>) => void;
  tokenTrades?: boolean; // also stream every trade of radar tokens (costly with a key; off by default then)
}

const bogusFdv = (pool: string, createdAt: number, graduated: boolean | undefined, fdv: number, sol: number | null) =>
  !graduated && (pool === "pump" || pool === "bonk") && !!sol && Date.now() - createdAt < 10 * 60_000 && fdv > 1000 * sol;

// DexScreener calls the pump.fun bonding curve "pumpfun"; the scanner (PumpPortal) calls it "pump".
const poolOf = (dexId?: string) => (dexId === "pumpfun" ? "pump" : dexId ?? "");

const curvePct = (vTokens: unknown) => {
  const v = Number(vTokens);
  if (!isFinite(v) || v <= 0) return undefined;
  return Math.max(0, Math.min(100, ((PUMP_V_TOKENS_START - v) / PUMP_REAL_TOKENS) * 100));
};

export function createCore(env: CoreEnv) {
  const { api, storage } = env;
  let narratives: NarrativesResponse | null = null;
  let narrError: string | null = null;
  let signals: Signal[] = [];
  let hits: Record<string, Hit> = {};
  let stats: EngineStats = { ws: "connecting", seen: 0, perMin: 0, matched: 0, unnamedPending: 0 };
  let fresh: string[] = [];
  let graduations = 0;

  let matcher: Matcher | null = null;
  const sigs = new Map<string, Signal>();
  const buyers = new Map<string, Set<string>>();
  const termCount = new Map<string, number>();
  const seen = new Set<string>();
  const createSigs = new Set<string>(); // create transactions the stream delivered
  const checkedSigs = new Set<string>(); // create transactions already looked at by the chain backfill
  const profileSeen = new Set<string>(); // DexScreener profiles already handled (apart from launches: a token we saw launch can still pay later)
  let seenTimes: number[] = [];
  const unnamed: Unnamed[] = [];
  const tracked = new Set<string>();
  let ws: WebSocket | null = null;
  let wsState: EngineStats["ws"] = "connecting";
  let dirty = true;
  const counters = { seen: 0, matched: 0 };
  const trades = new Map<string, Trade[]>();
  const buyerStats = new Map<string, Map<string, BuyerStat>>();
  let freshTerms = new Set<string>();
  const devs = new Map<string, DevRec>();
  let solUsd: number | null = null;
  const dexHist = new Map<string, { t: number; fdv: number }[]>();
  const urgentRead = new Set<string>(); // radar tokens whose wallet read was moved to the front
  const urgentTries = new Map<string, number>(); // failed front-of-line reads per token
  const pathSince = new Map<string, number>(); // when a radar token first had a call proof
  let firstSeen: Record<string, number> = {};
  let terms: NarrativeTerm[] = [];
  let watch: string[] = (env.watchlist ?? []).map((w) => w.trim()).filter((w) => compact(w).length >= 3);

  const recentLaunches: { mint: string; creator?: string; at: number; mcapSol: number }[] = [];
  const cands = new Map<string, Cand>();
  const nameSeen = new Map<string, number>();
  const archive = createArchive(storage);
  const early = createArchive(storage, "early"); // risky tier (fresh launch rule), kept apart from the main calls
  const ultra = createArchive(storage, "ultra"); // ultra risky tier: every healthy launch over $6K in its first 3 min
  const ULTRA_TRACK_MS = 2 * 24 * 3600_000; // ultra calls are priced for 2 days (most are settled long before)
  const lab = createLab(storage); // public lab: every live and candidate rule, uncapped, measured the same way
  const bookOf = (tier: TierId) => (tier === "risky" ? early : tier === "ultra" ? ultra : archive);
  const sampled = new Map<string, { at: number; baseUsd: number }>();
  let stopped = false;
  let retry = 0;
  // Pending one-shot timers. Each removes itself when it fires, so a 24/7 process does not leak them.
  const timers = new Set<() => void>();
  const later = (fn: () => void, ms: number) => {
    let cancel: () => void = () => {};
    cancel = env.after(ms, () => {
      timers.delete(cancel);
      fn();
    });
    timers.add(cancel);
  };
  let lastMsgAt = Date.now();

  const rebuildMatcher = () => {
    const byTerm = new Map(terms.map((t) => [t.term, { ...t, sources: [...t.sources] }]));
    for (const w of watch) {
      const key = compact(w);
      if (key.length < 3) continue;
      const cur = byTerm.get(key);
      if (cur) {
        cur.weight += WATCH_WEIGHT;
        if (!cur.sources.includes("watchlist")) cur.sources.push("watchlist");
      } else {
        byTerm.set(key, { term: key, display: w, weight: WATCH_WEIGHT, sources: ["watchlist"], context: "Watchlist" });
      }
    }
    matcher = new Matcher([...byTerm.values()]);
  };

  const send = (msg: object) => {
    if (ws && ws.readyState === 1) ws.send(JSON.stringify(msg));
  };

  // Without a key the token trade stream is a free no-op; with a key it is billed, so it is opt-in.
  const tokenTrades = env.tokenTrades ?? !env.pumpKey;
  const pump = { keyed: !!env.pumpKey, accountMsgs: 0, tokenMsgs: 0, streamCreates: 0, backfilled: 0, since: Date.now() };
  const accountSubs = new Set<string>();
  // Keep the account trade subscriptions in step with the wallet list (KOLs refresh, smart wallets grow).
  const syncAccounts = () => {
    if (!env.pumpKey || !env.accountWallets || !ws || ws.readyState !== 1) return;
    const want = new Set(env.accountWallets());
    const add = [...want].filter((w) => !accountSubs.has(w));
    const drop = [...accountSubs].filter((w) => !want.has(w));
    for (let i = 0; i < add.length; i += 100) send({ method: "subscribeAccountTrade", keys: add.slice(i, i + 100) });
    for (let i = 0; i < drop.length; i += 100) send({ method: "unsubscribeAccountTrade", keys: drop.slice(i, i + 100) });
    for (const w of add) accountSubs.add(w);
    for (const w of drop) accountSubs.delete(w);
  };

  // restore previous run
  try {
    const raw = storage.get(STORE_KEY);
    if (raw) {
      for (const s of JSON.parse(raw) as Signal[]) {
        sigs.set(s.mint, s);
        seen.add(s.mint);
        termCount.set(s.matchedTerm, (termCount.get(s.matchedTerm) ?? 0) + 1);
      }
    }
  } catch {
    /* fresh start */
  }
  try {
    const raw = storage.get(DEV_KEY);
    if (raw) {
      const cut = Date.now() - DEV_KEEP_MS;
      for (const [k, v] of Object.entries(JSON.parse(raw) as Record<string, DevRec>)) {
        const launches = (v.launches ?? []).filter((l) => l.at > cut);
        if (launches.length || v.dumped?.length) devs.set(k, { launches, dumped: v.dumped ?? [], clean: v.clean ?? [] });
      }
    }
  } catch {
    /* no dev history */
  }
  try {
    const raw = storage.get(FIRST_KEY);
    if (raw) firstSeen = JSON.parse(raw);
  } catch {
    /* none */
  }

  const devRec = (creator: string) => {
    let r = devs.get(creator);
    if (!r) devs.set(creator, (r = { launches: [], dumped: [], clean: [] }));
    return r;
  };

  const persistDevs = () => {
    try {
      const cut = Date.now() - DEV_KEEP_MS;
      const out: Record<string, DevRec> = {};
      const rows = [...devs.entries()]
        .map(([k, v]) => [k, { ...v, launches: v.launches.filter((l) => l.at > cut).slice(-20) }] as const)
        .filter(([, v]) => v.launches.length >= 2 || v.dumped.length > 0)
        .sort((a, b) => (b[1].launches.at(-1)?.at ?? 0) - (a[1].launches.at(-1)?.at ?? 0))
        .slice(0, 20000);
      for (const [k, v] of rows) out[k] = v;
      storage.set(DEV_KEY, JSON.stringify(out));
      // Keep memory bounded too: forget creators with nothing recent and no dumps.
      for (const [k, v] of devs) {
        v.launches = v.launches.filter((l) => l.at > cut);
        if (!v.dumped.length && (!v.launches.length || (v.launches.length === 1 && Date.now() - v.launches[0].at > 24 * 3600_000))) devs.delete(k);
      }
    } catch {
      /* ignore */
    }
  };

  const devHeld = async (creator: string, mint: string, initial: number): Promise<number | null> => {
    if (!initial) return null;
    try {
      const r = await api(`/api/devbalance?owner=${creator}&mint=${mint}`);
      if (!r.ok) return null;
      const j = await r.json();
      return typeof j.balance === "number" ? Math.min(1, j.balance / initial) : null;
    } catch {
      return null;
    }
  };

  const markDev = (creator: string, mint: string, held: number) => {
    const rec = devRec(creator);
    if (held < 0.5) {
      if (!rec.dumped.includes(mint)) rec.dumped.push(mint);
    } else if (!rec.clean.includes(mint)) rec.clean.push(mint);
    rec.dumped = rec.dumped.slice(-20);
    rec.clean = rec.clean.slice(-20);
  };

  const watchDev = (mint: string, attempt = 0) => {
    later(async () => {
      const s = sigs.get(mint);
      if (!s || !s.creator || !s.initialBuyTokens || stopped) return;
      const held = await devHeld(s.creator, mint, s.initialBuyTokens);
      if (held !== null) {
        s.devHeldPct = held;
        if (held < 0.5) {
          s.devSold = true;
          markDev(s.creator, mint, held);
        }
        dirty = true;
      }
      if (!s.devSold && Date.now() - s.createdAt < TRACK_MAX_MS && attempt < 30) watchDev(mint, attempt + 1);
    }, attempt === 0 ? 60_000 : 120_000);
  };

  const checkPrevLaunches = async (creator: string, current: string) => {
    const rec = devs.get(creator);
    if (!rec) return;
    const todo = rec.launches
      .filter((l) => l.mint !== current && l.buy > 0 && !rec.dumped.includes(l.mint) && !rec.clean.includes(l.mint))
      .filter((l) => Date.now() - l.at > 5 * 60_000)
      .slice(-5);
    for (const l of todo) {
      const held = await devHeld(creator, l.mint, l.buy);
      if (held !== null) markDev(creator, l.mint, held);
    }
    if (todo.length) dirty = true;
  };

  const track = (mint: string) => {
    tracked.add(mint);
    if (tokenTrades) send({ method: "subscribeTokenTrade", keys: [mint] });
    const s0 = sigs.get(mint);
    if (s0) s0.trackedUntil = Date.now() + TRACK_MS;
    const expire = () => {
      const s = sigs.get(mint);
      const moving = s && (s.rising || s.strong || (s.buyers5m ?? 0) >= 3);
      if (s && moving && Date.now() - s.createdAt < TRACK_MAX_MS) {
        s.trackedUntil = Date.now() + TRACK_MS;
        later(expire, TRACK_MS);
        return;
      }
      tracked.delete(mint);
      buyers.delete(mint);
      trades.delete(mint);
      buyerStats.delete(mint);
      if (s) s.trackedUntil = undefined;
      if (tokenTrades) send({ method: "unsubscribeTokenTrade", keys: [mint] });
    };
    later(expire, TRACK_MS);
  };

  const enrichMeta = async (s: Signal) => {
    if (!s.uri) return;
    try {
      const r = await api(`/api/meta?uri=${encodeURIComponent(s.uri)}`);
      if (!r.ok) return;
      const m = await r.json();
      const cur = sigs.get(s.mint);
      if (!cur) return;
      cur.description = cur.description ?? m.description;
      cur.image = cur.image ?? m.image;
      cur.twitter = cur.twitter ?? m.twitter;
      cur.telegram = cur.telegram ?? m.telegram;
      cur.website = cur.website ?? m.website;
      cur.metaChecked = true;
      cur.lowEffort = !cur.twitter && !cur.telegram && !cur.website && !cur.description;
      dirty = true;
    } catch {
      /* optional */
    }
  };

  const checkRug = (mint: string, attempt: number) => {
    later(async () => {
      const cur = sigs.get(mint);
      if (!cur || stopped) return;
      try {
        const r = await api(`/api/rugcheck?mint=${mint}`);
        const j = await r.json();
        if (j.pending) {
          if (attempt < 3) checkRug(mint, attempt + 1);
          else if (cur.rug.status !== "ok") cur.rug = { status: "unavailable", risks: [] };
        } else {
          cur.rug = { status: "ok", score: j.score, risks: j.risks ?? [] };
          cur.rugged = j.rugged;
          cur.holders = j.holders ?? cur.holders;
          if (typeof j.holders === "number") {
            if (cur.holdersFirst == null) {
              cur.holdersFirst = j.holders;
              cur.holdersFirstAt = Date.now();
            } else if (cur.holdersFirstAt) {
              const mins = (Date.now() - cur.holdersFirstAt) / 60_000;
              if (mins >= 2) cur.holderGrowthPerMin = (j.holders - cur.holdersFirst) / mins;
            }
          }
          cur.top10Pct = j.top10Pct;
          cur.top1Pct = j.top1Pct;
          cur.insiders = j.insiders;
          cur.insiderPct = j.insiderPct;
          cur.devPrevTokens = j.devPrevTokens;
          cur.devPrevDead = j.devPrevDead;
          cur.devPrevBest = j.devPrevBest;
          const age = Date.now() - cur.createdAt;
          const next = age < 5 * 60_000 ? 5 * 60_000 : age < 10 * 60_000 ? 10 * 60_000 : age < 20 * 60_000 ? 20 * 60_000 : 0;
          if (next) later(() => checkRug(mint, 10), Math.max(15_000, next - age - 45_000));
        }
      } catch {
        if (attempt < 3) checkRug(mint, attempt + 1);
        else cur.rug = { status: "unavailable", risks: [] };
      }
      dirty = true;
    }, attempt === 0 ? 45_000 : attempt === 10 ? 45_000 : 60_000);
  };

  const consider = (c: Candidate) => {
    const m = matcher?.match(c.name, c.symbol);
    if (!m) return;
    const term = m.term.term;
    const copyIndex = termCount.get(term) ?? 0;
    termCount.set(term, copyIndex + 1);

    const s: Signal = {
      mint: c.mint,
      name: c.name,
      symbol: c.symbol,
      pool: c.pool,
      origin: c.origin,
      creator: c.creator,
      createdAt: c.createdAt,
      uri: c.uri,
      matchedTerm: term,
      matchedDisplay: m.term.display,
      matchContext: m.term.context,
      matchSources: m.term.sources,
      matchKind: m.kind,
      matchStrength: m.strength,
      matchGeneric: m.generic,
      copycat: m.kind === "exact" && m.term.sources.length > 0 && m.term.sources.every((x) => CRYPTO_SOURCES.has(x)),
      narrativeFirstSeen: firstSeen[term] ?? null,
      narrativeWeight: m.term.weight,
      copyIndex,
      initialBuySol: c.initialBuySol,
      marketCapSol: c.marketCapSol,
      buys: 0,
      sells: 0,
      buyers: 0,
      netSol: 0,
      rug: { status: "pending", risks: [] },
      score: 0,
      tier: "early",
      freshNarrative: freshTerms.has(term),
      mcapAtSignal: c.marketCapSol || undefined,
      peakMcapSol: c.marketCapSol || undefined,
      ...c.extra,
    };
    if (s.fdvUsd) {
      s.fdvAtSignal = s.fdvUsd;
      s.peakFdvUsd = s.fdvUsd;
    }
    sigs.set(s.mint, s);
    counters.matched++;
    if (sigs.size > MAX_SIGNALS) {
      const oldest = [...sigs.values()].sort((a, b) => a.createdAt - b.createdAt)[0];
      if (oldest) sigs.delete(oldest.mint);
    }

    hits = { ...hits, [term]: { at: Date.now(), count: (hits[term]?.count ?? 0) + 1 } };
    startChecks(s);
  };

  // Full checks for anything that reaches the radar: trades, metadata, RugCheck, wallet cohorts, dev history.
  const startChecks = (s: Signal) => {
    track(s.mint);
    enrichMeta(s);
    checkRug(s.mint, 0);
    for (const delay of [15_000, 2 * 60_000, 10 * 60_000]) {
      later(async () => {
        const cur = sigs.get(s.mint);
        if (!cur || stopped) return;
        const co = await queueCohort(cur.mint, cur.creator);
        if (co) {
          const { earlyWallets, ...rest } = co;
          cur.cohort = rest;
          if (env.smart && earlyWallets) {
            env.smart.observe(cur.mint, earlyWallets);
            const found = env.smart.smartAmong(earlyWallets.filter((e) => !e.bundler && !e.linked).map((e) => e.w));
            cur.smartBuyers = [...new Set([...(cur.smartBuyers ?? []), ...found])].slice(0, 10);
          }
          dirty = true;
        }
      }, delay);
    }
    if (s.creator) {
      watchDev(s.mint);
      checkPrevLaunches(s.creator, s.mint);
    }
    dirty = true;
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const onCreate = (d: Record<string, any>) => {
    const mint: string = d.mint;
    if (typeof d.signature === "string") {
      createSigs.add(d.signature);
      if (createSigs.size > 20_000) createSigs.clear();
    }
    if (seen.has(mint)) return;
    if (seen.size > 200_000) seen.clear();
    seen.add(mint);
    // Launches recovered from the chain carry their real block time; stream launches are "now".
    const launchedAt = Number(d.launchedAt) > 0 ? Number(d.launchedAt) : Date.now();
    counters.seen++;
    seenTimes.push(Date.now());
    const name = String(d.name ?? "").trim();
    const symbol = String(d.symbol ?? "").trim();
    const base = {
      mint,
      pool: String(d.pool ?? "pump"),
      creator: d.traderPublicKey,
      initialBuySol: Number(d.solAmount) || 0,
      marketCapSol: Number(d.marketCapSol) || 0,
    };
    if (d.traderPublicKey) {
      const rec = devRec(d.traderPublicKey);
      rec.launches.push({ mint, at: launchedAt, buy: Number(d.initialBuy) || 0 });
      if (rec.launches.length > 50) rec.launches.splice(0, rec.launches.length - 50);
    }
    if (env.learnSample && base.pool === "pump" && base.marketCapSol) {
      recentLaunches.push({ mint, creator: d.traderPublicKey, at: launchedAt, mcapSol: base.marketCapSol });
      if (recentLaunches.length > 2000) recentLaunches.splice(0, recentLaunches.length - 2000);
    }
    if (!NARRATIVE_ENABLED) {
      // On-chain scanner: every launch is a candidate, named or not. Momentum decides, not the name.
      const key = compact(symbol || name);
      if (key) nameSeen.set(key, (nameSeen.get(key) ?? 0) + 1);
      cands.set(mint, {
        mint,
        name,
        symbol,
        creator: d.traderPublicKey,
        pool: base.pool,
        at: launchedAt,
        launchMcapSol: base.marketCapSol,
        initialBuySol: base.initialBuySol,
        initialBuyTokens: Number(d.initialBuy) || 0,
        uri: d.uri,
        hist: [],
      });
      return;
    }
    if (!name && !symbol) {
      if (unnamed.length < 300) unnamed.push({ ...base, at: Date.now(), tries: 0 });
      return;
    }
    consider({
      ...base,
      name,
      symbol,
      uri: d.uri,
      origin: "pumpportal",
      createdAt: Date.now(),
      extra: {
        initialBuyTokens: Number(d.initialBuy) || 0,
        ...(base.pool === "pump" ? { curvePct: curvePct(d.vTokensInBondingCurve) } : {}),
      },
    });
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const onTrade = (d: Record<string, any>) => {
    const s = sigs.get(d.mint);
    if (!s) return;
    const amt = Number(d.solAmount) || 0;
    if (d.txType === "sell" && s.creator && d.traderPublicKey === s.creator) {
      s.devSold = true;
      s.devSoldSol = (s.devSoldSol ?? 0) + amt;
    }
    if (d.txType === "buy" && s.origin === "pumpportal" && Date.now() - s.createdAt < 3000) {
      s.earlyBuys = (s.earlyBuys ?? 0) + 1;
      if (s.earlyBuys >= 6) s.bundled = true;
    }
    if (d.txType === "buy") {
      s.buys++;
      s.netSol += amt;
      if (d.traderPublicKey && d.traderPublicKey !== s.creator) {
        let set = buyers.get(s.mint);
        if (!set) buyers.set(s.mint, (set = new Set()));
        set.add(d.traderPublicKey);
        s.buyers = Math.max(s.buyers, set.size);
      }
    } else {
      s.sells++;
      s.netSol -= amt;
    }
    if (typeof d.marketCapSol === "number") s.marketCapSol = d.marketCapSol;
    const now = Date.now();
    s.lastTradeAt = now;
    let list = trades.get(s.mint);
    if (!list) trades.set(s.mint, (list = []));
    list.push({ t: now, buy: d.txType === "buy", sol: amt, mcap: s.marketCapSol });
    if (list.length > 2000) list.splice(0, list.length - 2000);
    if (d.txType === "buy" && d.traderPublicKey && d.traderPublicKey !== s.creator) {
      if (amt >= WHALE_SOL) s.whaleBuys = (s.whaleBuys ?? 0) + 1;
      let bs = buyerStats.get(s.mint);
      if (!bs) buyerStats.set(s.mint, (bs = new Map()));
      const cur = bs.get(d.traderPublicKey);
      if (cur) cur.sol += amt;
      else bs.set(d.traderPublicKey, { sol: amt, first: now });
    }
    if (!s.mcapAtSignal && s.marketCapSol) s.mcapAtSignal = s.marketCapSol;
    if (s.marketCapSol && s.marketCapSol > (s.peakMcapSol ?? 0)) s.peakMcapSol = s.marketCapSol;
    if (s.pool === "pump" && d.vTokensInBondingCurve != null) s.curvePct = curvePct(d.vTokensInBondingCurve);
    dirty = true;
  };

  const connect = () => {
    if (stopped) return;
    wsState = "connecting";
    const sock = new WebSocket(env.pumpKey ? `${WS_URL}?api-key=${encodeURIComponent(env.pumpKey)}` : WS_URL);
    ws = sock;
    sock.onopen = () => {
      retry = 0;
      wsState = "open";
      lastMsgAt = Date.now();
      sock.send(JSON.stringify({ method: "subscribeNewToken" }));
      sock.send(JSON.stringify({ method: "subscribeMigration" }));
      const now = Date.now();
      for (const s of sigs.values()) if (now - s.createdAt < TRACK_MS && !tracked.has(s.mint)) track(s.mint);
      if (tracked.size && tokenTrades) sock.send(JSON.stringify({ method: "subscribeTokenTrade", keys: [...tracked] }));
      accountSubs.clear();
      syncAccounts();
    };
    sock.onmessage = (ev) => {
      lastMsgAt = Date.now();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let d: Record<string, any>;
      try {
        d = JSON.parse(String(ev.data));
      } catch {
        return;
      }
      if (!d || !d.mint) return;
      if (d.txType !== "create" && d.txType !== "buy" && d.txType !== "sell") {
        const s = sigs.get(d.mint);
        if (s && !s.graduated) {
          s.graduated = true;
          s.graduatedAt = Date.now();
          s.curvePct = 100;
          graduations++;
          dirty = true;
        }
        const c = cands.get(d.mint);
        if (!s && c && !NARRATIVE_ENABLED) {
          promote(c, "graduated", "Finished the bonding curve and moved to an AMM");
          const g = sigs.get(d.mint);
          if (g) {
            g.graduated = true;
            g.graduatedAt = Date.now();
            g.curvePct = 100;
          }
        }
        return;
      }
      if (d.txType === "create") {
        pump.streamCreates++;
        onCreate(d);
      }
      else {
        if (d.traderPublicKey && accountSubs.has(d.traderPublicKey)) {
          pump.accountMsgs++;
          env.onAccountTrade?.(d);
        } else pump.tokenMsgs++;
        onTrade(d);
      }
    };
    sock.onclose = () => {
      wsState = "closed";
      if (!stopped) later(connect, Math.min(30_000, 1000 * 2 ** retry++));
    };
    sock.onerror = () => sock.close();
  };

  const loadNarratives = async () => {
    try {
      const r = await api("/api/narratives");
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const j = (await r.json()) as NarrativesResponse;
      let prev: Record<string, number> | null = null;
      try {
        const raw = storage.get(DICT_KEY);
        if (raw) {
          const p = JSON.parse(raw) as { at: number; w: Record<string, number> };
          if (Date.now() - p.at < 2 * 3600_000) prev = p.w;
        }
      } catch {
        /* no baseline */
      }
      if (prev) {
        const f = new Set<string>();
        for (const t of j.terms) {
          const before = prev[t.term];
          if (before == null || t.weight >= before * 1.5) f.add(t.term);
        }
        freshTerms = f.size < j.terms.length * 0.6 ? f : new Set();
        fresh = [...freshTerms];
      }
      try {
        const w: Record<string, number> = {};
        for (const t of j.terms) w[t.term] = t.weight;
        storage.set(DICT_KEY, JSON.stringify({ at: Date.now(), w }));
      } catch {
        /* ignore */
      }
      if (j.solUsd) solUsd = j.solUsd;
      const baseline = !Object.keys(firstSeen).length;
      const nowTs = Date.now();
      for (const t of j.terms) if (firstSeen[t.term] == null) firstSeen[t.term] = baseline ? 0 : nowTs;
      const live = new Set(j.terms.map((t) => t.term));
      for (const [k, v] of Object.entries(firstSeen)) if (!live.has(k) && v && nowTs - v > FIRST_KEEP_MS) delete firstSeen[k];
      try {
        storage.set(FIRST_KEY, JSON.stringify(firstSeen));
      } catch {
        /* ignore */
      }
      terms = j.terms;
      rebuildMatcher();
      narratives = j;
      narrError = null;
    } catch (e) {
      narrError = (e as Error).message;
    }
  };

  const resolveUnnamed = async () => {
    const now = Date.now();
    const batch = unnamed.splice(0, 30);
    if (!batch.length || !matcher) {
      unnamed.unshift(...batch);
      return;
    }
    try {
      const r = await api(`/api/tokens?addresses=${batch.map((b) => b.mint).join(",")}`);
      const j = (await r.json()) as { tokens: TokenLookup[] };
      const found = new Map(j.tokens.map((t) => [t.address, t]));
      for (const b of batch) {
        const t = found.get(b.mint);
        if (t) {
          consider({
            ...b,
            name: t.name,
            symbol: t.symbol,
            origin: "pumpportal",
            createdAt: b.at,
            extra: {
              fdvUsd: t.fdvUsd && !bogusFdv(b.pool, b.at, false, t.fdvUsd, solUsd) ? t.fdvUsd : undefined,
              liquidityUsd: t.liquidityUsd,
              image: t.image,
            },
          });
        } else if (b.tries < 4 && now - b.at < 5 * 60_000) unnamed.push({ ...b, tries: b.tries + 1 });
      }
    } catch {
      unnamed.push(...batch.filter((b) => b.tries < 4).map((b) => ({ ...b, tries: b.tries + 1 })));
    }
  };

  // ---------- On-chain scanner (no narrative) ----------

  // Put a token on the radar and start the full checks.
  const promote = (c: Cand, trigger: string, why: string) => {
    if (sigs.has(c.mint)) return;
    const fdv = c.fdv;
    const mcapSol = fdv && solUsd ? fdv / solUsd : c.launchMcapSol;
    const key = compact(c.symbol || c.name);
    const s: Signal = {
      mint: c.mint,
      name: c.name || c.symbol || `${c.mint.slice(0, 4)}...${c.mint.slice(-4)}`,
      symbol: c.symbol || "?",
      pool: c.pool,
      origin: "pumpportal",
      creator: c.creator,
      createdAt: c.at,
      uri: c.uri,
      matchedTerm: trigger,
      matchedDisplay: TRIGGER_LABEL[trigger] ?? trigger,
      matchContext: why,
      matchSources: [trigger],
      matchKind: "exact",
      matchStrength: 1,
      narrativeWeight: 0,
      copyIndex: Math.max(0, (nameSeen.get(key) ?? 1) - 1),
      initialBuySol: c.initialBuySol,
      initialBuyTokens: c.initialBuyTokens,
      marketCapSol: mcapSol,
      buys: 0,
      sells: 0,
      buyers: 0,
      netSol: 0,
      rug: { status: "pending", risks: [] },
      score: 0,
      tier: "early",
      mcapAtSignal: mcapSol,
      peakMcapSol: mcapSol,
      fdvUsd: fdv,
      fdvAtSignal: fdv,
      peakFdvUsd: fdv,
      liquidityUsd: c.liq,
      m5Buys: c.buys5,
      m5Sells: c.sells5,
      priceChange5m: c.pc5,
      volume5m: c.vol5,
      image: c.image,
      trigger,
      promotedAt: Date.now(),
      launchMcapUsd: solUsd && c.launchMcapSol ? c.launchMcapSol * solUsd : undefined,
      curvePct: c.pool === "pump" && fdv && solUsd ? curveFromMcapSol(fdv / solUsd) : undefined,
    };
    if (c.hist.length) dexHist.set(c.mint, [...c.hist]);
    cands.delete(c.mint);
    sigs.set(s.mint, s);
    // Young tokens get the launch read (bundled, sniped, dev buy) right away; it is cheap and it is history.
    if (!NARRATIVE_ENABLED && Date.now() - s.createdAt < 5 * 60_000 && (s.pool === "pump" || s.mint.endsWith("pump"))) {
      const mint = s.mint;
      queueLaunch(mint, s.creator).then((L) => {
        const cur = sigs.get(mint);
        if (!L || !cur) return;
        cur.launch = { bundlePct: L.bundlePct, snipedPct: L.snipedPct, devPct: L.devPct, bundleWallets: L.bundleWallets, sniperWallets: L.sniperWallets };
        const fields = { bp: L.bundlePct, sp: L.snipedPct, ...(cur.initialBuyTokens ? {} : { cb: L.devPct }) };
        for (const book of [archive, early, ultra]) book.patch(mint, fields);
        dirty = true;
      });
    }
    counters.matched++;
    if (sigs.size > MAX_SIGNALS) {
      // Evict the oldest radar entry that was never called; calls also live in the archive.
      const oldest = [...sigs.values()].filter((x) => !x.calledAt).sort((a, b) => a.createdAt - b.createdAt)[0];
      if (oldest) sigs.delete(oldest.mint);
    }
    startChecks(s);
    dirty = true;
  };

  // The free PumpPortal stream does not deliver every pump.fun launch: checked against the chain it caught 90-98% at
  // quiet times but only about half (62 of 131 in 4 minutes) when launches were busy. Frongus (later 100x+) was one
  // it missed. Every pump.fun create transaction is signed by the program's mint authority, so its newest signatures
  // are read every 20 s and any create the stream did not deliver is read from the chain and added, ~20-60 s after
  // launch. Only the missing ones are fetched (stream create messages carry their signature).
  const backfillCreates = async () => {
    if (NARRATIVE_ENABLED || !env.backfillCreates || !solUsd) return;
    const sigs = await rpc<SigInfo[]>("getSignaturesForAddress", [PUMP_MINT_AUTHORITY, { limit: 100 }]);
    if (!sigs) return;
    const now = Date.now();
    // Give the stream a 20 s head start, look back 5 minutes.
    const missing = sigs.filter(
      (x) => !x.err && x.blockTime && now - x.blockTime * 1000 > 20_000 && now - x.blockTime * 1000 < 5 * 60_000 && !createSigs.has(x.signature) && !checkedSigs.has(x.signature)
    );
    for (const x of missing.slice(0, 15)) {
      checkedSigs.add(x.signature);
      if (checkedSigs.size > 20_000) checkedSigs.clear();
      type Inner = { instructions?: { parsed?: { type?: string; info?: { mint?: string } } }[] }[];
      const tx = await rpc<ParsedTx & { meta: { logMessages?: string[]; innerInstructions?: Inner } | null }>("getTransaction", [x.signature, TX_OPTS]);
      const logs = tx?.meta?.logMessages ?? [];
      if (!tx?.meta || !logs.some((l) => /Instruction: Create(V2)?$/.test(l)) || !logs.some((l) => l.includes(PUMP_PROGRAM_ID))) continue;
      // The new mint is the account the create initialised (initializeMint2); a bundle can buy other tokens in the
      // same transaction, so balances alone are not enough.
      let mint: string | undefined;
      for (const g of tx.meta.innerInstructions ?? [])
        for (const ins of g.instructions ?? []) {
          const t = ins.parsed?.type;
          if ((t === "initializeMint2" || t === "initializeMint") && typeof ins.parsed?.info?.mint === "string") mint = mint ?? ins.parsed.info.mint;
        }
      if (!mint || seen.has(mint)) continue;
      const creator = tx.transaction.message.accountKeys[0]?.pubkey;
      // Dev's first buy from the creator's balance; price after it from the curve (30 SOL / 1.073B virtual start).
      const bought = (tx.meta.postTokenBalances ?? []).filter((b) => b.mint === mint && b.owner === creator).reduce((a, b) => a + (b.uiTokenAmount.uiAmount ?? 0), 0);
      const vTok = PUMP_V_TOKENS_START - bought;
      const k = 30 * PUMP_V_TOKENS_START;
      onCreate({
        txType: "create",
        mint,
        signature: x.signature,
        traderPublicKey: creator,
        pool: "pump",
        name: "",
        symbol: "",
        initialBuy: bought,
        solAmount: bought > 0 ? k / vTok - 30 : 0,
        marketCapSol: (k * 1e9) / (vTok * vTok),
        launchedAt: (tx.blockTime ?? x.blockTime ?? now / 1000) * 1000,
      });
      pump.backfilled++;
    }
  };

  // Watch every launch for its first 45 minutes, 30 at a time through DexScreener, and promote the ones that move.
  const pollCandidates = async () => {
    if (NARRATIVE_ENABLED || !solUsd) return;
    const now = Date.now();
    for (const [k, c] of cands) if (now - c.at > 45 * 60_000) cands.delete(k);
    const list = [...cands.values()].filter((c) => now - c.at >= 40_000).sort((a, b) => b.at - a.at);
    const sol = solUsd;
    for (let i = 0; i < list.length && i < 30 * 40; i += 30) {
      const batch = list.slice(i, i + 30);
      let tokens: (TokenLookup & { priceChange5m?: number; volume5m?: number })[] = [];
      try {
        const r = await api(`/api/tokens?addresses=${batch.map((c) => c.mint).join(",")}`);
        if (!r.ok) continue;
        tokens = ((await r.json()) as { tokens: typeof tokens }).tokens ?? [];
      } catch {
        continue;
      }
      const got = new Map(tokens.map((t) => [t.address, t]));
      for (const c of batch) {
        const t = got.get(c.mint);
        const age = now - c.at;
        if (!t || !t.fdvUsd) {
          if (age > 4 * 60_000) cands.delete(c.mint); // never traded: dead on arrival
          continue;
        }
        // DexScreener misprices brand new launchpad tokens now and then; skip those readings.
        if (c.pool === "pump" && t.fdvUsd < 25 * sol) continue;
        if (bogusFdv(c.pool, c.at, false, t.fdvUsd, sol)) continue;
        c.name = c.name || t.name;
        c.symbol = c.symbol || t.symbol;
        c.image = c.image ?? t.image;
        c.fdv = t.fdvUsd;
        c.liq = t.liquidityUsd;
        c.buys5 = t.m5Buys ?? 0;
        c.sells5 = t.m5Sells ?? 0;
        c.pc5 = t.priceChange5m;
        c.vol5 = t.volume5m;
        c.hist.push({ t: now, fdv: t.fdvUsd });
        if (c.hist.length > 12) c.hist.shift();

        const launchUsd = c.launchMcapSol * sol;
        const x = launchUsd ? t.fdvUsd / launchUsd : 1;
        const prev = c.hist.length >= 2 ? c.hist[c.hist.length - 2].fdv : undefined;
        const climbing = (c.pc5 ?? 0) > 5 || (prev != null && t.fdvUsd > prev * 1.05);
        const momentum = c.buys5 >= 20 && c.buys5 >= c.sells5 * 1.2 && x >= 1.4 && climbing;

        let fastCurve = false;
        let vel = 0;
        if (c.pool === "pump") {
          const pct = curveFromMcapSol(t.fdvUsd / sol) ?? 0;
          const first = c.hist[0];
          const mins = (now - first.t) / 60_000;
          const pct0 = curveFromMcapSol(first.fdv / sol) ?? 0;
          vel = mins >= 1 ? (pct - pct0) / mins : 0;
          fastCurve = pct >= 15 && vel >= 3 && c.buys5 >= 10;
        }

        if (momentum) {
          promote(
            c,
            "momentum",
            `${c.buys5} buys vs ${c.sells5} sells in 5 min, ${x.toFixed(1)}x from launch at ${Math.round(age / 60_000)} min old`
          );
        } else if (fastCurve) {
          promote(c, "curve", `Bonding curve filling ${vel.toFixed(1)}% a minute, ${Math.round(age / 60_000)} min after launch`);
        } else if (age > 10 * 60_000 && c.buys5 < 3) {
          cands.delete(c.mint); // went quiet
        }
      }
    }
  };

  // Tokens 2+ smart wallets bought: straight to the radar.
  const promoteSmart = async () => {
    if (NARRATIVE_ENABLED || !env.smartClusters) return;
    const mints = env.smartClusters().filter((m) => !sigs.has(m) && !archive.has(m)).slice(0, 30);
    if (!mints.length) return;
    try {
      const r = await api(`/api/tokens?addresses=${mints.join(",")}`);
      const j = (await r.json()) as { tokens: (TokenLookup & { priceChange5m?: number; volume5m?: number })[] };
      for (const t of j.tokens ?? []) {
        if (!t.fdvUsd) continue;
        const known = cands.get(t.address);
        const c: Cand = known ?? {
          mint: t.address,
          name: t.name,
          symbol: t.symbol,
          pool: poolOf(t.dexId),
          at: t.pairCreatedAt ?? Date.now(),
          launchMcapSol: 0,
          initialBuySol: 0,
          initialBuyTokens: 0,
          hist: [],
        };
        c.fdv = t.fdvUsd;
        c.liq = t.liquidityUsd;
        c.buys5 = t.m5Buys;
        c.sells5 = t.m5Sells;
        c.pc5 = t.priceChange5m;
        c.image = c.image ?? t.image;
        const n = env.smartWalletsFor?.(t.address).length ?? 2;
        promote(c, "smart", `${n} smart wallets bought it within 30 min`);
        const s = sigs.get(t.address);
        if (s) s.smartBuyers = env.smartWalletsFor?.(t.address).slice(0, 10) ?? s.smartBuyers;
      }
    } catch {
      /* next minute */
    }
  };

  // Keep pricing calls after their first hour, every 10 minutes for 7 days.
  const trackCalls = async () => {
    for (const book of [archive, early]) await trackBook(book);
    await trackBook(ultra, ULTRA_TRACK_MS);
  };
  const trackBook = async (book: typeof archive, trackMs?: number) => {
    const due = book.due(10 * 60_000, Date.now(), trackMs).filter((r) => !sigs.has(r.m) || Date.now() - r.t > 3600_000);
    for (let i = 0; i < due.length && i < 30 * 20; i += 30) {
      const batch = due.slice(i, i + 30);
      try {
        const r = await api(`/api/tokens?addresses=${batch.map((x) => x.m).join(",")}`);
        const j = (await r.json()) as { tokens: TokenLookup[] };
        const got = new Map((j.tokens ?? []).map((t) => [t.address, t]));
        for (const row of batch) {
          const t = got.get(row.m);
          if (t?.fdvUsd) book.price(row.m, t.fdvUsd, Date.now(), t.volume24h);
          else row.chk = Date.now(); // delisted or dead: check again later
        }
      } catch {
        /* next round */
      }
    }
  };

  const loadSol = async () => {
    try {
      const r = await api("/api/sol");
      const j = await r.json();
      if (typeof j.solUsd === "number") solUsd = j.solUsd;
    } catch {
      /* keep last */
    }
  };

  const pollProfiles = async () => {
    if (!matcher && NARRATIVE_ENABLED) return;
    try {
      const r = await api("/api/profiles");
      const j = (await r.json()) as {
        profiles: (TokenLookup & { description?: string; twitter?: string; telegram?: string; website?: string })[];
      };
      for (const p of j.profiles ?? []) {
        if (profileSeen.has(p.address)) continue;
        if (profileSeen.size > 50_000) profileSeen.clear();
        profileSeen.add(p.address);
        if (p.pairCreatedAt && Date.now() - p.pairCreatedAt > 6 * 3600_000) continue;
        if (!NARRATIVE_ENABLED) {
          // A team paying DexScreener on a fresh pair, with real buying: radar.
          if ((p.m5Buys ?? 0) < 10 || !p.fdvUsd) continue;
          const c: Cand = cands.get(p.address) ?? {
            mint: p.address,
            name: p.name,
            symbol: p.symbol,
            pool: poolOf(p.dexId),
            at: p.pairCreatedAt ?? Date.now(),
            launchMcapSol: 0,
            initialBuySol: 0,
            initialBuyTokens: 0,
            hist: [],
          };
          c.fdv = p.fdvUsd;
          c.liq = p.liquidityUsd;
          c.buys5 = p.m5Buys;
          c.sells5 = p.m5Sells;
          c.image = c.image ?? p.image;
          promote(c, "dexpaid", "Team paid for a DexScreener profile on a fresh pair, with buyers coming in");
          const s = sigs.get(p.address);
          if (s) {
            s.dexPaid = true;
            s.description = p.description;
            s.twitter = p.twitter;
            s.telegram = p.telegram;
            s.website = p.website;
          }
          continue;
        }
        consider({
          mint: p.address,
          name: p.name,
          symbol: p.symbol,
          pool: p.dexId,
          origin: "dexprofile",
          createdAt: p.pairCreatedAt ?? Date.now(),
          initialBuySol: 0,
          marketCapSol: 0,
          extra: {
            fdvUsd: p.fdvUsd,
            liquidityUsd: p.liquidityUsd,
            m5Buys: p.m5Buys,
            m5Sells: p.m5Sells,
            description: p.description,
            image: p.image,
            twitter: p.twitter,
            telegram: p.telegram,
            website: p.website,
          },
        });
      }
    } catch {
      /* next poll */
    }
  };

  const refreshDex = async () => {
    const now = Date.now();
    const list = [...sigs.values()].filter((s) => s.origin === "dexprofile" && now - s.createdAt < TRACK_MAX_MS).slice(0, 30);
    if (!list.length) return;
    try {
      const r = await api(`/api/tokens?addresses=${list.map((s) => s.mint).join(",")}`);
      const j = (await r.json()) as { tokens: TokenLookup[] };
      for (const t of j.tokens ?? []) {
        const s = sigs.get(t.address);
        if (!s) continue;
        const prevFdv = s.fdvUsd;
        s.fdvUsd = t.fdvUsd ?? s.fdvUsd;
        s.liquidityUsd = t.liquidityUsd ?? s.liquidityUsd;
        s.m5Buys = t.m5Buys ?? s.m5Buys;
        s.m5Sells = t.m5Sells ?? s.m5Sells;
        if (!s.fdvAtSignal && s.fdvUsd) s.fdvAtSignal = s.fdvUsd;
        if (s.fdvUsd && s.fdvUsd > (s.peakFdvUsd ?? 0)) s.peakFdvUsd = s.fdvUsd;
        if (prevFdv && s.fdvUsd) s.mcapChange5m = ((s.fdvUsd - prevFdv) / prevFdv) * 100;
      }
      dirty = true;
    } catch {
      /* next */
    }
  };

  const pollDexMomentum = async () => {
    const now = Date.now();
    // Young tokens, plus anything that reached the radar in the last hour (smart money clusters can be older).
    const young = [...sigs.values()]
      .filter((s) => now - s.createdAt < TRACK_MAX_MS || (s.promotedAt != null && now - s.promotedAt < 60 * 60_000) || lab.hasOpen(s.mint))
      // Tokens being measured (calls, lab fires) first, then the newest radar tokens.
      .sort((a, b) => Number(lab.hasOpen(b.mint) || !!b.calledAt) - Number(lab.hasOpen(a.mint) || !!a.calledAt) || (b.promotedAt ?? b.createdAt) - (a.promotedAt ?? a.createdAt))
      .slice(0, 150);
    for (let i = 0; i < young.length; i += 30) {
      const batch = young.slice(i, i + 30);
      try {
        const r = await api(`/api/tokens?addresses=${batch.map((s) => s.mint).join(",")}`);
        const j = (await r.json()) as { tokens: (TokenLookup & { priceChange5m?: number; volume5m?: number })[] };
        for (const t of j.tokens ?? []) {
          const s = sigs.get(t.address);
          if (!s || !t.fdvUsd) continue;
          if (s.pool === "pump" && solUsd && t.fdvUsd < 25 * solUsd) continue;
          if (bogusFdv(s.pool, s.createdAt, s.graduated, t.fdvUsd, solUsd)) continue;
          s.fdvUsd = t.fdvUsd;
          s.liquidityUsd = t.liquidityUsd ?? s.liquidityUsd;
          s.m5Buys = t.m5Buys ?? s.m5Buys;
          s.m5Sells = t.m5Sells ?? s.m5Sells;
          s.priceChange5m = t.priceChange5m;
          if (s.calledAt) archive.price(s.mint, t.fdvUsd, now, t.volume24h);
          if (s.earlyAt) early.price(s.mint, t.fdvUsd, now, t.volume24h);
          if (s.ultraAt) ultra.price(s.mint, t.fdvUsd, now, t.volume24h);
          lab.price(s.mint, t.fdvUsd, now);
          s.volume5m = t.volume5m;
          if (t.volume24h != null) s.volume24h = t.volume24h;
          if (!s.fdvAtSignal) s.fdvAtSignal = t.fdvUsd;
          if (t.fdvUsd > (s.peakFdvUsd ?? 0)) s.peakFdvUsd = t.fdvUsd;
          if (solUsd) {
            s.marketCapSol = t.fdvUsd / solUsd;
            if (s.marketCapSol > (s.peakMcapSol ?? 0)) s.peakMcapSol = s.marketCapSol;
          }
          let h = dexHist.get(s.mint);
          if (!h) dexHist.set(s.mint, (h = []));
          h.push({ t: now, fdv: t.fdvUsd });
          while (h.length && h[0].t < now - 6 * 60_000) h.shift();
          // Bonding curve progress and speed, estimated from market cap (pump.fun tokens before graduation).
          if (s.pool === "pump" && !s.graduated && solUsd) {
            const pct = curveFromMcapSol(t.fdvUsd / solUsd);
            const first = h[0];
            const pct0 = first ? curveFromMcapSol(first.fdv / solUsd) : undefined;
            if (pct != null) {
              s.curvePct = pct;
              const mins = first ? (now - first.t) / 60_000 : 0;
              s.curveVelPerMin = pct0 != null && mins >= 1 ? (pct - pct0) / mins : undefined;
              s.gradEtaMin = s.curveVelPerMin && s.curveVelPerMin > 0.2 ? Math.round((100 - pct) / s.curveVelPerMin) : undefined;
            }
          }
          if (s.buyers1m == null) {
            const base = h.find((x) => x.t >= now - 5 * 60_000) ?? h[0];
            s.mcapChange5m = base ? ((t.fdvUsd - base.fdv) / base.fdv) * 100 : undefined;
            const buys = s.m5Buys ?? 0;
            const sells = s.m5Sells ?? 0;
            const up = (s.mcapChange5m ?? 0) >= 10 || (s.priceChange5m ?? 0) >= 10;
            const rising = buys >= 10 && buys >= sells * 1.3 && up;
            if (rising && !s.rising) s.risingSince = now;
            s.rising = rising;
          }
        }
        dirty = true;
      } catch {
        /* next */
      }
    }
    for (const k of dexHist.keys()) if (!sigs.has(k)) dexHist.delete(k);
  };

  const pollOrders = async () => {
    const now = Date.now();
    const todo = [...sigs.values()]
      .filter((s) => !s.dexPaid && now - s.createdAt < TRACK_MAX_MS && now - s.createdAt > 60_000)
      .sort((a, b) => b.score - a.score)
      .slice(0, 20);
    await Promise.all(
      todo.map(async (s) => {
        try {
          const r = await api(`/api/orders?mint=${s.mint}`);
          if (!r.ok) return;
          const j = await r.json();
          if (j.paid) {
            s.dexPaid = true;
            s.dexPaidAt = j.paidAt;
            s.dexPaidTypes = j.types;
          }
          s.boosts = j.boosts || s.boosts;
        } catch {
          /* next */
        }
      })
    );
    if (todo.length) dirty = true;
  };

  // Telegram calls: which followed channels called our signals.
  const pollCalls = async () => {
    try {
      if (!CALLS_ENABLED) return;
      const r = await api("/api/calls");
      if (!r.ok) return;
      const j = (await r.json()) as { calls: { mint: string; channel: string; at: number }[] };
      const by = new Map<string, { ch: Set<string>; first: number }>();
      for (const c of j.calls ?? []) {
        const e = by.get(c.mint) ?? { ch: new Set<string>(), first: c.at };
        e.ch.add(c.channel);
        e.first = Math.min(e.first, c.at);
        by.set(c.mint, e);
      }
      for (const s of sigs.values()) {
        const e = by.get(s.mint);
        if (!e) continue;
        const merged = [...new Set([...(s.callers ?? []), ...e.ch])];
        if (merged.length !== (s.callers?.length ?? 0)) {
          s.callers = merged;
          s.firstCalledAt = Math.min(s.firstCalledAt ?? Infinity, e.first);
          dirty = true;
        }
      }
    } catch {
      /* next round */
    }
  };

  const computeMomentum = (now: number) => {
    for (const [mint, list] of trades) {
      const s = sigs.get(mint);
      if (!s) continue;
      const cut5 = now - 5 * 60_000;
      const cut1 = now - 60_000;
      while (list.length && list[0].t < now - 10 * 60_000) list.shift();
      let net1 = 0;
      let net5 = 0;
      let base5: number | undefined;
      for (const t of list) {
        if (t.t < cut5) continue;
        if (base5 === undefined) base5 = t.mcap;
        const v = t.buy ? t.sol : -t.sol;
        net5 += v;
        if (t.t >= cut1) net1 += v;
      }
      const bs = buyerStats.get(mint);
      let b1 = 0;
      let b5 = 0;
      const sizes: number[] = [];
      let total = 0;
      if (bs)
        for (const b of bs.values()) {
          if (b.first >= cut1) b1++;
          if (b.first >= cut5) b5++;
          sizes.push(b.sol);
          total += b.sol;
        }
      sizes.sort((a, b) => b - a);
      s.buyers1m = b1;
      s.buyers5m = b5;
      s.netSol1m = net1;
      s.netSol5m = net5;
      const start = base5 ?? s.mcapAtSignal;
      s.mcapChange5m = start && s.marketCapSol ? ((s.marketCapSol - start) / start) * 100 : undefined;
      s.top3Share = total > 0 && sizes.length >= 5 ? (sizes[0] + (sizes[1] ?? 0) + (sizes[2] ?? 0)) / total : undefined;
      const prevRate = Math.max(0, b5 - b1) / 4;
      const rising = b1 >= 3 && net1 > 0.3 && (s.mcapChange5m ?? 0) > 5 && b1 >= prevRate * 1.3;
      if (rising && !s.rising) s.risingSince = now;
      s.rising = rising;
    }
  };

  // Per-signal change stamps, so clients can ask for "what changed since T".
  const lastJson = new Map<string, string>();
  let lastPersist = 0;
  let lastDevPersist = Date.now();

  // Smart wallet learning, watcher matches and the track record log, once a minute.
  const outcomes = new Map<string, Outcome>();
  try {
    const raw = storage.get(OUTCOME_KEY);
    if (raw) for (const o of JSON.parse(raw) as Outcome[]) outcomes.set(o.m, o);
  } catch {
    /* none yet */
  }
  const minuteJobs = (now: number) => {
    let pruned = false;
    const keepHits: Record<string, Hit> = {};
    for (const [k, h] of Object.entries(hits)) {
      if (now - h.at < 24 * 3600_000) keepHits[k] = h;
      else pruned = true;
    }
    if (pruned) hits = keepHits;
    for (const s of sigs.values()) {
      const age = now - s.createdAt;
      const p = perf(s);
      // Watcher: smart wallets seen buying a token we signaled.
      const watched = env.smartWalletsFor?.(s.mint) ?? [];
      if (watched.length) {
        const merged = [...new Set([...(s.smartBuyers ?? []), ...watched])].slice(0, 10);
        if (merged.length !== (s.smartBuyers?.length ?? 0)) {
          s.smartBuyers = merged;
          dirty = true;
        }
      }
      if (env.smart && age > 45 * 60_000 && p && env.smart.has(s.mint)) env.smart.settle(s.mint, p.peak);
      if (age > 30 * 60_000 && p) {
        outcomes.set(s.mint, {
          m: s.mint,
          s: s.symbol,
          n: s.matchedDisplay,
          t: s.createdAt,
          e: s.fdvAtSignal ?? (solUsd && s.mcapAtSignal ? Math.round(s.mcapAtSignal * solUsd) : undefined),
          p: Math.round(p.peak * 100) / 100,
          ...(s.strong ? { st: 1 as const } : {}),
          ...(s.cleanLaunch ? { cl: 1 as const } : {}),
          ...(s.risingSince ? { ri: 1 as const } : {}),
          ...(s.smartBuyers?.length ? { sm: s.smartBuyers.length } : {}),
        });
      }
    }
    if (outcomes.size > 50_000) {
      const keep = [...outcomes.values()].sort((a, b) => b.t - a.t).slice(0, 50_000);
      outcomes.clear();
      for (const o of keep) outcomes.set(o.m, o);
    }
    try {
      storage.set(OUTCOME_KEY, JSON.stringify([...outcomes.values()]));
    } catch {
      /* ignore */
    }
    if (env.smart) {
      if (env.learnSample) learnFromSample(now);
      env.smart.persist();
    }
    try {
      archive.persist();
      early.persist();
      ultra.persist();
      lab.sweep(Date.now());
      lab.persist();
    } catch {
      /* ignore */
    }
  };

  // Learning sample: read early buyers of one random launch per minute at ~10 min old, judge it at ~45 min.
  const learnFromSample = (now: number) => {
    const book = env.smart!;
    const ready = recentLaunches.filter((l) => now - l.at >= 10 * 60_000 && now - l.at < 13 * 60_000 && !sampled.has(l.mint) && !sigs.has(l.mint));
    const pick = ready[Math.floor(Math.random() * ready.length)];
    if (pick) {
      sampled.set(pick.mint, { at: pick.at, baseUsd: solUsd ? pick.mcapSol * solUsd : 0 });
      queueCohort(pick.mint, pick.creator, 6, "low").then((co) => {
        if (co?.earlyWallets) book.observe(pick.mint, co.earlyWallets);
      });
    }
    // Judge up to 3 sampled tokens per minute (GeckoTerminal allows ~30 calls a minute).
    const due = [...sampled.entries()].filter(([m, x]) => now - x.at > 45 * 60_000 && book.has(m)).slice(0, 3);
    for (const [m, x] of due) {
      if (!x.baseUsd) {
        sampled.delete(m);
        continue;
      }
      api(`/api/peak?mint=${m}&from=${x.at}&base=${Math.round(x.baseUsd)}&window=45`)
        .then((r) => r.json())
        .then((j) => {
          if (typeof j.peakX === "number") book.settle(m, j.peakX);
          if (j.peakX !== null || now - x.at > 3 * 3600_000) sampled.delete(m);
        })
        .catch(() => {});
    }
    for (const [m, x] of sampled) if (now - x.at > 6 * 3600_000) sampled.delete(m);
  };

  const snapshot = (): CoreState => ({
    narratives,
    narrError,
    signals,
    hits,
    stats,
    fresh,
    watch,
    graduations,
    calls: archive.recent(7 * 24 * 3600_000),
    early: early.recent(7 * 24 * 3600_000),
    ultra: ultra.recent(ULTRA_TRACK_MS),
    radar: cands.size,
    solUsd,
  });

  const flush = env.every(1000, () => {
    const now = Date.now();
    if (wsState === "open" && now - lastMsgAt > 90_000) {
      lastMsgAt = now;
      ws?.close();
    }
    seenTimes = seenTimes.filter((t) => now - t < 60_000);
    stats = { ws: wsState, seen: counters.seen, perMin: seenTimes.length, matched: counters.matched, unnamedPending: unnamed.length };
    if (trades.size) {
      computeMomentum(now);
      dirty = true;
    }
    for (const s of sigs.values()) {
      if (!s.creator) continue;
      const rec = devs.get(s.creator);
      if (!rec) continue;
      const launches = rec.launches.filter((l) => l.mint !== s.mint && now - l.at < 24 * 3600_000).length;
      const dumps = rec.dumped.filter((m) => m !== s.mint).length;
      const checked = dumps + rec.clean.filter((m) => m !== s.mint).length;
      if (launches !== s.devLaunches24h || dumps !== s.devPrevDumps || checked !== s.devPrevChecked) {
        s.devLaunches24h = launches;
        s.devPrevDumps = dumps;
        s.devPrevChecked = checked;
        s.devSerial = launches >= 3;
        s.devKnownDumper = dumps > 0;
        dirty = true;
      }
    }
    if (now - lastDevPersist > 60_000) {
      lastDevPersist = now;
      persistDevs();
      minuteJobs(now);
    }
    // Scores depend on age (junk after 5/15 min), so rescore at least every 10 s.
    if (!dirty && now % 10_000 > 1000) {
      env.onFlush?.(snapshot());
      return;
    }
    dirty = false;
    const list = [...sigs.values()];
    let today = archive.todayCount(now);
    let lastHour = archive.recent(3600_000, now).length;
    let earlyToday = early.todayCount(now);
    let earlyHour = early.recent(3600_000, now).length;
    let ultraToday = ultra.todayCount(now);
    let ultraHour = ultra.recent(3600_000, now).length;
    for (const s of list) {
      Object.assign(s, NARRATIVE_ENABLED ? scoreSignal(s) : scoreV2(s));
      // Call gate: radar tokens get 60 minutes to clear every rule.
      if (!NARRATIVE_ENABLED && !s.calledAt && now - (s.promotedAt ?? s.createdAt) < 60 * 60_000) {
        const blockers = callBlockers(s, now);
        // Already has a proof but no wallet read yet: read it first in line, once, so the grade and the
        // wallet vetoes are in by the time the health checks pass.
        if (urgentRead.size > 5000) urgentRead.clear();
        if (urgentTries.size > 5000) urgentTries.clear();
        if (pathSince.size > 5000) pathSince.clear();
        const proofAt = callPath(s, now) ? (pathSince.get(s.mint) ?? (pathSince.set(s.mint, now), now)) : undefined;
        // Give the front-of-line wallet read up to 30 s, so its vetoes count; never longer (speed matters).
        if (proofAt && !s.cohort && now - proofAt < 30_000) blockers.push("reading wallets (up to 30 s)");
        if (!s.cohort && !urgentRead.has(s.mint) && proofAt) {
          urgentRead.add(s.mint);
          const mint = s.mint;
          queueCohort(mint, s.creator, 6, "urgent").then((co) => {
            const cur = sigs.get(mint);
            // A failed read (busy public RPC) is retried up to twice, a minute apart: fast movers wait for it.
            if (!co && (urgentTries.get(mint) ?? 0) < 2) {
              urgentTries.set(mint, (urgentTries.get(mint) ?? 0) + 1);
              setTimeout(() => urgentRead.delete(mint), 60_000);
            }
            if (!co || !cur || cur.cohort) return;
            const { earlyWallets, ...rest } = co;
            cur.cohort = rest;
            if (env.smart && earlyWallets) {
              env.smart.observe(cur.mint, earlyWallets);
              const found = env.smart.smartAmong(earlyWallets.filter((e) => !e.bundler && !e.linked).map((e) => e.w));
              cur.smartBuyers = [...new Set([...(cur.smartBuyers ?? []), ...found])].slice(0, 10);
            }
            dirty = true;
          });
        }
        if (!blockers.length && today >= CALL_MAX_PER_DAY) blockers.push(`daily call limit (${CALL_MAX_PER_DAY}) reached`);
        // Never call on a stale price (e.g. right after a restart, before the first fresh DexScreener read).
        const pricedAt = dexHist.get(s.mint)?.at(-1)?.t ?? 0;
        if (now - pricedAt > 90_000) blockers.push("waiting for a fresh price");
        if (!blockers.length && lastHour >= CALL_MAX_PER_HOUR) blockers.push(`hourly call limit (${CALL_MAX_PER_HOUR}) reached`);
        s.callBlockers = blockers;
        if (!blockers.length) {
          const mc = s.fdvUsd ?? (solUsd ? s.marketCapSol * solUsd : 0);
          const path = callPath(s, now);
          if (mc > 0 && path) {
            s.calledAt = now;
            s.callMcapUsd = mc;
            s.callPath = path;
            s.callWhy = callWhy(s, path, solUsd, now);
            today++;
            lastHour++;
            archive.add({
              m: s.mint,
              n: s.name,
              s: s.symbol,
              img: s.image,
              tr: path,
              rt: s.trigger,
              why: s.callWhy,
              t: now,
              la: s.createdAt,
              c: mc,
              sc: s.score,
              ...(s.strong ? { st: 1 as const } : {}),
              ...(s.cleanLaunch ? { cl: 1 as const } : {}),
              ...(s.smartBuyers?.length ? { sm: s.smartBuyers.length, sw: s.smartBuyers.slice(0, 5) } : {}),
              g: callGrade(s),
              bc: callReasons(s),
              ...launchStats(s),
              p1: mc,
              pk: mc,
              now: mc,
              chk: now,
              pool: s.pool,
            });
          }
        }
      }
      // Fresh launch tier: its own rule, caps and archive (ultra risky, never counted with the main calls).
      if (EARLY_ENABLED && !NARRATIVE_ENABLED && !s.earlyAt && s.promotedAt && now - s.createdAt < EARLY_WINDOW_MS && !early.has(s.mint)) {
        const pricedAt = dexHist.get(s.mint)?.at(-1)?.t ?? 0;
        const mc = s.fdvUsd ?? 0;
        if (now - pricedAt <= 90_000 && mc > 0 && earlyToday < EARLY_MAX_PER_DAY && earlyHour < EARLY_MAX_PER_HOUR && !earlyBlockers(s, now).length) {
          s.earlyAt = now;
          s.earlyMcapUsd = mc;
          earlyToday++;
          earlyHour++;
          early.add({
            m: s.mint,
            n: s.name,
            s: s.symbol,
            img: s.image,
            tr: "fresh",
            rt: s.trigger,
            why: earlyWhy(s, now),
            t: now,
            la: s.createdAt,
            c: mc,
            sc: s.score,
            ...(s.cleanLaunch ? { cl: 1 as const } : {}),
            ...(s.smartBuyers?.length ? { sm: s.smartBuyers.length, sw: s.smartBuyers.slice(0, 5) } : {}),
            g: "risky",
            bc: callReasons(s),
            ...launchStats(s),
            p1: mc,
            pk: mc,
            now: mc,
            chk: now,
            pool: s.pool,
          });
        }
      }
      // Ultra risky tier: every healthy launch over $6K in its first 3 minutes (its own archive and record).
      if (ULTRA_ENABLED && !NARRATIVE_ENABLED && !s.ultraAt && s.promotedAt && now - s.createdAt < EARLY_WINDOW_MS && !ultra.has(s.mint)) {
        const pricedAt = dexHist.get(s.mint)?.at(-1)?.t ?? 0;
        const mc = s.fdvUsd ?? 0;
        if (now - pricedAt <= 90_000 && mc > 0 && ultraToday < ULTRA_MAX_PER_DAY && ultraHour < ULTRA_MAX_PER_HOUR && !ultraBlockers(s, now).length) {
          s.ultraAt = now;
          s.ultraMcapUsd = mc;
          ultraToday++;
          ultraHour++;
          ultra.add({
            m: s.mint,
            n: s.name,
            s: s.symbol,
            img: s.image,
            tr: "ultra",
            rt: s.trigger,
            why: ultraWhy(s, now),
            t: now,
            la: s.createdAt,
            c: mc,
            sc: s.score,
            ...(s.smartBuyers?.length ? { sm: s.smartBuyers.length, sw: s.smartBuyers.slice(0, 5) } : {}),
            g: "risky",
            bc: callReasons(s),
            ...launchStats(s),
            p1: mc,
            pk: mc,
            now: mc,
            chk: now,
            pool: s.pool,
          });
        }
      }
      // Public lab: every live and candidate rule, uncapped, on a fresh price only.
      if (!NARRATIVE_ENABLED && s.promotedAt && now - (dexHist.get(s.mint)?.at(-1)?.t ?? 0) <= 90_000) lab.observe(s, now);
    }
    for (const s of list) {
      const { updatedAt: _u, ...rest } = s;
      void _u;
      const js = JSON.stringify(rest);
      if (lastJson.get(s.mint) !== js) {
        lastJson.set(s.mint, js);
        s.updatedAt = now;
      }
    }
    for (const k of lastJson.keys()) if (!sigs.has(k)) lastJson.delete(k);
    signals = list.map((s) => ({ ...s }));
    if (now - lastPersist > 15_000) {
      lastPersist = now;
      try {
        storage.set(STORE_KEY, JSON.stringify([...list].sort((a, b) => a.createdAt - b.createdAt).slice(-MAX_SIGNALS)));
      } catch {
        /* ignore */
      }
    }
    env.onFlush?.(snapshot());
  });

  (NARRATIVE_ENABLED ? loadNarratives() : loadSol()).then(() => {
    connect();
    pollProfiles();
  });
  const cancels = [
    flush,
    env.every(NARRATIVE_REFRESH_MS, NARRATIVE_ENABLED ? loadNarratives : loadSol),
    env.every(30_000, pollCandidates),
    env.every(60_000, promoteSmart),
    env.every(2 * 60_000, trackCalls),
    env.every(PROFILE_POLL_MS, pollProfiles),
    env.every(UNNAMED_POLL_MS, resolveUnnamed),
    env.every(DEX_REFRESH_MS, refreshDex),
    env.every(DEX_POLL_MS, pollDexMomentum),
    env.every(5 * 60_000, syncAccounts),
    env.every(60_000, pollOrders),
    env.every(60_000, pollCalls),
    env.every(20_000, () => void backfillCreates().catch(() => {})),
  ];

  return {
    snapshot,
    record: (range: string, tier: TierId = "balanced") =>
      NARRATIVE_ENABLED
        ? computeRecord([...outcomes.values()], range)
        : computeRecord(callOutcomes(tier === "conservative" ? archive.all().filter((r) => r.g === "solid") : bookOf(tier).all()), range),
    archive: (before: number, limit: number, tier: TierId = "balanced") =>
      tier === "conservative"
        ? archive.all().filter((r) => r.g === "solid" && r.t < before).sort((a, b) => b.t - a.t).slice(0, limit)
        : bookOf(tier).page(before, limit),
    // A tier's calls of the last `ms` that changed after `since` (everything when since = 0), for the board.
    feed: (tier: TierId, ms: number, since = 0) =>
      bookOf(tier)
        .changedSince(since, ms)
        .filter((r) => tier !== "conservative" || r.g === "solid")
        .sort((a, b) => b.t - a.t),
    call: (mint: string) => archive.get(mint) ?? early.get(mint) ?? ultra.get(mint) ?? null,
    earlyCount: () => early.size(),
    lab: (rangeMs: number) => ({ horizonMin: 45, rules: lab.stats(rangeMs) }),
    labRecent: (rule: string) => lab.recent(rule),
    // Each tier's settled calls (30 min+) in the range: count, 2x rate, down 80%+ now, paper trade before costs.
    scoreboard: (rangeMs: number, now = Date.now()) =>
      (["conservative", "balanced", "risky", "ultra"] as TierId[]).map((tier) => {
        const rows = (tier === "conservative" ? archive.all().filter((r) => r.g === "solid") : bookOf(tier).all()).filter(
          (r) => now - r.t <= rangeMs && now - r.t >= 30 * 60_000 && r.c > 0
        );
        const n = rows.length;
        const pv = rows.map((r) => (r.pp ? r.pp.x + r.pp.q * (r.now / r.c) : r.now / r.c));
        return {
          tier,
          n,
          hit2: n ? Math.round((rows.filter((r) => r.pk / r.c >= 2).length / n) * 1000) / 10 : 0,
          down80: n ? Math.round((rows.filter((r) => r.now / r.c < 0.2).length / n) * 1000) / 10 : 0,
          paper: n ? Math.round((pv.reduce((a, b) => a + b, 0) / n) * 1000) / 1000 : 0,
        };
      }),
    // Every call of a tier, for the public export.
    exportRows: (tier: TierId) => (tier === "conservative" ? archive.all().filter((r) => r.g === "solid") : bookOf(tier).all()).sort((a, b) => a.t - b.t),
    ultraCount: () => ultra.size(),
    tierCount: (tier: TierId) => (tier === "conservative" ? archive.all().filter((r) => r.g === "solid").length : bookOf(tier).size()),
    pumpStats: () => ({ ...pump, accountWallets: accountSubs.size, tokenTrades }),
    callCount: () => archive.size(),
    stop() {
      stopped = true;
      cancels.forEach((c) => c());
      timers.forEach((c) => c());
      persistDevs();
      try {
        storage.set(STORE_KEY, JSON.stringify([...sigs.values()].sort((a, b) => a.createdAt - b.createdAt)));
      } catch {
        /* ignore */
      }
      ws?.close();
    },
  };
}

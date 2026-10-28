"use client";

import { useEffect, useRef, useState } from "react";
import { Matcher, compact, type NarrativeTerm } from "./narrative";
import { scoreSignal } from "./score";
import { CALLS_ENABLED } from "./calls";
import { createSmartBook, type SmartBook } from "./smart";
import { curveFromMcapSol } from "./curve";
import { perf } from "./format";
import { createTicker } from "./ticker";
import { queueCohort } from "./cohort";
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
// Sources that list tokens which already exist. A new token copying one of them is a copycat, not a new narrative.
const CRYPTO_SOURCES = new Set(["coingecko", "gecko", "dexboost"]);
const DEV_KEY = "tns.devs.v1";
const WATCH_KEY = "tns.watch.v1";
const WATCH_WEIGHT = 6;
const DEV_KEEP_MS = 7 * 24 * 3600_000;
const DEX_POLL_MS = 20_000;

interface Launch {
  mint: string;
  at: number;
  buy: number; // dev initial buy in tokens
}

interface DevRec {
  launches: Launch[];
  dumped: string[]; // mints where the dev sold 50%+ of the initial buy
  clean: string[]; // mints checked and still held
}
const PUMP_V_TOKENS_START = 1_073_000_000;
const PUMP_REAL_TOKENS = 793_100_000;

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

// A bonding-curve token cannot be worth more than ~1000 SOL in its first 10 minutes on the curve.
// DexScreener sometimes prices brand new launchpad tokens wildly wrong; those updates are dropped.
const bogusFdv = (pool: string, createdAt: number, graduated: boolean | undefined, fdv: number, sol: number | null) =>
  !graduated && (pool === "pump" || pool === "bonk") && !!sol && Date.now() - createdAt < 10 * 60_000 && fdv > 1000 * sol;

const curvePct = (vTokens: unknown) => {
  const v = Number(vTokens);
  if (!isFinite(v) || v <= 0) return undefined;
  return Math.max(0, Math.min(100, ((PUMP_V_TOKENS_START - v) / PUMP_REAL_TOKENS) * 100));
};

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

export function useEngine() {
  const [narratives, setNarratives] = useState<NarrativesResponse | null>(null);
  const [narrError, setNarrError] = useState<string | null>(null);
  const [signals, setSignals] = useState<Signal[]>([]);
  const [hits, setHits] = useState<Record<string, Hit>>({});
  const [stats, setStats] = useState<EngineStats>({
    ws: "connecting",
    seen: 0,
    perMin: 0,
    matched: 0,
    unnamedPending: 0,
  });

  const matcher = useRef<Matcher | null>(null);
  const sigs = useRef(new Map<string, Signal>());
  const smartBook = useRef<SmartBook | null>(null);
  const buyers = useRef(new Map<string, Set<string>>());
  const termCount = useRef(new Map<string, number>());
  const seen = useRef(new Set<string>());
  const seenTimes = useRef<number[]>([]);
  const unnamed = useRef<Unnamed[]>([]);
  const tracked = useRef(new Set<string>());
  const ws = useRef<WebSocket | null>(null);
  const wsState = useRef<EngineStats["ws"]>("connecting");
  const dirty = useRef(true);
  const counters = useRef({ seen: 0, matched: 0 });
  const trades = useRef(new Map<string, Trade[]>());
  const buyerStats = useRef(new Map<string, Map<string, BuyerStat>>());
  const freshTerms = useRef(new Set<string>());
  const [fresh, setFresh] = useState<string[]>([]);
  const devs = useRef(new Map<string, DevRec>());
  const solUsd = useRef<number | null>(null);
  const dexHist = useRef(new Map<string, { t: number; fdv: number }[]>());
  const firstSeen = useRef<Record<string, number>>({});
  const termsRef = useRef<NarrativeTerm[]>([]);
  const watchRef = useRef<string[]>([]);
  const [watch, setWatchState] = useState<string[]>([]);
  const [graduations, setGraduations] = useState(0);
  const [role, setRole] = useState<"leader" | "standby">("leader");

  // Trending terms plus the user's own watch words in one matcher.
  const rebuildMatcher = () => {
    const byTerm = new Map(termsRef.current.map((t) => [t.term, { ...t, sources: [...t.sources] }]));
    for (const w of watchRef.current) {
      const key = compact(w);
      if (key.length < 3) continue;
      const cur = byTerm.get(key);
      if (cur) {
        cur.weight += WATCH_WEIGHT;
        if (!cur.sources.includes("watchlist")) cur.sources.push("watchlist");
      } else {
        byTerm.set(key, { term: key, display: w, weight: WATCH_WEIGHT, sources: ["watchlist"], context: "Your watchlist" });
      }
    }
    matcher.current = new Matcher([...byTerm.values()]);
  };

  const setWatch = (words: string[]) => {
    const clean = [...new Set(words.map((w) => w.trim()).filter((w) => compact(w).length >= 3))].slice(0, 50);
    watchRef.current = clean;
    setWatchState(clean);
    try {
      localStorage.setItem(WATCH_KEY, JSON.stringify(clean));
    } catch {
      /* ignore */
    }
    if (termsRef.current.length || clean.length) rebuildMatcher();
  };

  useEffect(() => {
    const startEngine = () => {
    let stopped = false;
    let retry = 0;
    const ticker = createTicker();
    const timers = new Set<() => void>();
    const later = (fn: () => void, ms: number) => {
      let cancel: () => void = () => {};
      cancel = ticker.after(ms, () => {
        timers.delete(cancel);
        fn();
      });
      timers.add(cancel);
    };
    let lastMsgAt = Date.now();

    const send = (msg: object) => {
      if (ws.current?.readyState === WebSocket.OPEN) ws.current.send(JSON.stringify(msg));
    };

    try {
      const w = JSON.parse(localStorage.getItem(WATCH_KEY) || "[]");
      if (Array.isArray(w)) {
        watchRef.current = w.filter((x) => typeof x === "string");
        setWatchState(watchRef.current);
        if (watchRef.current.length) rebuildMatcher();
      }
    } catch {
      /* no watchlist */
    }

    // restore previous session
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (raw) {
        const list = JSON.parse(raw) as Signal[];
        for (const s of list) {
          sigs.current.set(s.mint, s);
          seen.current.add(s.mint);
          termCount.current.set(s.matchedTerm, (termCount.current.get(s.matchedTerm) ?? 0) + 1);
        }
      }
    } catch {
      /* empty storage is fine */
    }

    try {
      const raw = localStorage.getItem(DEV_KEY);
      if (raw) {
        const obj = JSON.parse(raw) as Record<string, DevRec>;
        const cut = Date.now() - DEV_KEEP_MS;
        for (const [k, v] of Object.entries(obj)) {
          const launches = (v.launches ?? []).filter((l) => l.at > cut);
          if (launches.length || v.dumped?.length) {
            devs.current.set(k, { launches, dumped: v.dumped ?? [], clean: v.clean ?? [] });
          }
        }
      }
    } catch {
      /* no stored dev history */
    }

    smartBook.current = createSmartBook(
      {
        get: (k) => {
          try {
            return localStorage.getItem(k);
          } catch {
            return null;
          }
        },
        set: (k, v) => {
          try {
            localStorage.setItem(k, v);
          } catch {
            /* full */
          }
        },
      },
      15_000
    );

    const devRec = (creator: string) => {
      let r = devs.current.get(creator);
      if (!r) devs.current.set(creator, (r = { launches: [], dumped: [], clean: [] }));
      return r;
    };

    const persistDevs = () => {
      try {
        const cut = Date.now() - DEV_KEEP_MS;
        const out: Record<string, DevRec> = {};
        const rows = [...devs.current.entries()]
          .map(([k, v]) => [k, { ...v, launches: v.launches.filter((l) => l.at > cut).slice(-20) }] as const)
          // Only devs worth remembering: repeat launchers or known dumpers.
          .filter(([, v]) => v.launches.length >= 2 || v.dumped.length > 0)
          .sort((a, b) => (b[1].launches.at(-1)?.at ?? 0) - (a[1].launches.at(-1)?.at ?? 0))
          .slice(0, 4000);
        for (const [k, v] of rows) out[k] = v;
        localStorage.setItem(DEV_KEY, JSON.stringify(out));
      } catch {
        /* storage full */
      }
    };

    // Ask the chain how much of the initial buy the dev still holds.
    const devHeld = async (creator: string, mint: string, initial: number): Promise<number | null> => {
      if (!initial) return null;
      try {
        const r = await fetch(`/api/devbalance?owner=${creator}&mint=${mint}`);
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
      } else if (!rec.clean.includes(mint)) {
        rec.clean.push(mint);
      }
      rec.dumped = rec.dumped.slice(-20);
      rec.clean = rec.clean.slice(-20);
    };

    // Current token: first check after 60s, then every 2 min while it is being watched.
    const watchDev = (mint: string, attempt = 0) => {
      later(async () => {
        const s = sigs.current.get(mint);
        if (!s || !s.creator || !s.initialBuyTokens || stopped) return;
        const held = await devHeld(s.creator, mint, s.initialBuyTokens);
        if (held !== null) {
          s.devHeldPct = held;
          if (held < 0.5) {
            s.devSold = true;
            markDev(s.creator, mint, held);
          }
          dirty.current = true;
        }
        if (!s.devSold && Date.now() - s.createdAt < TRACK_MAX_MS && attempt < 30) watchDev(mint, attempt + 1);
      }, attempt === 0 ? 60_000 : 120_000);
    };

    // Previous tokens by the same dev: did they dump those? Checked once per mint.
    const checkPrevLaunches = async (creator: string, current: string) => {
      const rec = devs.current.get(creator);
      if (!rec) return;
      const todo = rec.launches
        .filter((l) => l.mint !== current && l.buy > 0 && !rec.dumped.includes(l.mint) && !rec.clean.includes(l.mint))
        .filter((l) => Date.now() - l.at > 5 * 60_000)
        .slice(-5);
      for (const l of todo) {
        const held = await devHeld(creator, l.mint, l.buy);
        if (held !== null) markDev(creator, l.mint, held);
      }
      if (todo.length) dirty.current = true;
    };

    const track = (mint: string) => {
      tracked.current.add(mint);
      send({ method: "subscribeTokenTrade", keys: [mint] });
      const s0 = sigs.current.get(mint);
      if (s0) s0.trackedUntil = Date.now() + TRACK_MS;
      const expire = () => {
        const s = sigs.current.get(mint);
        // Keep watching tokens that are still moving, up to an hour.
        const moving = s && (s.rising || s.strong || (s.buyers5m ?? 0) >= 3);
        if (s && moving && Date.now() - s.createdAt < TRACK_MAX_MS) {
          s.trackedUntil = Date.now() + TRACK_MS;
          later(expire, TRACK_MS);
          return;
        }
        tracked.current.delete(mint);
        buyers.current.delete(mint);
        trades.current.delete(mint);
        buyerStats.current.delete(mint);
        if (s) s.trackedUntil = undefined;
        send({ method: "unsubscribeTokenTrade", keys: [mint] });
      };
      later(expire, TRACK_MS);
    };

    const enrichMeta = async (s: Signal) => {
      if (!s.uri) return;
      try {
        const r = await fetch(`/api/meta?uri=${encodeURIComponent(s.uri)}`);
        if (!r.ok) return;
        const m = await r.json();
        const cur = sigs.current.get(s.mint);
        if (!cur) return;
        cur.description = cur.description ?? m.description;
        cur.image = cur.image ?? m.image;
        cur.twitter = cur.twitter ?? m.twitter;
        cur.telegram = cur.telegram ?? m.telegram;
        cur.website = cur.website ?? m.website;
        cur.metaChecked = true;
        cur.lowEffort = !cur.twitter && !cur.telegram && !cur.website && !cur.description;
        dirty.current = true;
      } catch {
        /* metadata is optional */
      }
    };

    const checkRug = (mint: string, attempt: number) => {
      later(async () => {
        const cur = sigs.current.get(mint);
        if (!cur || stopped) return;
        try {
          const r = await fetch(`/api/rugcheck?mint=${mint}`);
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
            // Holder picture changes fast early on: re-check at ~5, ~10 and ~20 min.
            const age = Date.now() - cur.createdAt;
            const next = age < 5 * 60_000 ? 5 * 60_000 : age < 10 * 60_000 ? 10 * 60_000 : age < 20 * 60_000 ? 20 * 60_000 : 0;
            if (next) later(() => checkRug(mint, 10), Math.max(15_000, next - age - 45_000));
          }
        } catch {
          if (attempt < 3) checkRug(mint, attempt + 1);
          else cur.rug = { status: "unavailable", risks: [] };
        }
        dirty.current = true;
      }, attempt === 0 ? 45_000 : attempt === 10 ? 45_000 : 60_000);
    };

    const consider = (c: Candidate) => {
      const m = matcher.current?.match(c.name, c.symbol);
      if (!m) return;
      const term = m.term.term;
      const copyIndex = termCount.current.get(term) ?? 0;
      termCount.current.set(term, copyIndex + 1);

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
        narrativeFirstSeen: firstSeen.current[term] ?? null,
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
        freshNarrative: freshTerms.current.has(term),
        mcapAtSignal: c.marketCapSol || undefined,
        peakMcapSol: c.marketCapSol || undefined,
        ...c.extra,
      };
      if (s.fdvUsd) {
        s.fdvAtSignal = s.fdvUsd;
        s.peakFdvUsd = s.fdvUsd;
      }
      sigs.current.set(s.mint, s);
      counters.current.matched++;

      if (sigs.current.size > MAX_SIGNALS) {
        const oldest = [...sigs.current.values()].sort((a, b) => a.createdAt - b.createdAt)[0];
        if (oldest) sigs.current.delete(oldest.mint);
      }

      setHits((h) => ({ ...h, [term]: { at: Date.now(), count: (h[term]?.count ?? 0) + 1 } }));
      track(s.mint);
      enrichMeta(s);
      checkRug(s.mint, 0);
      // Wallet cohorts once the first trades have settled, then again as snipers take profit.
      for (const delay of [15_000, 2 * 60_000, 10 * 60_000]) {
        later(async () => {
          const cur = sigs.current.get(s.mint);
          if (!cur || stopped) return;
          const c = await queueCohort(cur.mint, cur.creator);
          if (c) {
            const { earlyWallets, ...rest } = c;
            cur.cohort = rest;
            const book = smartBook.current;
            if (book && earlyWallets) {
              book.observe(cur.mint, earlyWallets);
              const found = book.smartAmong(earlyWallets.filter((e) => !e.bundler && !e.linked).map((e) => e.w));
              cur.smartBuyers = [...new Set([...(cur.smartBuyers ?? []), ...found])].slice(0, 10);
            }
            dirty.current = true;
          }
        }, delay);
      }
      if (s.creator) {
        watchDev(s.mint);
        checkPrevLaunches(s.creator, s.mint);
      }
      dirty.current = true;
    };

    const onCreate = (d: Record<string, any>) => {
      const mint: string = d.mint;
      if (seen.current.has(mint)) return;
      if (seen.current.size > 60_000) seen.current.clear();
      seen.current.add(mint);
      counters.current.seen++;
      seenTimes.current.push(Date.now());

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
        rec.launches.push({ mint, at: Date.now(), buy: Number(d.initialBuy) || 0 });
        if (rec.launches.length > 50) rec.launches.splice(0, rec.launches.length - 50);
      }
      if (!name && !symbol) {
        if (unnamed.current.length < 300) unnamed.current.push({ ...base, at: Date.now(), tries: 0 });
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

    const onTrade = (d: Record<string, any>) => {
      const s = sigs.current.get(d.mint);
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
          let set = buyers.current.get(s.mint);
          if (!set) buyers.current.set(s.mint, (set = new Set()));
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

      let list = trades.current.get(s.mint);
      if (!list) trades.current.set(s.mint, (list = []));
      list.push({ t: now, buy: d.txType === "buy", sol: amt, mcap: s.marketCapSol });
      if (list.length > 2000) list.splice(0, list.length - 2000);

      if (d.txType === "buy" && d.traderPublicKey && d.traderPublicKey !== s.creator) {
        if (amt >= WHALE_SOL) s.whaleBuys = (s.whaleBuys ?? 0) + 1;
        let bs = buyerStats.current.get(s.mint);
        if (!bs) buyerStats.current.set(s.mint, (bs = new Map()));
        const cur = bs.get(d.traderPublicKey);
        if (cur) cur.sol += amt;
        else bs.set(d.traderPublicKey, { sol: amt, first: now });
      }
      if (!s.mcapAtSignal && s.marketCapSol) s.mcapAtSignal = s.marketCapSol;
      if (s.marketCapSol && s.marketCapSol > (s.peakMcapSol ?? 0)) s.peakMcapSol = s.marketCapSol;
      if (s.pool === "pump" && d.vTokensInBondingCurve != null) s.curvePct = curvePct(d.vTokensInBondingCurve);
      dirty.current = true;
    };

    const connect = () => {
      if (stopped) return;
      wsState.current = "connecting";
      const sock = new WebSocket(WS_URL);
      ws.current = sock;
      sock.onopen = () => {
        retry = 0;
        wsState.current = "open";
        lastMsgAt = Date.now();
        sock.send(JSON.stringify({ method: "subscribeNewToken" }));
        sock.send(JSON.stringify({ method: "subscribeMigration" }));
        const now = Date.now();
        for (const s of sigs.current.values()) {
          if (now - s.createdAt < TRACK_MS && !tracked.current.has(s.mint)) track(s.mint);
        }
        if (tracked.current.size) {
          sock.send(JSON.stringify({ method: "subscribeTokenTrade", keys: [...tracked.current] }));
        }
      };
      sock.onmessage = (ev) => {
        lastMsgAt = Date.now();
        let d: Record<string, any>;
        try {
          d = JSON.parse(ev.data);
        } catch {
          return;
        }
        if (!d || !d.mint) return;
        if (d.txType !== "create" && d.txType !== "buy" && d.txType !== "sell") {
          // Migration event: the token finished its bonding curve and moved to an AMM.
          const s = sigs.current.get(d.mint);
          if (s && !s.graduated) {
            s.graduated = true;
            s.graduatedAt = Date.now();
            s.curvePct = 100;
            setGraduations((g) => g + 1);
            dirty.current = true;
          }
          return;
        }
        if (d.txType === "create") onCreate(d);
        else if (d.txType === "buy" || d.txType === "sell") onTrade(d);
      };
      sock.onclose = () => {
        wsState.current = "closed";
        if (!stopped) later(connect, Math.min(30_000, 1000 * 2 ** retry++));
      };
      sock.onerror = () => sock.close();
    };

    const loadNarratives = async () => {
      try {
        const r = await fetch("/api/narratives");
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const j = (await r.json()) as NarrativesResponse;

        // Fresh = new since the last dictionary (this session, or a stored one under 2h old), or weight up 50%.
        let prev: Record<string, number> | null = null;
        try {
          const raw = localStorage.getItem(DICT_KEY);
          if (raw) {
            const p = JSON.parse(raw) as { at: number; w: Record<string, number> };
            if (Date.now() - p.at < 2 * 3600_000) prev = p.w;
          }
        } catch {
          /* no baseline yet */
        }
        if (prev) {
          const f = new Set<string>();
          for (const t of j.terms) {
            const before = prev[t.term];
            if (before == null || t.weight >= before * 1.5) f.add(t.term);
          }
          // If almost everything looks new the baseline is too old to mean anything.
          freshTerms.current = f.size < j.terms.length * 0.6 ? f : new Set();
          setFresh([...freshTerms.current]);
        }
        try {
          const w: Record<string, number> = {};
          for (const t of j.terms) w[t.term] = t.weight;
          localStorage.setItem(DICT_KEY, JSON.stringify({ at: Date.now(), w }));
        } catch {
          /* ignore */
        }

        if (j.solUsd) solUsd.current = j.solUsd;

        // When did each narrative first show up? 0 means it was already there when tracking started.
        try {
          if (!Object.keys(firstSeen.current).length) {
            const raw = localStorage.getItem(FIRST_KEY);
            if (raw) firstSeen.current = JSON.parse(raw);
          }
          const baseline = !Object.keys(firstSeen.current).length;
          const nowTs = Date.now();
          for (const t of j.terms) {
            if (firstSeen.current[t.term] == null) firstSeen.current[t.term] = baseline ? 0 : nowTs;
          }
          const live = new Set(j.terms.map((t) => t.term));
          for (const [k, v] of Object.entries(firstSeen.current)) {
            // Forget narratives that dropped out long ago, so a comeback counts as new again.
            if (!live.has(k) && v && nowTs - v > FIRST_KEEP_MS) delete firstSeen.current[k];
          }
          localStorage.setItem(FIRST_KEY, JSON.stringify(firstSeen.current));
        } catch {
          /* first-seen tracking is optional */
        }
        termsRef.current = j.terms;
        rebuildMatcher();
        setNarratives(j);
        setNarrError(null);
      } catch (e) {
        setNarrError((e as Error).message);
      }
    };

    const resolveUnnamed = async () => {
      const now = Date.now();
      const batch = unnamed.current.splice(0, 30);
      if (!batch.length || !matcher.current) {
        unnamed.current.unshift(...batch);
        return;
      }
      try {
        const r = await fetch(`/api/tokens?addresses=${batch.map((b) => b.mint).join(",")}`);
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
                fdvUsd: t.fdvUsd && !bogusFdv(b.pool, b.at, false, t.fdvUsd, solUsd.current) ? t.fdvUsd : undefined,
                liquidityUsd: t.liquidityUsd,
                image: t.image,
              },
            });
          } else if (b.tries < 4 && now - b.at < 5 * 60_000) {
            unnamed.current.push({ ...b, tries: b.tries + 1 });
          }
        }
      } catch {
        unnamed.current.push(...batch.filter((b) => b.tries < 4).map((b) => ({ ...b, tries: b.tries + 1 })));
      }
    };

    const pollProfiles = async () => {
      if (!matcher.current) return;
      try {
        const r = await fetch("/api/profiles");
        const j = (await r.json()) as {
          profiles: (TokenLookup & { description?: string; twitter?: string; telegram?: string; website?: string })[];
        };
        for (const p of j.profiles ?? []) {
          if (seen.current.has(p.address)) continue;
          seen.current.add(p.address);
          // Profiles are often added to old tokens. Only fresh pairs count as a bottom entry.
          if (p.pairCreatedAt && Date.now() - p.pairCreatedAt > 6 * 3600_000) continue;
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
        /* next poll will retry */
      }
    };

    const refreshDex = async () => {
      const now = Date.now();
      const list = [...sigs.current.values()]
        .filter((s) => s.origin === "dexprofile" && now - s.createdAt < TRACK_MAX_MS)
        .slice(0, 30);
      if (!list.length) return;
      try {
        const r = await fetch(`/api/tokens?addresses=${list.map((s) => s.mint).join(",")}`);
        const j = (await r.json()) as { tokens: TokenLookup[] };
        for (const t of j.tokens ?? []) {
          const s = sigs.current.get(t.address);
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
        dirty.current = true;
      } catch {
        /* next refresh */
      }
    };

    // Free momentum source: poll DexScreener for every signal under an hour old.
    // (PumpPortal's per-token trade stream needs a funded API key, so it is not used for this.)
    const pollDexMomentum = async () => {
      const now = Date.now();
      const young = [...sigs.current.values()]
        .filter((s) => now - s.createdAt < TRACK_MAX_MS)
        .sort((a, b) => b.createdAt - a.createdAt)
        .slice(0, 90);
      for (let i = 0; i < young.length; i += 30) {
        const batch = young.slice(i, i + 30);
        try {
          const r = await fetch(`/api/tokens?addresses=${batch.map((s) => s.mint).join(",")}`);
          const j = (await r.json()) as { tokens: (TokenLookup & { priceChange5m?: number; volume5m?: number })[] };
          for (const t of j.tokens ?? []) {
            const s = sigs.current.get(t.address);
            if (!s || !t.fdvUsd) continue;
            // DexScreener sometimes reports a near-zero FDV for a pump.fun token before its first priced trade.
            // A bonding curve token cannot trade below ~28 SOL mcap, so treat that as not indexed yet.
            if (s.pool === "pump" && solUsd.current && t.fdvUsd < 25 * solUsd.current) continue;
            if (bogusFdv(s.pool, s.createdAt, s.graduated, t.fdvUsd, solUsd.current)) continue;
            s.fdvUsd = t.fdvUsd;
            s.liquidityUsd = t.liquidityUsd ?? s.liquidityUsd;
            s.m5Buys = t.m5Buys ?? s.m5Buys;
            s.m5Sells = t.m5Sells ?? s.m5Sells;
            s.priceChange5m = t.priceChange5m;
            s.volume5m = t.volume5m;
            if (!s.fdvAtSignal) s.fdvAtSignal = t.fdvUsd;
            if (t.fdvUsd > (s.peakFdvUsd ?? 0)) s.peakFdvUsd = t.fdvUsd;
            if (solUsd.current) {
              s.marketCapSol = t.fdvUsd / solUsd.current;
              if (s.marketCapSol > (s.peakMcapSol ?? 0)) s.peakMcapSol = s.marketCapSol;
            }

            let h = dexHist.current.get(s.mint);
            if (!h) dexHist.current.set(s.mint, (h = []));
            h.push({ t: now, fdv: t.fdvUsd });
            while (h.length && h[0].t < now - 6 * 60_000) h.shift();
            if (s.pool === "pump" && !s.graduated && solUsd.current) {
              const pct = curveFromMcapSol(t.fdvUsd / solUsd.current);
              const first = h[0];
              const pct0 = first ? curveFromMcapSol(first.fdv / solUsd.current) : undefined;
              if (pct != null) {
                s.curvePct = pct;
                const mins = first ? (now - first.t) / 60_000 : 0;
                s.curveVelPerMin = pct0 != null && mins >= 1 ? (pct - pct0) / mins : undefined;
                s.gradEtaMin = s.curveVelPerMin && s.curveVelPerMin > 0.2 ? Math.round((100 - pct) / s.curveVelPerMin) : undefined;
              }
            }

            // Trade stream momentum wins when it exists.
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
          dirty.current = true;
        } catch {
          /* next poll */
        }
      }
      for (const k of dexHist.current.keys()) if (!sigs.current.has(k)) dexHist.current.delete(k);
    };

    // DEX paid: check the best young signals once a minute (DexScreener allows ~60 order lookups per minute).
    const pollOrders = async () => {
      const now = Date.now();
      const todo = [...sigs.current.values()]
        .filter((s) => !s.dexPaid && now - s.createdAt < TRACK_MAX_MS && now - s.createdAt > 60_000)
        .sort((a, b) => b.score - a.score)
        .slice(0, 20);
      await Promise.all(
        todo.map(async (s) => {
          try {
            const r = await fetch(`/api/orders?mint=${s.mint}`);
            if (!r.ok) return;
            const j = await r.json();
            if (j.paid) {
              s.dexPaid = true;
              s.dexPaidAt = j.paidAt;
              s.dexPaidTypes = j.types;
            }
            s.boosts = j.boosts || s.boosts;
          } catch {
            /* next round */
          }
        })
      );
      if (todo.length) dirty.current = true;
    };

    // Telegram calls: which followed channels called our signals.
    const pollCalls = async () => {
      try {
        if (!CALLS_ENABLED) return;
        const r = await fetch("/api/calls");
        if (!r.ok) return;
        const j = (await r.json()) as { calls: { mint: string; channel: string; at: number }[] };
        const by = new Map<string, { ch: Set<string>; first: number }>();
        for (const c of j.calls ?? []) {
          const e = by.get(c.mint) ?? { ch: new Set<string>(), first: c.at };
          e.ch.add(c.channel);
          e.first = Math.min(e.first, c.at);
          by.set(c.mint, e);
        }
        for (const s of sigs.current.values()) {
          const e = by.get(s.mint);
          if (!e) continue;
          const merged = [...new Set([...(s.callers ?? []), ...e.ch])];
          if (merged.length !== (s.callers?.length ?? 0)) {
            s.callers = merged;
            s.firstCalledAt = Math.min(s.firstCalledAt ?? Infinity, e.first);
            dirty.current = true;
          }
        }
      } catch {
        /* next round */
      }
    };

    // Rolling windows over the live trade stream.
    const computeMomentum = (now: number) => {
      for (const [mint, list] of trades.current) {
        const s = sigs.current.get(mint);
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
        const bs = buyerStats.current.get(mint);
        let b1 = 0;
        let b5 = 0;
        const sizes: number[] = [];
        let total = 0;
        if (bs) {
          for (const b of bs.values()) {
            if (b.first >= cut1) b1++;
            if (b.first >= cut5) b5++;
            sizes.push(b.sol);
            total += b.sol;
          }
        }
        sizes.sort((a, b) => b - a);
        s.buyers1m = b1;
        s.buyers5m = b5;
        s.netSol1m = net1;
        s.netSol5m = net5;
        const start = base5 ?? s.mcapAtSignal;
        s.mcapChange5m = start && s.marketCapSol ? ((s.marketCapSol - start) / start) * 100 : undefined;
        s.top3Share = total > 0 && sizes.length >= 5 ? (sizes[0] + (sizes[1] ?? 0) + (sizes[2] ?? 0)) / total : undefined;

        // Rising: new buyers this minute, money flowing in, price up, and faster than the previous 4 min average.
        const prevRate = Math.max(0, b5 - b1) / 4;
        const rising = b1 >= 3 && net1 > 0.3 && (s.mcapChange5m ?? 0) > 5 && b1 >= prevRate * 1.3;
        if (rising && !s.rising) s.risingSince = now;
        s.rising = rising;
      }
    };

    let lastPersist = 0;
    let lastDevPersist = Date.now();
    const flush = ticker.every(1000, () => {
      const now = Date.now();
      // Watchdog: pump.fun launches every few seconds, so 90s of silence means a stalled socket.
      if (wsState.current === "open" && now - lastMsgAt > 90_000) {
        lastMsgAt = now;
        ws.current?.close();
      }
      seenTimes.current = seenTimes.current.filter((t) => now - t < 60_000);
      setStats({
        ws: wsState.current,
        seen: counters.current.seen,
        perMin: seenTimes.current.length,
        matched: counters.current.matched,
        unnamedPending: unnamed.current.length,
      });
      if (trades.current.size) {
        computeMomentum(now);
        dirty.current = true;
      }
      for (const s of sigs.current.values()) {
        if (!s.creator) continue;
        const rec = devs.current.get(s.creator);
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
          dirty.current = true;
        }
      }
      if (now - lastDevPersist > 30_000 && smartBook.current) {
        // Judge signals older than 45 min for smart wallet learning.
        for (const s of sigs.current.values()) {
          const p = perf(s);
          if (p && now - s.createdAt > 45 * 60_000 && smartBook.current.has(s.mint)) smartBook.current.settle(s.mint, p.peak);
        }
        smartBook.current.persist();
      }
      if (now - lastDevPersist > 30_000) {
        lastDevPersist = now;
        persistDevs();
      }
      if (!dirty.current) return;
      dirty.current = false;
      const list = [...sigs.current.values()];
      for (const s of list) Object.assign(s, scoreSignal(s));
      setSignals(list.map((s) => ({ ...s })));
      if (now - lastPersist > 5000) {
        lastPersist = now;
        try {
          localStorage.setItem(STORE_KEY, JSON.stringify(list.sort((a, b) => a.createdAt - b.createdAt).slice(-500)));
        } catch {
          /* storage full or blocked */
        }
      }
    });

    loadNarratives().then(() => {
      connect();
      pollProfiles();
    });
    const nTimer = ticker.every(NARRATIVE_REFRESH_MS, loadNarratives);
    const pTimer = ticker.every(PROFILE_POLL_MS, pollProfiles);
    const uTimer = ticker.every(UNNAMED_POLL_MS, resolveUnnamed);
    const dTimer = ticker.every(DEX_REFRESH_MS, refreshDex);
    const mTimer = ticker.every(DEX_POLL_MS, pollDexMomentum);
    const oTimer = ticker.every(60_000, pollOrders);
    const cTimer = ticker.every(60_000, pollCalls);

    return () => {
      stopped = true;
      flush();
      nTimer();
      pTimer();
      uTimer();
      dTimer();
      mTimer();
      oTimer();
      cTimer();
      persistDevs();
      timers.forEach((cancel) => cancel());
      ticker.close();
      ws.current?.close();
    };
    };

    // Only one tab runs the engine: one PumpPortal socket (their rules) and one writer to storage.
    // Other tabs wait on a Web Lock, mirror the leader's signals, and take over when it closes.
    let stopEngine: (() => void) | null = null;
    let releaseLock: (() => void) | null = null;
    let disposed = false;
    const mirror = () => {
      try {
        const raw = localStorage.getItem(STORE_KEY);
        if (raw) setSignals(JSON.parse(raw) as Signal[]);
      } catch {
        /* nothing to mirror */
      }
    };
    const onStorage = (e: StorageEvent) => {
      if (e.key === STORE_KEY) mirror();
    };
    const lead = () => {
      if (disposed) return;
      window.removeEventListener("storage", onStorage);
      setRole("leader");
      stopEngine = startEngine();
    };
    const locks = (navigator as Navigator & { locks?: LockManager }).locks;
    if (locks) {
      setRole("standby");
      mirror();
      window.addEventListener("storage", onStorage);
      fetch("/api/narratives")
        .then((r) => (r.ok ? r.json() : null))
        .then((j) => {
          if (j && !disposed) setNarratives((cur) => cur ?? (j as NarrativesResponse));
        })
        .catch(() => {});
      locks
        .request(
          "tns-engine",
          () =>
            new Promise<void>((res) => {
              releaseLock = res;
              lead();
            })
        )
        .catch(() => lead());
    } else {
      lead();
    }

    return () => {
      disposed = true;
      window.removeEventListener("storage", onStorage);
      stopEngine?.();
      releaseLock?.();
    };
  }, []);

  const clearHistory = () => {
    sigs.current.clear();
    termCount.current.clear();
    try {
      localStorage.removeItem(STORE_KEY);
    } catch {
      /* ignore */
    }
    setHits({});
    dirty.current = true;
  };

  return { narratives, narrError, signals, hits, stats, clearHistory, fresh, watch, setWatch, graduations, role };
}

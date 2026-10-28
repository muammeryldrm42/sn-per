// Trader network: what named KOLs and our smart wallets buy and sell, as a live feed (like pnl.meme's
// "latest moves"), plus per-token counts of distinct tracked buyers. Trades come from two places:
// - PumpPortal account trades when PUMPPORTAL_API_KEY is set (real time, pump.fun and PumpSwap, paid per message)
// - otherwise the worker polls the wallets over RPC, round robin (slower, free)
import { inBatches, rpc, TX_OPTS, type ParsedTx, type SigInfo } from "./cohort";
import { FOMO_RELAYER } from "./fomo";

export interface Move {
  t: number; // trade time (block time when known)
  w: string; // wallet
  k: "buy" | "sell";
  m: string; // mint
  sol: number; // SOL in or out (approximate when read from balances)
  mc?: number; // market cap in SOL at the trade (PumpPortal only)
  via?: "fomo"; // traded through the Fomo app
  sig?: string;
  xfer?: true; // tokens moved without SOL changing hands (sent or received, not a trade)
  usd?: number; // paid or received in USDC/USDT (Fomo trades settle in USDC)
}

export interface TokenMeta {
  s?: string;
  n?: string;
  img?: string;
  fdv?: number;
}

interface Store {
  get(k: string): string | null;
  set(k: string, v: string): void;
}

const KEY = "tns.moves.v1";
// A buy only counts as a signal (smart money proof, clusters) from this size up. Tiny buys from tracked wallets are
// usually their sniper bots testing every launch, or bait, not conviction. Still shown in the feed.
const MIN_SIGNAL_SOL = Number((typeof process !== "undefined" && process.env.KOL_MIN_BUY_SOL) || 0.2);
const sized = (mv: Move) => mv.sol >= MIN_SIGNAL_SOL || (mv.usd ?? 0) >= MIN_SIGNAL_SOL * 100;
const MAX_MOVES = 3000;
const IGNORE = new Set([
  "So11111111111111111111111111111111111111112",
  "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
  "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB",
]);

export function createTraderFeed(storage: Store) {
  let moves: Move[] = [];
  const seen = new Set<string>();
  const meta = new Map<string, TokenMeta>();
  try {
    const j = JSON.parse(storage.get(KEY) || "null") as { moves: Move[]; meta: [string, TokenMeta][] } | null;
    if (j) {
      moves = j.moves ?? [];
      for (const [k, v] of j.meta ?? []) meta.set(k, v);
      for (const mv of moves) seen.add(`${mv.sig ?? mv.t}:${mv.w}:${mv.m}:${mv.k}`);
    }
  } catch {
    /* fresh feed */
  }
  let dirty = false;

  const add = (mv: Move) => {
    if (IGNORE.has(mv.m) || !(mv.sol >= 0)) return false;
    const key = `${mv.sig ?? mv.t}:${mv.w}:${mv.m}:${mv.k}`;
    if (seen.has(key)) return false;
    seen.add(key);
    moves.push(mv);
    if (moves.length > MAX_MOVES) {
      const drop = moves.splice(0, moves.length - MAX_MOVES);
      for (const d of drop) seen.delete(`${d.sig ?? d.t}:${d.w}:${d.m}:${d.k}`);
    }
    dirty = true;
    return true;
  };

  // Distinct tracked wallets that bought a token within the window.
  const buyersOf = (mint: string, windowMs: number, now = Date.now()) => {
    const out = new Map<string, number>();
    for (const mv of moves) if (mv.m === mint && mv.k === "buy" && !mv.xfer && sized(mv) && now - mv.t <= windowMs && !out.has(mv.w)) out.set(mv.w, mv.t);
    return out;
  };

  return {
    add,
    setMeta(mint: string, m: TokenMeta) {
      meta.set(mint, { ...meta.get(mint), ...m });
      dirty = true;
    },
    meta: (mint: string) => meta.get(mint),
    needMeta(limit = 30) {
      const out: string[] = [];
      for (let i = moves.length - 1; i >= 0 && out.length < limit; i--) {
        const m = moves[i].m;
        if (!meta.has(m) && !out.includes(m)) out.push(m);
      }
      return out;
    },
    buyersOf,
    // Tokens that `min` or more distinct tracked wallets bought within the window, newest cluster first.
    clusters(min = 2, windowMs = 30 * 60_000, now = Date.now()) {
      const by = new Map<string, Map<string, number>>();
      for (const mv of moves) {
        if (mv.k !== "buy" || mv.xfer || !sized(mv) || now - mv.t > windowMs) continue;
        const b = by.get(mv.m) ?? new Map<string, number>();
        if (!b.has(mv.w)) b.set(mv.w, mv.t);
        by.set(mv.m, b);
      }
      return [...by.entries()]
        .filter(([, b]) => b.size >= min)
        .map(([mint, b]) => ({ mint, wallets: [...b.keys()], at: Math.max(...b.values()) }))
        .sort((a, b) => b.at - a.at);
    },
    list(limit = 100, since = 0) {
      const out: Move[] = [];
      for (let i = moves.length - 1; i >= 0 && out.length < limit; i--) if (moves[i].t > since) out.push(moves[i]);
      return out;
    },
    // Most bought by tracked wallets in the window: distinct buyers, buys, sells, and buys per 2-minute bucket.
    buzz(windowMs = 3600_000, now = Date.now()) {
      const by = new Map<string, { buyers: Set<string>; buys: number; sells: number; sol: number; per: number[]; last: number }>();
      const buckets = 30;
      const step = windowMs / buckets;
      for (const mv of moves) {
        if (now - mv.t > windowMs || mv.xfer) continue;
        const b = by.get(mv.m) ?? { buyers: new Set(), buys: 0, sells: 0, sol: 0, per: Array(buckets).fill(0), last: 0 };
        if (mv.k === "buy") {
          b.buyers.add(mv.w);
          b.buys++;
          b.sol += mv.sol;
          const i = Math.min(buckets - 1, Math.max(0, Math.floor((mv.t - (now - windowMs)) / step)));
          b.per[i]++;
        } else b.sells++;
        b.last = Math.max(b.last, mv.t);
        by.set(mv.m, b);
      }
      return [...by.entries()]
        .filter(([, b]) => b.buyers.size > 0)
        .map(([mint, b]) => ({ mint, buyers: b.buyers.size, wallets: [...b.buyers].slice(0, 8), buys: b.buys, sells: b.sells, sol: Math.round(b.sol * 100) / 100, per: b.per, last: b.last, ...meta.get(mint) }))
        .sort((a, b) => b.buyers - a.buyers || b.sol - a.sol)
        .slice(0, 40);
    },
    // Per wallet: buys and sells in the last 24h, last move.
    people(now = Date.now()) {
      const by = new Map<string, { buys: number; sells: number; sol: number; last: number; lastMint: string; lastK: string }>();
      for (const mv of moves) {
        if (now - mv.t > 24 * 3600_000 || mv.xfer) continue;
        const p = by.get(mv.w) ?? { buys: 0, sells: 0, sol: 0, last: 0, lastMint: "", lastK: "" };
        if (mv.k === "buy") {
          p.buys++;
          p.sol += mv.sol;
        } else p.sells++;
        if (mv.t >= p.last) {
          p.last = mv.t;
          p.lastMint = mv.m;
          p.lastK = mv.k;
        }
        by.set(mv.w, p);
      }
      return by;
    },
    size: () => moves.length,
    persist() {
      if (!dirty) return;
      dirty = false;
      const keep = moves.slice(-800);
      const mints = new Set(keep.map((m) => m.m));
      try {
        storage.set(KEY, JSON.stringify({ moves: keep, meta: [...meta.entries()].filter(([k]) => mints.has(k)) }));
      } catch {
        /* storage full */
      }
    },
  };
}

export type TraderFeed = ReturnType<typeof createTraderFeed>;

// Token buys and sells of wallet `w` inside one parsed transaction.
export function walletTrades(tx: ParsedTx, w: string, sig?: string): Move[] {
  if (!tx?.meta || tx.meta.err) return [];
  const delta = new Map<string, number>();
  for (const b of tx.meta.postTokenBalances ?? []) if (b.owner === w) delta.set(b.mint, (delta.get(b.mint) ?? 0) + (b.uiTokenAmount.uiAmount ?? 0));
  for (const b of tx.meta.preTokenBalances ?? []) if (b.owner === w) delta.set(b.mint, (delta.get(b.mint) ?? 0) - (b.uiTokenAmount.uiAmount ?? 0));
  const keys = tx.transaction.message.accountKeys;
  const idx = keys.findIndex((k) => k.pubkey === w);
  const lamports = idx >= 0 ? (tx.meta.postBalances[idx] - tx.meta.preBalances[idx]) / 1e9 : 0;
  const wsol = delta.get("So11111111111111111111111111111111111111112") ?? 0;
  const sol = Math.abs(lamports + wsol);
  const stable = Math.abs((delta.get("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v") ?? 0) + (delta.get("Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB") ?? 0));
  const t = (tx.blockTime ?? Math.floor(Date.now() / 1000)) * 1000;
  const via = keys[0]?.pubkey === FOMO_RELAYER ? ("fomo" as const) : undefined;
  const out: Move[] = [];
  for (const [mint, d] of delta) {
    if (IGNORE.has(mint) || Math.abs(d) < 1e-9) continue;
    // No SOL moved with the tokens: a transfer (often a dev sending a KOL a bag), not a trade.
    const xfer = sol < 0.002 && stable < 0.5;
    out.push({
      t,
      w,
      k: d > 0 ? "buy" : "sell",
      m: mint,
      sol: Math.round(sol * 1000) / 1000,
      ...(stable >= 0.5 ? { usd: Math.round(stable * 100) / 100 } : {}),
      ...(via ? { via } : {}),
      ...(sig ? { sig } : {}),
      ...(xfer ? { xfer: true as const } : {}),
    });
  }
  return out;
}

// Free mode: poll wallets over RPC, `perTick` wallets every 15 s, round robin, newest signatures only.
export function createWalletPoller(feed: TraderFeed, wallets: () => string[], perTick: number) {
  const cursor = new Map<string, string>();
  let pos = 0;
  let polled = 0;
  const tick = async () => {
    const list = wallets();
    if (!list.length) return;
    const batch: string[] = [];
    for (let i = 0; i < Math.min(perTick, list.length); i++) batch.push(list[(pos + i) % list.length]);
    pos = (pos + batch.length) % Math.max(1, list.length);
    const now = Date.now();
    const fresh: { w: string; sig: string }[] = [];
    await inBatches(batch, 4, async (w) => {
      const until = cursor.get(w);
      const sigs = await rpc<SigInfo[]>("getSignaturesForAddress", [w, { limit: 12, ...(until ? { until } : {}) }]);
      polled++;
      if (!sigs || !sigs.length) return;
      cursor.set(w, sigs[0].signature);
      if (!until) return; // first visit only sets the cursor
      for (const s of sigs) if (!s.err && s.blockTime && now - s.blockTime * 1000 < 30 * 60_000) fresh.push({ w, sig: s.signature });
    });
    await inBatches(fresh.slice(0, 30), 5, async ({ w, sig }) => {
      const tx = await rpc<ParsedTx>("getTransaction", [sig, TX_OPTS]);
      if (tx) for (const mv of walletTrades(tx, w, sig)) feed.add(mv);
    });
  };
  return { tick, stats: () => ({ wallets: wallets().length, perTick, polled }) };
}

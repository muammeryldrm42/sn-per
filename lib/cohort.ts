"use client";

// Wallet cohort analysis built from raw Solana RPC data (free public endpoints, runs in the browser).
// For a token it works out who bought in the first slots, how much of the supply those wallets still hold,
// which buyers are brand new wallets, and which buyers were funded by the dev or by a shared funder.

import { PublicKey } from "@solana/web3.js";
import { FOMO_RELAYER } from "./fomo";



const ATA_PROGRAM = new PublicKey("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");
const TOKEN_PROGRAM = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
const TOKEN_2022 = new PublicKey("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb");

const PUBLIC_RPCS = ["https://solana-rpc.publicnode.com", "https://api.mainnet-beta.solana.com"];
const EXTRA_RPC = process.env.NEXT_PUBLIC_RPC_URL || process.env.RPC_URL;
const RPCS = EXTRA_RPC ? [EXTRA_RPC, ...PUBLIC_RPCS] : PUBLIC_RPCS;

const EARLY_SLOTS = 3; // creation slot + 3 slots (~1.5 s) counts as sniping
const EARLY_WINDOW_S = 600; // early buyers: first 10 minutes after launch
const MAX_EARLY_TX = 45;
const MAX_WALLETS = 24;
const FRESH_MAX_TX = 30; // a wallet with fewer lifetime transactions than this...
const FRESH_MAX_AGE_MS = 3 * 24 * 3600_000; // ...whose first transaction is this recent, is fresh

export interface Cohort {
  at: number;
  supply: number;
  holdingsKnown: boolean; // false when current balances could not be read; hold % are then 0 and meaningless
  devHoldPct: number;
  bundlerHoldPct: number;
  bundlerCount: number;
  sniperHoldPct: number;
  sniperCount: number;
  freshHoldPct: number;
  freshCount: number;
  linkedCount: number; // early buyers funded by the dev or by a funder shared with other early buyers
  combinedRiskPct: number; // dev + bundlers + snipers + fresh + linked, each wallet counted once
  bundleBuySol: number; // SOL spent by non-dev wallets in the creation slot
  earlyBuyers: number;
  cleanLaunch: boolean;
  partial: boolean; // some RPC calls failed, numbers are a lower bound
  fomoBuyers?: number; // early buyers who bought through the Fomo app
  // Every early buyer (not the dev). Used for smart wallet learning, stripped before a signal is shared.
  earlyWallets?: EarlyWallet[];
}

export interface EarlyWallet {
  w: string;
  bundler: boolean;
  sniper: boolean;
  fresh: boolean;
  linked: boolean;
  fomo?: boolean; // bought through the Fomo app
}

interface Role {
  early?: boolean;
  dev?: boolean;
  bundler?: boolean;
  sniper?: boolean;
  fresh?: boolean;
  linked?: boolean;
  fomo?: boolean;
  bought: number;
}

let rr = 0;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Shared request budget for every RPC call (cohorts, smart wallet watcher, learning), so free endpoints
// are never flooded and do not start answering 429. Your own RPC gets a bigger budget.
const RPS = Number((typeof process !== "undefined" && process.env.RPC_RPS) || 0) || (EXTRA_RPC ? 25 : 8);
let tokens = RPS;
let lastRefill = Date.now();
export const rpcStats = { calls: 0, failed: 0, limited: 0 };
async function take() {
  for (;;) {
    const now = Date.now();
    tokens = Math.min(RPS, tokens + ((now - lastRefill) / 1000) * RPS);
    lastRefill = now;
    if (tokens >= 1) {
      tokens -= 1;
      return;
    }
    await sleep(Math.ceil(((1 - tokens) / RPS) * 1000));
  }
}

// Per endpoint and method cool-downs: a 429 parks that endpoint for that method for a few seconds,
// "needs a personal token" / "too many accounts" parks it for 10 minutes, and the other endpoint is used.
const cooldown = new Map<string, number>();
function pickEndpoint(method: string): { url: string; wait: number } {
  const now = Date.now();
  let best = RPCS[0];
  let bestUntil = Infinity;
  for (let i = 0; i < RPCS.length; i++) {
    const url = RPCS[(rr + i) % RPCS.length];
    const until = cooldown.get(`${url}|${method}`) ?? 0;
    if (until <= now) {
      rr = (rr + i + 1) % RPCS.length;
      return { url, wait: 0 };
    }
    if (until < bestUntil) {
      bestUntil = until;
      best = url;
    }
  }
  return { url: best, wait: Math.min(5000, bestUntil - now) };
}

export async function rpc<T>(method: string, params: unknown[]): Promise<T | null> {
  rpcStats.calls++;
  for (let attempt = 0; attempt < 6; attempt++) {
    await take();
    const { url, wait } = pickEndpoint(method);
    if (wait > 0) await sleep(wait);
    const key = `${url}|${method}`;
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
        signal: AbortSignal.timeout(12_000),
      });
      if (res.status === 429) {
        rpcStats.limited++;
        cooldown.set(key, Date.now() + 1500 * (attempt + 1));
        continue;
      }
      const j = await res.json().catch(() => null);
      if (!j) {
        cooldown.set(key, Date.now() + 2000);
        continue;
      }
      if (j.error) {
        const msg = String(j.error.message);
        if (/personal token|not supported|disabled|maximum|not allowed/i.test(msg) || res.status === 403) {
          cooldown.set(key, Date.now() + 10 * 60_000);
          continue;
        }
        if (j.error.code === 429 || j.error.code === -32005 || /too many|rate/i.test(msg)) {
          rpcStats.limited++;
          cooldown.set(key, Date.now() + 1500 * (attempt + 1));
          continue;
        }
        if (j.error.code === -32602) return null; // a real bad request; retrying will not help
        cooldown.set(key, Date.now() + 1000);
        continue;
      }
      return j.result as T;
    } catch {
      cooldown.set(key, Date.now() + 2000);
    }
  }
  rpcStats.failed++;
  return null;
}

export async function inBatches<A, R>(items: A[], size: number, fn: (a: A) => Promise<R>): Promise<R[]> {
  const out: R[] = [];
  for (let i = 0; i < items.length; i += size) out.push(...(await Promise.all(items.slice(i, i + size).map(fn))));
  return out;
}

export interface SigInfo {
  signature: string;
  slot: number;
  err: unknown;
  blockTime: number | null;
}

export interface TokenBal {
  mint: string;
  owner?: string;
  uiTokenAmount: { uiAmount: number | null };
}

export interface ParsedTx {
  slot: number;
  blockTime?: number | null;
  meta: {
    err: unknown;
    preBalances: number[];
    postBalances: number[];
    preTokenBalances?: TokenBal[];
    postTokenBalances?: TokenBal[];
  } | null;
  transaction: { message: { accountKeys: { pubkey: string; signer?: boolean }[] } };
}

export const TX_OPTS = { encoding: "jsonParsed", maxSupportedTransactionVersion: 1, commitment: "confirmed" };

// Oldest-first signature list for an address, up to `pages` x 1000.
async function history(address: string, pages: number): Promise<SigInfo[] | null> {
  const all: SigInfo[] = [];
  let before: string | undefined;
  for (let p = 0; p < pages; p++) {
    const r = await rpc<SigInfo[]>("getSignaturesForAddress", [address, { limit: 1000, before }]);
    if (!r) return null; // a missing page would make a later trade look like the launch block
    all.push(...r);
    if (r.length < 1000) return all.reverse();
    before = r[r.length - 1].signature;
  }
  return null; // too much history to reach the start
}

export async function analyzeCohort(mint: string, creator: string | undefined, pages = 6): Promise<Cohort | null> {
  let partial = false;

  const sigs = await history(mint, pages);
  if (!sigs || !sigs.length) return null;
  const s0 = sigs[0].slot;
  const t0 = sigs[0].blockTime;
  // Launch block and snipers (first slots), then the first buyers of the next 10 minutes.
  const early = sigs
    .filter((s) => !s.err && (s.slot - s0 <= EARLY_SLOTS || (!!t0 && !!s.blockTime && s.blockTime - t0 <= EARLY_WINDOW_S)))
    .slice(0, MAX_EARLY_TX);

  const txs = await inBatches(early, 8, (s) => rpc<ParsedTx>("getTransaction", [s.signature, TX_OPTS]));
  const roles = new Map<string, Role>();
  let bundleBuySol = 0;

  for (const tx of txs) {
    if (!tx || !tx.meta || tx.meta.err) {
      if (!tx) partial = true;
      continue;
    }
    const delta = new Map<string, number>();
    for (const b of tx.meta.postTokenBalances ?? [])
      if (b.mint === mint && b.owner) delta.set(b.owner, (delta.get(b.owner) ?? 0) + (b.uiTokenAmount.uiAmount ?? 0));
    for (const b of tx.meta.preTokenBalances ?? [])
      if (b.mint === mint && b.owner) delta.set(b.owner, (delta.get(b.owner) ?? 0) - (b.uiTokenAmount.uiAmount ?? 0));
    const payer = tx.transaction.message.accountKeys[0]?.pubkey;
    const solSpent = payer ? (tx.meta.preBalances[0] - tx.meta.postBalances[0]) / 1e9 : 0;

    // Buyers sign their own buys; the bonding curve, pools and the mint-to-curve in the create tx never sign.
    const signers = new Set(tx.transaction.message.accountKeys.filter((k) => k.signer).map((k) => k.pubkey));
    for (const [owner, d] of delta) {
      if (d <= 0 || !signers.has(owner)) continue;
      const r = roles.get(owner) ?? { bought: 0 };
      r.bought += d;
      // Fomo pays the gas for its users (the user still signs), so the fee payer tells the app apart.
      if (payer === FOMO_RELAYER) r.fomo = true;
      if (owner === creator) r.dev = true;
      else if (tx.slot === s0) {
        r.bundler = true;
        if (owner === payer) bundleBuySol += Math.max(0, solSpent);
      } else if (tx.slot - s0 <= EARLY_SLOTS) r.sniper = true;
      else r.early = true;
      roles.set(owner, r);
    }
  }
  if (creator && !roles.has(creator)) roles.set(creator, { dev: true, bought: 0 });

  // Fresh wallets and funding links for the early (non-dev) buyers.
  const buyers = [...roles.entries()]
    .filter(([, r]) => !r.dev)
    .sort((a, b) => b[1].bought - a[1].bought)
    .slice(0, MAX_WALLETS);
  const now = Date.now();
  const firstTx = await inBatches(buyers, 6, async ([w]) => {
    const h = await rpc<SigInfo[]>("getSignaturesForAddress", [w, { limit: FRESH_MAX_TX }]);
    if (!h) {
      partial = true;
      return null;
    }
    const oldest = h[h.length - 1];
    const fresh = h.length < FRESH_MAX_TX && !!oldest?.blockTime && now - oldest.blockTime * 1000 < FRESH_MAX_AGE_MS;
    return { w, fresh, oldest: fresh ? oldest.signature : null };
  });
  const funders = new Map<string, string>();
  await inBatches(
    firstTx.filter((x): x is { w: string; fresh: boolean; oldest: string } => !!x && x.fresh && !!x.oldest),
    6,
    async (x) => {
      const r = roles.get(x.w);
      if (r) r.fresh = true;
      const tx = await rpc<ParsedTx>("getTransaction", [x.oldest, TX_OPTS]);
      const payer = tx?.transaction.message.accountKeys[0]?.pubkey;
      if (payer && payer !== x.w) funders.set(x.w, payer);
    }
  );
  const funderCount = new Map<string, number>();
  for (const f of funders.values()) funderCount.set(f, (funderCount.get(f) ?? 0) + 1);
  for (const [w, f] of funders) {
    if (f === creator || (funderCount.get(f) ?? 0) >= 2) {
      const r = roles.get(w);
      if (r) r.linked = true;
    }
  }

  // What every tagged wallet still holds right now: derive their token accounts (classic and Token-2022)
  // and read them all in one getMultipleAccounts call.
  const supplyRes = await rpc<{ value: { uiAmount: number | null } }>("getTokenSupply", [mint]);
  const supply = supplyRes?.value.uiAmount ?? 1_000_000_000;
  const tagged = [...roles.entries()]
    .filter(([, r]) => r.dev || r.bundler || r.sniper || r.fresh || r.linked)
    .sort((a, b) => b[1].bought - a[1].bought)
    .slice(0, 48);
  const mintKey = new PublicKey(mint);
  const keys: string[] = [];
  for (const [w] of tagged) {
    const owner = new PublicKey(w);
    for (const prog of [TOKEN_PROGRAM, TOKEN_2022]) {
      keys.push(PublicKey.findProgramAddressSync([owner.toBuffer(), prog.toBuffer(), mintKey.toBuffer()], ATA_PROGRAM)[0].toBase58());
    }
  }
  type Acc = { data: { parsed?: { info?: { tokenAmount?: { uiAmount: number | null } } } } } | null;
  // Some free endpoints cap getMultipleAccounts at 10 keys, so read in chunks of 10.
  const chunks: string[][] = [];
  for (let i = 0; i < keys.length; i += 10) chunks.push(keys.slice(i, i + 10));
  const parts = await inBatches(chunks, 4, (c) => rpc<{ value: Acc[] }>("getMultipleAccounts", [c, { encoding: "jsonParsed" }]));
  const holdingsKnown = parts.every((p) => !!p);
  if (!holdingsKnown) partial = true;
  const values = parts.flatMap((p, i) => p?.value ?? Array(chunks[i].length).fill(null));
  const bal = (k: number) => values[k]?.data?.parsed?.info?.tokenAmount?.uiAmount ?? 0;

  const pct = (x: number) => (supply > 0 ? Math.round((x / supply) * 1000) / 10 : 0);
  let dev = 0, bundler = 0, sniper = 0, fresh = 0, combined = 0;
  tagged.forEach(([, r], i) => {
    const h = bal(i * 2) + bal(i * 2 + 1);
    if (r.dev) dev += h;
    if (r.bundler) bundler += h;
    if (r.sniper) sniper += h;
    if (r.fresh) fresh += h;
    combined += h; // each wallet once
  });
  const all = [...roles.values()];
  const bundlerCount = all.filter((r) => r.bundler).length;
  const sniperCount = all.filter((r) => r.sniper).length;
  const linkedCount = all.filter((r) => r.linked).length;
  const combinedRiskPct = pct(combined);

  return {
    at: now,
    supply,
    holdingsKnown,
    devHoldPct: pct(dev),
    bundlerHoldPct: pct(bundler),
    bundlerCount,
    sniperHoldPct: pct(sniper),
    sniperCount,
    freshHoldPct: pct(fresh),
    freshCount: all.filter((r) => r.fresh).length,
    linkedCount,
    combinedRiskPct,
    bundleBuySol: Math.round(bundleBuySol * 100) / 100,
    earlyBuyers: all.filter((r) => !r.dev).length,
    earlyWallets: [...roles.entries()]
      .filter(([, r]) => !r.dev)
      .map(([w, r]) => ({ w, bundler: !!r.bundler, sniper: !!r.sniper, fresh: !!r.fresh, linked: !!r.linked, ...(r.fomo ? { fomo: true } : {}) })),
    fomoBuyers: all.filter((r) => r.fomo && !r.dev).length,
    cleanLaunch: holdingsKnown && bundlerCount === 0 && linkedCount === 0 && combinedRiskPct < 15,
    partial,
  };
}

// One analysis at a time so free endpoints are not flooded. Signals go before heater lookups.
// "urgent" jumps the line: tokens that already qualify for a call, so their wallet read lands before the call.
type Job = (skip?: boolean) => void;
const queues: { urgent: Job[]; high: Job[]; low: Job[] } = { urgent: [], high: [], low: [] };
let busy = false;
function pump() {
  if (busy) return;
  const next = queues.urgent.shift() ?? queues.high.shift() ?? queues.low.shift();
  if (!next) return;
  busy = true;
  next();
}
// Backlog caps: when the chain is slow, drop the oldest waiting work instead of piling up forever.
const MAX_WAITING = { urgent: 20, high: 150, low: 25 };
export function cohortQueueStats() {
  return { urgent: queues.urgent.length, high: queues.high.length, low: queues.low.length, busy };
}
export function queueCohort(
  mint: string,
  creator: string | undefined,
  pages = 6,
  priority: "urgent" | "high" | "low" = "high"
): Promise<Cohort | null> {
  return new Promise((resolve) => {
    if (queues[priority].length >= MAX_WAITING[priority]) {
      if (priority === "low") return resolve(null);
      queues[priority].shift()?.call(null, true);
    }
    queues[priority].push((skip?: boolean) => {
      if (skip) {
        resolve(null);
        return;
      }
      analyzeCohort(mint, creator, pages)
        .catch(() => null)
        .then((c) => {
          resolve(c);
          busy = false;
          pump();
        });
    });
    pump();
  });
}

// ---------------------------------------------------------------------------------------------------------
// Launch read: what the launch block looked like, the same numbers Gem Bot shows as "bundled X%, sniped Y%".
// Cheap (one signature page plus the transactions of the first 4 slots, ~5-25 reads) so it runs for every young
// radar token. The launch block is history: it does not change, so it can land a few seconds after a call.
//  - bundled: share of supply bought in the creation slot by wallets other than the dev (bought together with
//    the create: the classic bundle)
//  - sniped: share bought by other wallets in the next 3 slots (~1.5 s)
//  - dev: the dev's own buy in those slots
export interface LaunchRead {
  at: number;
  bundlePct: number;
  snipedPct: number;
  devPct: number;
  bundleWallets: number;
  sniperWallets: number;
  partial: boolean;
}

const PUMP_SUPPLY = 1_000_000_000;

export async function analyzeLaunch(mint: string, creator?: string): Promise<LaunchRead | null> {
  const page = await rpc<SigInfo[]>("getSignaturesForAddress", [mint, { limit: 1000 }]);
  // Over 1,000 transactions already: the launch is out of cheap reach (and the token is no longer young).
  if (!page || !page.length || page.length >= 1000) return null;
  const sigs = page.slice().reverse();
  const s0 = sigs[0].slot;
  const early = sigs.filter((s) => !s.err && s.slot - s0 <= EARLY_SLOTS).slice(0, 25);
  const txs = await inBatches(early, 5, (s) => rpc<ParsedTx>("getTransaction", [s.signature, TX_OPTS]));
  let bundle = 0;
  let sniped = 0;
  let dev = 0;
  let partial = false;
  const bw = new Set<string>();
  const sw = new Set<string>();
  for (const tx of txs) {
    if (!tx || !tx.meta || tx.meta.err) {
      if (!tx) partial = true;
      continue;
    }
    const delta = new Map<string, number>();
    for (const b of tx.meta.postTokenBalances ?? []) if (b.mint === mint && b.owner) delta.set(b.owner, (delta.get(b.owner) ?? 0) + (b.uiTokenAmount.uiAmount ?? 0));
    for (const b of tx.meta.preTokenBalances ?? []) if (b.mint === mint && b.owner) delta.set(b.owner, (delta.get(b.owner) ?? 0) - (b.uiTokenAmount.uiAmount ?? 0));
    const signers = new Set(tx.transaction.message.accountKeys.filter((k) => k.signer).map((k) => k.pubkey));
    for (const [owner, d] of delta) {
      if (d <= 0 || !signers.has(owner)) continue;
      if (owner === creator) dev += d;
      else if (tx.slot === s0) {
        bundle += d;
        bw.add(owner);
      } else {
        sniped += d;
        sw.add(owner);
      }
    }
  }
  const pct = (x: number) => Math.round((x / PUMP_SUPPLY) * 1000) / 10;
  return { at: Date.now(), bundlePct: pct(bundle), snipedPct: pct(sniped), devPct: pct(dev), bundleWallets: bw.size, sniperWallets: sw.size, partial };
}

// Two launch reads at a time, newest first; old requests are dropped when the chain is slow (a launch read is
// only useful while the token is young).
const launchQueue: { mint: string; creator?: string; at: number; resolve: (r: LaunchRead | null) => void }[] = [];
let launchBusy = 0;
function pumpLaunch() {
  while (launchBusy < 2 && launchQueue.length) {
    const job = launchQueue.pop()!; // newest first
    if (Date.now() - job.at > 3 * 60_000) {
      job.resolve(null);
      continue;
    }
    launchBusy++;
    analyzeLaunch(job.mint, job.creator)
      .catch(() => null)
      .then((r) => {
        launchBusy--;
        job.resolve(r);
        pumpLaunch();
      });
  }
}
export function queueLaunch(mint: string, creator?: string): Promise<LaunchRead | null> {
  return new Promise((resolve) => {
    if (launchQueue.length >= 40) launchQueue.shift()?.resolve(null);
    launchQueue.push({ mint, creator, at: Date.now(), resolve });
    pumpLaunch();
  });
}
export const launchQueueStats = () => ({ waiting: launchQueue.length, busy: launchBusy });

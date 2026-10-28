// Talons Narrative Sniper shared worker.
// Runs the scanning engine 24/7 and serves one shared state, so every visitor sees the same signals.
// Runs anywhere Node 22 runs: a VPS or VM, Railway, Fly, Render, a home PC. Start with `npm run worker`.

import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { NextRequest } from "next/server";
import { createCore, type CoreState } from "../lib/core";
import { cohortQueueStats, queueCohort, rpcStats, type Cohort } from "../lib/cohort";
import type { Heater } from "../app/api/heaters/route";

import * as narratives from "../app/api/narratives/route";
import * as tokens from "../app/api/tokens/route";
import * as profiles from "../app/api/profiles/route";
import * as rugcheck from "../app/api/rugcheck/route";
import * as meta from "../app/api/meta/route";
import * as devbalance from "../app/api/devbalance/route";
import * as orders from "../app/api/orders/route";
import * as heaters from "../app/api/heaters/route";
import * as solRoute from "../app/api/sol/route";
import * as calls from "../app/api/calls/route";
import { createCallboard } from "../lib/callboard";
import { CALLS_ENABLED } from "../lib/calls";
import { createSmartBook, createSmartWatcher } from "../lib/smart";
import { RANGES } from "../lib/record";
import type { TierId } from "../lib/tiers";
import * as peak from "../app/api/peak/route";
import { createKolBook } from "../lib/kols";
import { createTraderFeed, createWalletPoller, walletTrades } from "../lib/traders";

const PORT = Number(process.env.PORT || 8787);
const DATA_DIR = process.env.DATA_DIR || path.join(process.cwd(), "data");
const WATCHLIST = (process.env.WATCHLIST || "").split(",").map((w) => w.trim()).filter(Boolean);

fs.mkdirSync(DATA_DIR, { recursive: true });

// File-backed key/value store (what localStorage is for the browser engine).
const cache = new Map<string, string | null>();
const fileOf = (key: string) => path.join(DATA_DIR, `${key.replace(/[^a-z0-9.-]/gi, "_")}.json`);
const storage = {
  get(key: string) {
    if (cache.has(key)) return cache.get(key) ?? null;
    let v: string | null = null;
    try {
      v = fs.readFileSync(fileOf(key), "utf8");
    } catch {
      v = null;
    }
    cache.set(key, v);
    return v;
  },
  set(key: string, value: string) {
    cache.set(key, value);
    const tmp = fileOf(key) + ".tmp";
    fs.writeFile(tmp, value, (err) => {
      if (!err) fs.rename(tmp, fileOf(key), () => {});
    });
  },
};

// The site's own API routes, called in-process instead of over HTTP.
type Route = { GET: (req: NextRequest) => Promise<Response> | Response };
const routes: Record<string, Route> = {
  "/api/narratives": narratives as unknown as Route,
  "/api/tokens": tokens as unknown as Route,
  "/api/profiles": profiles as unknown as Route,
  "/api/rugcheck": rugcheck as unknown as Route,
  "/api/meta": meta as unknown as Route,
  "/api/devbalance": devbalance as unknown as Route,
  "/api/orders": orders as unknown as Route,
  "/api/heaters": heaters as unknown as Route,
  "/api/sol": solRoute as unknown as Route,
  "/api/peak": peak as unknown as Route,
  "/api/calls": calls as unknown as Route,
};
async function api(p: string): Promise<Response> {
  const url = new URL(p, "http://worker.local");
  const route = routes[url.pathname];
  if (!route) return new Response(JSON.stringify({ error: "no route" }), { status: 404 });
  try {
    return await route.GET(new NextRequest(url));
  } catch (e) {
    return new Response(JSON.stringify({ error: String((e as Error).message) }), { status: 500 });
  }
}

let state: CoreState | null = null;
let lastFlushAt = 0;

// Smart wallets: learned from early buyers of winners (plus any SMART_WALLETS you add), then watched live.
const smartBook = createSmartBook(storage);

// Trader network: named KOLs (kolscan.io public list + KOL_WALLETS) and our smart wallets, as one live feed.
const PUMP_KEY = (process.env.PUMPPORTAL_API_KEY || "").trim();
const kols = createKolBook(storage);
const feed = createTraderFeed(storage);
const KOL_WATCH = Number(process.env.KOL_WATCH || (PUMP_KEY ? 300 : 120));
const topKols = () => kols.all().slice(0, KOL_WATCH).map((k) => k.w);
const trackedWallets = () => [...new Set([...topKols(), ...smartBook.leaderboard(100).map((r) => r.wallet)])];
const who = (w: string) => {
  const k = kols.get(w);
  if (k) return { name: k.name, src: "kol" as const, x: k.x, pnl: k.pnl };
  return { name: `${w.slice(0, 4)}...${w.slice(-4)}`, src: "smart" as const };
};
kols.refresh();
setInterval(() => kols.refresh(), 60 * 60_000);
// Free mode polls the KOLs over RPC (smart wallets are already polled by the watcher below).
const poller = PUMP_KEY ? null : createWalletPoller(feed, topKols, Number(process.env.KOL_POLL_PER_TICK || 10));
if (poller) setInterval(() => poller.tick().catch((e) => console.error("[kols]", (e as Error).message)), 15_000);
setInterval(() => feed.persist(), 60_000);
// Names, tickers and images for the tokens traders touch.
setInterval(async () => {
  const need = feed.needMeta(30);
  if (!need.length) return;
  try {
    const r = await api(`/api/tokens?addresses=${need.join(",")}`);
    const j = (await r.json()) as { tokens: { address: string; name: string; symbol: string; image?: string; fdvUsd?: number }[] };
    const got = new Set<string>();
    for (const t of j.tokens ?? []) {
      feed.setMeta(t.address, { s: t.symbol, n: t.name, img: t.image, fdv: t.fdvUsd });
      got.add(t.address);
    }
    for (const m of need) if (!got.has(m)) feed.setMeta(m, {});
  } catch {
    /* next round */
  }
}, 20_000);

const watcher = createSmartWatcher(smartBook, {
  watch: Number(process.env.SMART_WATCH || 40),
  onTx: (w, sig, tx) => {
    for (const mv of walletTrades(tx, w, sig)) feed.add(mv);
  },
});
const startedAt = Date.now();

const core = createCore({
  api,
  storage,
  every: (ms, fn) => {
    const h = setInterval(() => {
      try {
        fn();
      } catch (e) {
        console.error(e);
      }
    }, ms);
    return () => clearInterval(h);
  },
  after: (ms, fn) => {
    const h = setTimeout(() => {
      try {
        fn();
      } catch (e) {
        console.error(e);
      }
    }, ms);
    return () => clearTimeout(h);
  },
  watchlist: WATCHLIST,
  smart: smartBook,
  // Smart wallets and named KOLs that bought this token in the last 30 min.
  smartWalletsFor: (mint) => [
    ...new Set([
      ...smartBook.smartAmong(watcher.walletsFor(mint)),
      ...[...feed.buyersOf(mint, 30 * 60_000).keys()].filter((w) => kols.has(w)),
      ...smartBook.smartAmong([...feed.buyersOf(mint, 30 * 60_000).keys()]),
    ]),
  ],
  pumpKey: PUMP_KEY || undefined,
  accountWallets: trackedWallets,
  onAccountTrade: (d) => {
    const k = d.txType === "buy" ? "buy" : d.txType === "sell" ? "sell" : null;
    if (!k || !d.traderPublicKey || !d.mint) return;
    feed.add({ t: Date.now(), w: d.traderPublicKey, k, m: d.mint, sol: Number(d.solAmount) || 0, mc: Number(d.marketCapSol) || undefined, sig: d.signature });
  },
  tokenTrades: process.env.PUMPPORTAL_TOKEN_TRADES === "1" ? true : undefined,
  learnSample: process.env.LEARN_SAMPLE !== "0",
  backfillCreates: process.env.BACKFILL_CREATES !== "0",
  smartClusters: () => [
    ...new Set([
      ...watcher
        .clusters()
        .filter((b) => smartBook.smartAmong(Object.keys(b.wallets)).length >= 2 && Date.now() - (b.clusterAt ?? 0) < 30 * 60_000)
        .map((b) => b.mint),
      ...feed
        .clusters(2, 30 * 60_000)
        .filter((c) => c.wallets.filter((w) => kols.has(w)).length + smartBook.smartAmong(c.wallets.filter((w) => !kols.has(w))).length >= 2)
        .map((c) => c.mint),
    ]),
  ],
  onFlush: (s) => {
    state = s;
    lastFlushAt = Date.now();
  },
});

// Heaters: shared list with wallet cohorts read once per token (refreshed every 10 min).
let heaterList: Heater[] = [];
let heaterAt = 0;
let heaterError: string | null = null;
const heaterCohorts = new Map<string, Cohort | "failed">();
const heaterCohortAt = new Map<string, number>();
async function loadHeaters() {
  try {
    const r = await api("/api/heaters");
    const j = await r.json();
    if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
    heaterList = j.heaters ?? [];
    heaterAt = Date.now();
    heaterError = null;
    for (const h of heaterList.slice(0, 10)) {
      const at = heaterCohortAt.get(h.mint) ?? 0;
      if (Date.now() - at < 10 * 60_000) continue;
      heaterCohortAt.set(h.mint, Date.now());
      queueCohort(h.mint, undefined, 25, "low").then((c) => heaterCohorts.set(h.mint, c ?? "failed"));
    }
    const live = new Set(heaterList.map((h) => h.mint));
    for (const k of heaterCohorts.keys()) if (!live.has(k)) heaterCohorts.delete(k);
  } catch (e) {
    heaterError = (e as Error).message;
  }
}
loadHeaters();
setInterval(loadHeaters, 60_000);

// Call board from followed Telegram channels, shared for everyone.
const callboard = createCallboard({ api, storage });
if (CALLS_ENABLED) {
  callboard.refresh();
  setInterval(() => callboard.refresh(), 60_000);
}

// Poll the smart wallets once a minute and price the tokens two or more of them bought.
const clusterInfo = new Map<string, { name?: string; symbol?: string; baseFdv?: number; fdv?: number; peakFdv?: number; liquidityUsd?: number }>();
async function smartTick() {
  try {
    await watcher.poll();
    const list = watcher.clusters().slice(0, 60);
    for (let i = 0; i < list.length; i += 30) {
      const batch = list.slice(i, i + 30);
      const r = await api(`/api/tokens?addresses=${batch.map((b) => b.mint).join(",")}`);
      if (!r.ok) continue;
      const j = (await r.json()) as { tokens: { address: string; name: string; symbol: string; fdvUsd?: number; liquidityUsd?: number }[] };
      for (const t of j.tokens ?? []) {
        if (!t.fdvUsd) continue;
        const c = clusterInfo.get(t.address) ?? {};
        c.name = t.name;
        c.symbol = t.symbol;
        c.fdv = t.fdvUsd;
        c.liquidityUsd = t.liquidityUsd;
        if (c.baseFdv == null) c.baseFdv = t.fdvUsd; // price when the cluster was first seen
        c.peakFdv = Math.max(c.peakFdv ?? 0, t.fdvUsd);
        clusterInfo.set(t.address, c);
      }
    }
  } catch (e) {
    console.error("[smart]", (e as Error).message);
  }
}
setInterval(smartTick, 60_000);

// Tier names in URLs (older clients sent "early" for the risky tier).
function tierParam(v: string | null): TierId {
  if (v === "early" || v === "risky") return "risky";
  if (v === "ultra" || v === "conservative") return v;
  return "balanced";
}

// Same body for /state polling and the /stream push. since = 0: everything; otherwise only what changed
// (signals and calls touched after `since`, plus the full mint lists so clients can drop removed rows).
const labCache = new Map<string, { at: number; body: unknown }>();
const TIER_STREAM_MS = 3 * 3600_000;
function recentTier(rows: CoreState["calls"] | undefined, since: number, ov: number) {
  const now = Date.now();
  return (rows ?? []).filter((r) => now - r.t < TIER_STREAM_MS && (!since || r.t > since - ov || r.chk > since - ov)).map(({ bc: _bc, ...r }) => r);
}

function statePayload(st: CoreState, since: number, narrStamp: string | null, opts: { mints?: boolean; overlap?: number } = {}) {
  const withMints = opts.mints ?? true;
  const ov = opts.overlap ?? 2000; // polling clients may be a little out of step; the push loop is not
  return {
    serverTime: Date.now(),
    full: !since,
    mints: since && withMints ? st.signals.map((s) => s.mint) : undefined,
    signals: since ? st.signals.filter((s) => (s.updatedAt ?? 0) > since - ov) : st.signals,
    narratives: since && narrStamp === st.narratives?.updatedAt?.toString() ? undefined : st.narratives,
    narrError: st.narrError,
    hits: st.hits,
    stats: st.stats,
    fresh: st.fresh,
    watch: st.watch,
    graduations: st.graduations,
    calls: since ? st.calls.filter((r) => r.t > since - ov || r.chk > since - ov) : st.calls,
    callMints: since && withMints ? st.calls.map((r) => r.m) : undefined,
    // The risky and ultra risky tiers can run to hundreds of calls a day: the stream carries their last 3 hours
    // (radar badges, live moves, token pages); the board reads the full lists from /feed.
    early: recentTier(st.early, since, ov),
    earlyMints: since && withMints ? recentTier(st.early, 0, 0).map((r) => r.m) : undefined,
    ultra: recentTier(st.ultra, since, ov),
    ultraMints: since && withMints ? recentTier(st.ultra, 0, 0).map((r) => r.m) : undefined,
    radar: st.radar,
    solUsd: st.solUsd,
  };
}

// Push loop: once a second, one delta for every open stream. Mint lists only when they changed, a comment
// heartbeat every 15 s so proxies keep the connection open.
const streams = new Set<http.ServerResponse>();
let lastPush = Date.now();
let lastMintSig = "";
let lastNarr = "";
let lastBeat = Date.now();
let lastMintsAt = 0;
setInterval(() => {
  if (!streams.size || !state) {
    lastPush = Date.now();
    return;
  }
  const now = Date.now();
  const sig = `${state.signals.length}:${state.signals[0]?.mint ?? ""}:${state.signals.at(-1)?.mint ?? ""}|${state.calls.length}:${state.calls[0]?.m ?? ""}|${state.early?.length ?? 0}:${state.early?.[0]?.m ?? ""}|${state.ultra?.length ?? 0}:${state.ultra?.[0]?.m ?? ""}`;
  const mintsChanged = sig !== lastMintSig || now - lastMintsAt > 60_000;
  if (mintsChanged) lastMintsAt = now;
  const p = statePayload(state, lastPush, lastNarr, { mints: mintsChanged, overlap: 0 });
  lastPush = now;
  lastMintSig = sig;
  lastNarr = String(state.narratives?.updatedAt ?? "");
  const changed = p.signals.length || p.calls.length || p.early.length || p.ultra.length || mintsChanged || p.narratives;
  let frame = "";
  if (changed) frame = `id: ${p.serverTime}\nevent: state\ndata: ${JSON.stringify(p)}\n\n`;
  else if (now - lastBeat > 15_000) frame = `id: ${p.serverTime}\nevent: stats\ndata: ${JSON.stringify({ serverTime: p.serverTime, stats: p.stats, radar: p.radar, solUsd: p.solUsd })}\n\n`;
  if (!frame) return;
  lastBeat = now;
  for (const r of streams) {
    try {
      r.write(frame);
    } catch {
      streams.delete(r);
    }
  }
}, 1000);

function send(req: http.IncomingMessage, res: http.ServerResponse, status: number, body: unknown) {
  const json = Buffer.from(JSON.stringify(body));
  const headers: Record<string, string> = {
    "content-type": "application/json",
    "access-control-allow-origin": "*",
    "cache-control": "no-store",
  };
  if (json.length > 1024 && /\bgzip\b/.test(String(req.headers["accept-encoding"] || ""))) {
    headers["content-encoding"] = "gzip";
    res.writeHead(status, headers);
    res.end(zlib.gzipSync(json));
    return;
  }
  res.writeHead(status, headers);
  res.end(json);
}

http
  .createServer((req, res) => {
    const url = new URL(req.url || "/", "http://worker.local");
    if (req.method === "OPTIONS") {
      res.writeHead(204, { "access-control-allow-origin": "*", "access-control-allow-headers": "*" });
      return res.end();
    }
    if (url.pathname === "/" || url.pathname === "/health") {
      return send(req, res, 200, {
        ok: true,
        uptimeSec: Math.round((Date.now() - startedAt) / 1000),
        signals: state?.signals.length ?? 0,
        stream: state?.stats.ws ?? "starting",
        tokensPerMin: state?.stats.perMin ?? 0,
        lastFlushSecAgo: lastFlushAt ? Math.round((Date.now() - lastFlushAt) / 1000) : null,
        cohortQueue: cohortQueueStats(),
        rpc: rpcStats,
        smart: smartBook.stats(),
        calls: core.callCount(),
        early: core.earlyCount(),
        ultra: core.ultraCount(),
        streams: streams.size,
        traders: { mode: PUMP_KEY ? "pumpportal" : "rpc", kols: kols.stats(), moves: feed.size(), pump: core.pumpStats() },
        radar: state?.radar ?? 0,
        memoryMb: Math.round(process.memoryUsage().rss / 1e6),
      });
    }
    if (url.pathname === "/state") {
      if (!state) return send(req, res, 503, { error: "starting" });
      const since = Number(url.searchParams.get("since") || 0);
      return send(req, res, 200, statePayload(state, since, url.searchParams.get("narr")));
    }
    // Live push (Server-Sent Events): the full state first, then every change as it happens. A reconnect resumes
    // from Last-Event-ID, so nothing is missed. /state stays as the polling fallback.
    if (url.pathname === "/stream") {
      if (!state) return send(req, res, 503, { error: "starting" });
      res.writeHead(200, {
        "content-type": "text/event-stream; charset=utf-8",
        "cache-control": "no-store, no-transform",
        connection: "keep-alive",
        "access-control-allow-origin": "*",
        "x-accel-buffering": "no",
      });
      const last = Number(req.headers["last-event-id"] || url.searchParams.get("since") || 0);
      const since = last && Date.now() - last < 10 * 60_000 ? last : 0;
      const p = statePayload(state, since, null);
      res.write(`retry: 3000\nid: ${p.serverTime}\nevent: state\ndata: ${JSON.stringify(p)}\n\n`);
      streams.add(res);
      req.on("close", () => streams.delete(res));
      return;
    }
    if (url.pathname === "/calls") return send(req, res, 200, callboard.state());
    // Trader network: live moves of named KOLs and smart wallets, what they buy most, who is active.
    if (url.pathname === "/traders") {
      const mint = url.searchParams.get("mint") || "";
      const now = Date.now();
      const moves = (mint ? feed.list(3000).filter((m) => m.m === mint) : feed.list(200)).slice(0, mint ? 100 : 200);
      const people = feed.people(now);
      const ps = core.pumpStats();
      const days = Math.max(1 / 24, (now - ps.since) / 86_400_000);
      return send(req, res, 200, {
        mode: PUMP_KEY ? "pumpportal" : "rpc",
        moves: moves.map((m) => ({ ...m, who: who(m.w), tok: feed.meta(m.m) ?? null })),
        buzz: mint ? [] : feed.buzz(3600_000, now).map((b) => ({ ...b, names: b.wallets.map((w) => who(w).name) })),
        people: [...people.entries()]
          .map(([w, p]) => ({ w, ...who(w), ...p, tok: feed.meta(p.lastMint) ?? null }))
          .sort((a, b) => b.last - a.last)
          .slice(0, 80),
        directory: mint ? undefined : kols.all().slice(0, KOL_WATCH).map((k) => ({ w: k.w, name: k.name, x: k.x, pnl: k.pnl })),
        stats: {
          kols: kols.stats(),
          tracked: trackedWallets().length,
          moves: feed.size(),
          pumpportal: PUMP_KEY ? { ...ps, estSolPerDay: Math.round((ps.accountMsgs / days / 10_000) * 0.01 * 1000) / 1000 } : null,
          poller: poller?.stats() ?? null,
        },
      });
    }
    if (url.pathname === "/smart") {
      return send(req, res, 200, {
        stats: smartBook.stats(),
        leaderboard: smartBook.leaderboard(50),
        buys: watcher
          .clusters()
          .slice(0, 40)
          .map((b) => ({ ...b, wallets: Object.keys(b.wallets).filter((w) => smartBook.isSmart(w)), ...clusterInfo.get(b.mint) }))
          .filter((b) => b.wallets.length >= 2),
      });
    }
    if (url.pathname === "/archive") {
      const before = Number(url.searchParams.get("before")) || Date.now() + 1;
      const limit = Math.min(200, Number(url.searchParams.get("limit")) || 50);
      const tier = tierParam(url.searchParams.get("tier"));
      return send(req, res, 200, { calls: core.archive(before, limit, tier), total: core.tierCount(tier) });
    }
    if (url.pathname === "/call") {
      const m = url.searchParams.get("m") || "";
      const row = core.call(m);
      return send(req, res, row ? 200 : 404, row ? { call: row } : { error: "not called" });
    }
    if (url.pathname === "/record") {
      const range = url.searchParams.get("range") || "24h";
      return send(req, res, 200, core.record(range in RANGES ? range : "24h", tierParam(url.searchParams.get("tier"))));
    }
    // Public lab: every live and candidate rule, uncapped, measured the same way (cached 30 s).
    if (url.pathname === "/lab") {
      const range = url.searchParams.get("range") || "7d";
      const ms = range === "24h" ? 86_400_000 : range === "30d" ? 30 * 86_400_000 : 7 * 86_400_000;
      const hit = labCache.get(range);
      if (hit && Date.now() - hit.at < 30_000) return send(req, res, 200, hit.body);
      const body = { range, updatedAt: Date.now(), ...core.lab(ms) };
      labCache.set(range, { at: Date.now(), body });
      return send(req, res, 200, body);
    }
    if (url.pathname === "/lab/recent") return send(req, res, 200, { fires: core.labRecent(url.searchParams.get("rule") || "ultra") });
    // Each tier's record side by side (settled calls only).
    if (url.pathname === "/scoreboard") {
      const range = url.searchParams.get("range") || "7d";
      const ms = range === "24h" ? 86_400_000 : range === "30d" ? 30 * 86_400_000 : range === "all" ? Infinity : 7 * 86_400_000;
      return send(req, res, 200, { range, tiers: core.scoreboard(ms) });
    }
    // Every call of a tier, losers included, as CSV or JSON: anyone can check the numbers.
    if (url.pathname === "/export") {
      const tier = tierParam(url.searchParams.get("tier"));
      const rows = core.exportRows(tier).map((r) => ({
        called_at_utc: new Date(r.t).toISOString(),
        mint: r.m,
        symbol: r.s,
        tier,
        why: r.tr,
        mcap_at_call_usd: Math.round(r.c),
        peak_usd: Math.round(r.pk),
        peak_x: Math.round((r.pk / r.c) * 100) / 100,
        now_usd: Math.round(r.now),
        now_x: Math.round((r.now / r.c) * 100) / 100,
        last_check_utc: new Date(r.chk).toISOString(),
        paper_x: r.pp ? Math.round((r.pp.x + r.pp.q * (r.now / r.c)) * 1000) / 1000 : "",
        grade: r.g ?? "",
        bundled_pct: r.bp ?? "",
        sniped_pct: r.sp ?? "",
        dev_bought_pct: r.cb ?? "",
        volume_usd: r.vol ?? "",
      }));
      if (url.searchParams.get("format") === "json") return send(req, res, 200, { tier, calls: rows });
      const cols = Object.keys(rows[0] ?? { called_at_utc: "" });
      const esc = (v: unknown) => {
        const t = String(v ?? "");
        return /[",\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
      };
      const csv = [cols.join(","), ...rows.map((r) => cols.map((c) => esc((r as Record<string, unknown>)[c])).join(","))].join("\n");
      res.writeHead(200, {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="talons-${tier}-calls.csv"`,
        "access-control-allow-origin": "*",
        "cache-control": "no-store",
      });
      return res.end(csv);
    }
    // One tier's calls for the board: everything in the range first (since = 0), then only what changed.
    if (url.pathname === "/feed") {
      const tier = tierParam(url.searchParams.get("tier"));
      const ms = url.searchParams.get("range") === "7d" ? 7 * 24 * 3600_000 : 24 * 3600_000;
      const since = Number(url.searchParams.get("since")) || 0;
      const rows = core.feed(tier, ms, since ? since - 2000 : 0).map(({ bc: _bc, ...r }) => r);
      return send(req, res, 200, { serverTime: Date.now(), full: !since, rows, total: core.tierCount(tier) });
    }
    if (url.pathname === "/heaters") {
      return send(req, res, heaterList.length || !heaterError ? 200 : 502, {
        heaters: heaterList,
        cohorts: Object.fromEntries(heaterCohorts),
        updatedAt: heaterAt,
        error: heaterError,
      });
    }
    send(req, res, 404, { error: "not found" });
  })
  .listen(PORT, () => console.log(`[worker] listening on :${PORT}, data in ${DATA_DIR}`));

const shutdown = () => {
  console.log("[worker] saving and stopping");
  core.stop();
  setTimeout(() => process.exit(0), 1500);
};
process.on("SIGTERM", shutdown);
// A single bad response must never take the scanner down; log it and keep going.
process.on("unhandledRejection", (e) => console.error("[worker] unhandled rejection:", e));
process.on("uncaughtException", (e) => console.error("[worker] uncaught exception:", e));
// Checkpoint the smart wallet book every 15 minutes.
setInterval(() => {
  try {
    smartBook.persist();
  } catch (e) {
    console.error(e);
  }
}, 15 * 60_000);
process.on("SIGINT", shutdown);

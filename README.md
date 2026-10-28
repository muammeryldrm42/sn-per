# Talons Calls

Free Solana memecoin caller with a pnl.meme style terminal. Every new pump.fun / bonk.fun launch is watched
from its first seconds, the ones that start moving reach the radar and get every check, and only the ones
that prove themselves are called. Every call is kept forever with its market cap at the call and how it did.

## Site

- **Calls**: every call with market cap at the call, now, peak since the call, a chart (entry and peak
  marked), Buy on Jupiter and a share link. Sort by top movers, newest, now vs call, score, market cap;
  24h / 7d / all (all pages through the whole archive)
- **Live radar**: latest moves (calls, multiples reached, tokens reaching the radar), top calls today and
  every radar token with what it still needs before a call
- **Token page** (`/#t/<mint>`): the call, its chart, why it was called and the full on-chain read
- **Winners tape** on the calls page (recent calls that ran 2x+), a dismissible "how a call is made" strip,
  call type filter, a per-browser **watchlist** (star a call), and a BUY menu (Jupiter, Axiom, GMGN, BullX,
  Pump.fun, DexScreener)
- **Track record**: calls, 2x+ and 5x+ hit rate, median and average peak, best call (entry to peak), win rate
  breakdown from 1.2x to 100x, by call type, top 10 winners, day by day performance, share on X
- **Smart wallets** and **Trending pools**
- Search (`/`): ticker, name or mint

## Live architecture

- **Worker push (`/stream`)**: Server-Sent Events. A new visitor gets the full state, then one delta a second
  (signals and calls that changed, mint lists only when they change, a heartbeat every 15 s). Reconnects
  resume from `Last-Event-ID`, so nothing is missed. `/state` stays as the polling fallback; the site switches
  to polling by itself if the stream goes quiet and tries the stream again a minute later
- **Paper P&L** on every call: buy at the call, sell half at 2x, cut everything at 0.6x before that, after that
  sell the rest 35% off its high, close after 7 days (`PAPER_RULES` in `lib/archive.ts`). Peaks say how far a call
  ran; paper P&L says what a plain rule-based follower kept. Shown per call, sortable, and summed on the record
- **Grade** per call: Solid (wallet read and RugCheck were in and clean at the call) or Risky (called before
  they were in, or with a soft warning). Filter on the calls page, split on the record
- **Reasons**: every call stores the checks behind it in plain words (`bc`), listed on the token page
- **Share pages** `/t/<mint>` with a generated receipt image (ticker, call market cap, peak, multiple) for X and
  Telegram previews. Needs `NEXT_PUBLIC_WORKER_URL` on the site
- **Candles** (`/api/candles`): market cap candles from GeckoTerminal with the call price line and marker,
  cached 20 s at the edge
- **Notifications**: the bell lists every new call and every multiple a call reaches, with unread count and the
  sound switch
- **Hot hours**: calls and 2x hits by UTC hour on the record page

## Traders (KOLs, smart wallets, Fomo)

pnl.meme and GMGN show what known traders do: pump.fun profiles, Fomo app traders, KOL wallets. Here:

- **Named KOLs**: kolscan.io's public leaderboard page lists ~550 KOL wallets with names and X links. The worker
  reads that list twice a day (only the list, nothing else) and merges `KOL_WALLETS` you add yourself
- **Smart wallets**: learned from the chain as before
- **Their trades**: read from the chain. Free mode polls the top `KOL_WATCH` (120) KOLs over RPC, 10 wallets every
  15 s, plus the smart wallet watcher. With `PUMPPORTAL_API_KEY` (worker `.env` only) the worker streams every
  pump.fun and PumpSwap trade of up to 300 KOL and smart wallets in real time over the same PumpPortal
  connection; billed 0.01 SOL per 10,000 messages, `/health` and `/traders` show messages and an estimate per day
- **Free transfers** (tokens sent to a KOL without SOL changing hands: spam airdrops or a dev handing out bags)
  are kept apart from buys and never count as a buy
- **Tiny buys** (under 0.2 SOL, `KOL_MIN_BUY_SOL`) from KOL and smart wallets are shown in the feed but never
  count toward a call: they are usually sniper bots testing every launch, or bait
- **Fomo**: Fomo pays its users' gas, so a Fomo trade has Fomo's relayer as fee payer (address from Bitquery's
  on-chain research, not published by Fomo). Early buyers who came through Fomo are counted on every token, and
  KOL trades made in Fomo get a "via Fomo" tag. Fomo's own posts ("theses") and GMGN/Axiom in-app calls are
  private to those apps and are not read
- 2+ KOLs or smart wallets buying the same token within 30 minutes puts it on the radar and is the Smart money
  proof for a call. The Traders page shows the live moves, the tokens most bought by distinct traders in the last
  hour, and who was active in the last 24h; every token page lists the traders in that token

## Run the worker (pick one)

The site works alone (it scans in the visitor's tab), but the shared worker is what makes every visitor see the
same calls and keeps the archive forever. It is one Node process; it does not run on Vercel.

1. **This PC, to try it now (free)**: `powershell -ExecutionPolicy Bypass -File scripts\start-worker.ps1`.
   Starts the worker and a Cloudflare quick tunnel (`winget install --id Cloudflare.cloudflared` once). Copy the
   `https://....trycloudflare.com` URL. The URL changes when the tunnel restarts and the PC has to stay on
2. **Any server with Docker**: `docker compose --profile tunnel up -d` (quick tunnel, URL in
   `docker compose logs tunnel`) or, on a VM with a public IP, set `DOMAIN=yourname.duckdns.org` in `.env` and
   `docker compose --profile https up -d` (Caddy gets the certificate, fixed URL `https://yourname.duckdns.org`)
3. **Any Linux box without Docker**: `bash scripts/start-worker.sh` (pm2 keeps it alive)

Then on Vercel set `NEXT_PUBLIC_WORKER_URL` to that https URL and redeploy. Check it with `<url>/health`.
A free Helius key in `RPC_URL` makes the wallet reads much faster.

## How a token becomes a call

1. **Watch every launch.** PumpPortal's free new-token stream, ~20-30 launches a minute, no name or narrative
   filter, no minimum liquidity or volume
1b. **Launch backfill.** The free PumpPortal stream does not deliver every pump.fun launch: against the chain it
   caught 90-98% at quiet times but only about half (62 of 131 in 4 minutes) when launches were busy. Every pump.fun
   create is signed by the program's mint authority, so the worker reads its newest signatures every 20 s and adds
   any launch the stream missed from the chain (mint from the create's initializeMint2, the dev's first buy from
   balances), 20-60 s after launch. Only missing ones are fetched. `BACKFILL_CREATES=0` turns it off
2. **Radar.** Every launch is priced through DexScreener every 30 s for its first 45 minutes. It reaches the
   radar on launch momentum, a fast bonding curve, 2+ smart wallets, graduation or a paid DEX profile
3. **Full checks** for radar tokens: wallet cohorts from the chain (bundlers, snipers, fresh and linked wallets
   and what they still hold), smart wallets among the early buyers, dev history, RugCheck, holders, liquidity
4. **Call gate v3** (`lib/score2.ts`). Tuned on a 2 hour live recording of 214 radar tokens (every 15 s) and
   what each did over the next 45 minutes. A call needs one proof:
   - **Graduating** (off by default, `GRADUATING_PCT=75` turns it on): pump.fun curve 75%+ full. It looked good
     on the first recording (2 of 5 hit 2x) and failed on the second, unseen one (0 of 5)
   - **Graduated**: finished the pump.fun curve, real post-migration price, under 60 min old
   - **Runner**: 5x+ since launch (`RUNNER_X`), $30K+ (`RUNNER_MIN_USD`), under 45 min old
   - **Smart money**: 2+ independent smart wallets or named KOLs bought it, with 30+ buys in 5 min. Smart wallets
     need 3+ wins at a 30%+ hit rate over 5+ tokens, and wallets that move as one operator count once (the second
     recording showed the looser rule had filled up with sniper bots)
   and every health check: dev has not sold, not dumped, within 20% of its high, buys outnumber sells and price
   not falling over 5 min, no rug signs in the wallets (when read), creator not flagged for rugs (when RugCheck
   is in). The wallet read and RugCheck veto but the call does not wait for them: in the recording, waiting
   meant calling after the move.
   - **Anti-rug**: no call in the first 3 minutes after launch (`CALL_MIN_AGE_MIN`), and a fast mover (launch to
     migration in under 3 minutes, or a proof while under 6 minutes old: the classic bundled launch) is never
     called before the wallet read is in, so the bundler and risk-wallet vetoes always apply to it. Over both
     recordings (191 decision points on healthy $15K+ tokens) tokens under 2 min old ended under 0.2x within
     45 min 47% of the time, 5 min and older 18%. Inside the proof paths the sample is small (20 calls) and
     waiting longer did not lower the rug rate further, so the wait stays short. `CALL_GRAD_HOLD_MIN` (off) makes
     graduated tokens hold on the pool first
   At most `CALL_MAX_PER_HOUR` (3) and `CALL_MAX_PER_DAY` (50) calls.
   In the first recording, launch momentum calls hit 2x about 25% of the time and most were under the call price
   within the hour; the proven paths hit 2x about 35-40% of the time. Over both recordings the graduated and
   runner paths made 20 calls: 25% hit 2x and 20% ended under 0.2x within 45 minutes. Memecoins rug; the gate
   tilts the odds, it cannot remove them. Small sample: the live track record on the site is the real measure
4b. **Tiers, the way Gem Bot splits its feed** (`lib/tiers.ts`, sidebar "Calls"). Four lists from the same scanner,
   each free, each with its own track record (Record page, tier tabs):
   - **Conservative** (`#conservative`): balanced calls whose wallet read and RugCheck were in and clean ("solid")
   - **Balanced** (`#calls`): the main gate above
   - **Risky** (`#risky`): fresh launch rule. First 3 minutes on the pump.fun curve: 2x+ since launch, buys at
     least 1.5x sells over 5 min, curve 65% full or less, the dev's own first buy under 1 SOL, $6K to $16K, no dev
     sell, no rug signs, not bundled (when the wallet read is in). Both recordings: 30 calls, 40% hit 2x, none ended
     under 0.2x, most fell back to ~0.4x within 45 min when nobody sold. A curve over 65% full (11% at 2x) and a
     dev buy of 1 SOL+ (12% at 2x) did badly on both recordings. `EARLY_MAX_PER_HOUR` (15), `EARLY_CALLS=0` = off
   - **Ultra risky** (`#ultra`): launches over $6K in their first 3 minutes, before any proof, with the cuts both
     recordings agreed on: 2x+ since launch, more buys than sells, curve 80% full or less (`ULTRA_MAX_CURVE`), dev's
     own buy under 1 SOL. 40 calls (~270 a day): 35% hit 2x, 8% ended under 0.2x, 1.08x average paper trade. The
     first version (every healthy launch over $6K, ~1,080 a day) hit 2x 23%, 21% under 0.2x and lost money (0.96x);
     it keeps running in the lab. `ULTRA_MAX_PER_HOUR` (40), `ULTRA_CALLS=0` = off. Priced for 2 days
   Every call row also carries, like Gem Bot's:
   - **Rug check**: Gem Bot's rule v1 (reference = max(market cap, peak, $40K), cutoff $35 of fees per $10K of it,
     capped at $7K) applied to volume since launch, assuming ~1.25% fees a trade (28% of the reference, max $560K).
     Clean = real buying and selling for its size, Rug likely = barely any real trading, Checking = no volume yet
     or under 5 minutes old and not there yet (a $40K reference is more than most launches trade in minute one)
   - **Launch read** (`analyzeLaunch` in `lib/cohort.ts`, every young radar token, ~5-25 RPC reads): share of supply
     bought with the create by other wallets (bundled), in the next 3 slots (sniped), and by the dev. History, so it
     can land a few seconds after a call and is filled in then. Fresh and linked wallets from the full wallet read
   - **Gem**: clean launch from the wallets (bundles and snipers under 5%, dev under 5%, fresh under 10%, no links)
   - **Filters** (per tier, kept in the browser): market cap at call, bundled, sniped, dev bought, fresh wallets,
     minimum peak, gems only, hide rug likely. Launch filters drop calls with no wallet read, like Gem Bot
   The risky tiers can run to hundreds of calls a day, so the live stream carries their last 3 hours and the board
   reads the full lists from `/feed?tier=risky|ultra&range=24h|7d&since=`.
4c. **Public lab** (`lib/lab.ts`, `#lab`, `/lab?range=24h|7d|30d`). Every live tier and every candidate rule is
   measured the same way on live data, uncapped: it fires the first time a radar token passes it on a price under
   90 s old, then the market cap is followed for 45 minutes (peak, end, paper trade with the call exit plan, net of
   ~2.5% costs), with a 95% band on the 2x rate. Candidates now: the first ultra rule, ultra and risky with a clean
   launch, ultra with a bundled launch, a gem-launch rule, each balanced path alone, balanced at 5 min+, balanced
   with RugCheck clean, DEX paid early. A live rule only changes when a candidate beats it there on enough fires,
   and every change goes into `lib/changelog.ts` (shown on `#method`)
4d. **Transparency.** `#method` writes out every rule with its numbers, the exit plans compared, the data sources,
   what we do not know yet and the changelog. `/scoreboard?range=7d` puts the tiers side by side (also on the tier
   switcher). `/export?tier=balanced|conservative|risky|ultra[&format=json]` downloads every call of a tier
5. **Kept forever.** Each call is written to a daily archive (`DATA_DIR/tns.calls.YYYY-MM-DD.json` on the
   worker) with market cap at the call, peak in the first hour, peak over 7 days, the latest price and a
   price series for the chart (priced every 30 s for the first hour, every 10 minutes after)

The old narrative scanner is still in the code; `NEXT_PUBLIC_NARRATIVE=1` switches back to it.

---

# Earlier notes

Solana memecoin signal site. Every new token launched on pump.fun / letsbonk is checked in real time
against a live narrative dictionary built from what the internet is talking about right now.
No min liquidity or min volume filters: the filter is the narrative.

## Data sources (all public, no keys)

Narratives (refreshed every 3 min, server side via `/api/narratives`):
- Google Trends daily RSS (US, GB, CA, AU, IN, NG, PH, SG, IE)
- Google News top stories RSS
- Reddit r/all hot (often blocked from cloud IPs, shown as unavailable when it is)
- CoinGecko trending
- GeckoTerminal Solana trending pools
- Wikipedia most read articles (English)
- YouTube trending videos US + GB (via kworb.net)
- DexScreener top boosts (Solana)

Tokens:
- PumpPortal websocket `subscribeNewToken` (connected directly from the browser)
- PumpPortal `subscribeTokenTrade` for matched tokens, first 15 min (buyers, net SOL flow)
- DexScreener latest token profiles (catches Raydium / Meteora / other launches)
- DexScreener token lookup for launches that arrive without a name

Safety: RugCheck summary API, shown as warnings, lowers score, never hides a token.

## Scoring (0-100)

- Narrative strength up to 50 (term weight x match quality: exact, word, contains, close spelling)
- Early traction up to 35 (unique buyers, net SOL in)
- Socials up to 9 (X, website, Telegram in metadata)
- Penalties: copycat on an already launched narrative, RugCheck danger risks, heavy selling

Tiers: Hot 65+, Warm 40+, Early below.

## Momentum

While a token is watched the site keeps rolling 1 and 5 minute windows over its trades:
new unique buyers, net SOL flow, market cap change, whale buys (2+ SOL), and how much of the
buying comes from the top 3 wallets. A token is Rising when it has 3+ new buyers in the last minute,
net SOL in, market cap up 5%+ over 5 min, and buyers arriving faster than the previous 4 minutes.
Tokens keep being watched past 15 min while they are Rising, Strong or still getting buyers (max 60 min).

Fresh narratives: terms that are new or grew 50%+ since the previous dictionary get a bonus.

Performance: current and peak multiple since the signal, plus a summary strip (median peak,
share that reached 2x) for signals older than 15 min.

## Run

```
npm install
npm run dev
```

Deploy: push to GitHub and import in Vercel. No env vars needed.

## Limits

Scanning runs in the browser tab, so signals are only produced while the site is open.
History is kept in that browser's localStorage (last 500 signals).

## Strong filter

A signal is marked Strong only when every check passes:
first token on the narrative, trend confirmed by 2+ sources (or a very heavy single trend),
clean name match, 8+ unique buyers, dev has not sold, no heavy sniping in the first seconds,
RugCheck clean, not being dumped. The detail panel shows which checks passed.

## Dev history

Every launch on the PumpPortal new-token stream is recorded per creator wallet (kept 7 days in
localStorage for repeat launchers and dumpers). For each signal:
- Serial dev: 3+ other launches in the last 24h (penalty), 6+ (bigger penalty)
- Dev still holding: the creator's token balance is read from Solana RPC (`/api/devbalance`) after 60s
  and every 2 min for the first hour. Under 50% of the initial buy = dev sold
- Previous dumps: the dev's earlier tokens (up to 5) are checked the same way. Any dump marks the dev
- Strong requires a clean dev history

RPC defaults to the public mainnet endpoint. Put `RPC_URL=...` in `.env` to use your own.

## Note on PumpPortal trade stream

`subscribeTokenTrade` now needs an API key funded with 0.02 SOL. The key controls a trading wallet,
so it must never be shipped to the browser. Momentum therefore comes from DexScreener polling
(every 20s for signals under 1 hour old). The trade-stream code stays in place and activates
automatically if the stream ever delivers trades again.

## Alerts, watchlist, graduation, report

- Alerts (header toggle): sound plus browser notification when a signal turns Rising, Strong or Graduated.
  Clicking the notification opens DexScreener. A reload does not replay old alerts
- Watchlist: your own words, matched like trending narratives with a fixed weight of 6 (stacks if the word
  is also trending). Stored in the browser
- Graduation: PumpPortal `subscribeMigration` (free). Signaled tokens that finish the bonding curve get a
  Graduated badge, filter and alert
- "What actually ran" report: for signals older than 15 min, 2x rate and median peak grouped by score,
  Strong, Rising, narrative source, number of confirming sources, match type, fresh narrative and dev status.
  Use it to see which filters work before tightening thresholds

## Signal hardening (RugCheck full report)

`/api/rugcheck` reads the full RugCheck report and is re-checked at about 5, 10 and 20 minutes:
- Holder concentration with AMM pools and bonding curves removed: top 10 over 35% or one wallet
  over 10% is penalised
- Insider networks (linked wallets, a common bundle signature): 5+ wallets or 15%+ of supply is penalised
- Rugged flag: heavy penalty
- Dev track record across every earlier launch (not only what this browser saw): 10+ launches with 80%+
  dead (under $8K mcap) = serial rugger. A previous token over $100K is a small bonus
- Everyday words and meme staples (life, party, cat, moon...) match at 40% strength and cannot be Strong,
  unless you put them on your watchlist

Strong now also requires: holders spread out, no insider network, not rugged, specific narrative.

## Running in the background

All engine timers run on a small Web Worker, so polling (DexScreener, RugCheck, dev balance checks)
keeps its pace when the tab is in the background instead of being throttled to once a minute.
A watchdog reconnects the PumpPortal socket after 90s of silence.

Export (feed header) downloads every signal with checks and performance as JSON, for tuning.

## One scanner per browser

The engine runs in one tab only (Web Locks API). Extra tabs show a notice, mirror the running tab's
signals through localStorage, and take over automatically when that tab closes. This keeps a single
PumpPortal connection, as PumpPortal asks, and stops two tabs from overwriting each other's history.

## Tuning from the report

"Which checks matter" shows, for every Strong check, the 2x rate of signals that passed vs failed it.
A lift well above 1 means the check is useful; around 1 means it is not separating winners from losers.
"Best narratives" lists the narratives that produced the biggest runs.

## Quality layer

- DEX paid: `/api/orders` checks DexScreener paid orders (profile, ads, boosts) for the top 20 young signals
  every minute. Paid = +10, paid within 30 min of launch = +5 more, boosts = +3
- Holder growth: holders per minute between RugCheck re-checks, up to +10
- Low effort: no X, Telegram, website or description in metadata = -10 and fails Strong
- Hide junk (feed, on by default): hides rugged, dev dumped or sold, serial ruggers, insider-heavy,
  no-effort tokens, anything under score 20 after 5 min, and tokens with under 15 holders after 15 min
  that are not rising. Untick to see everything

## False positive filters

- Copycat: an exact match on a narrative that only comes from CoinGecko, GeckoTerminal or DexScreener boosts
  is a copy of a live token, not a new story. -15 and fails Strong
- Narrative age: every narrative's first appearance is stored (3 days). A launch within 60 min of a narrative
  appearing gets +6 as a first mover
- Thin liquidity (normal AMM pools only): liquidity under 5% of FDV = -10 and fails Strong
- Dumped from peak: under 35% of peak after 10 min, or -50% in 5 min, goes to junk

## Backtest (three live samples, 811 launches, 30 min window)

Every pump.fun / bonk.fun launch was recorded with launch-time features only (narrative match done with the
same live dictionary the site uses), then the real 30 minute peak was read from minute candles.
Base rate of reaching 2x: 12.1%. Weights follow findings that held across runs.

| Feature | n | Reached 2x | Lift (all) | Per run |
|---|---|---|---|---|
| Narrative match, not a copycat | 24 | 20.8% | 1.72x | 2.9 / 1.9 / 1.0 |
| Copy of a live trending token | 11 | 9.1% | 0.75x | 0 / 0 / 1.2 |
| Dev buy under 0.5 SOL | 429 | 7.2% | 0.60x | 0.69 / 0.58 / 0.50 |
| Dev buy 0.5 to 2 SOL | 189 | 17.5% | 1.44x | 1.55 / 1.44 / 1.29 |
| Dev buy 2 to 10 SOL | 133 | 17.3% | 1.43x | 0.62 / 1.82 / 2.09 |
| Dev first launch | 598 | 13.7% | 1.13x | 1.09 / 1.15 / 1.05 |
| Dev with 1 to 9 earlier launches | 54 | 7.4% | 0.61x | 0.61 / 0.86 / 0.73 |
| Serial rugger dev | 123 | 6.5% | 0.54x | 0.72 / 0.51 / 0.42 |
| Dev with other launches in the window | 437 | 8.2% | 0.68x | 1.00 / 0.46 / 0.52 |

Run 3 was collected overnight (US/EU asleep): real-world narratives were thin and the matches were mostly
words from trending crypto tokens, and the narrative edge disappeared. The dev-side signals held in all runs.
Loose matching (any 4+ letter trend word inside the name) was tested and did worse than the strict matcher
(10% vs 16.7% in run 3), so the strict matcher stays.

## Wallet cohorts (free, straight from the chain)

`lib/cohort.ts` reads raw Solana RPC from the browser (publicnode + mainnet-beta, no key; add
`NEXT_PUBLIC_RPC_URL=` in `.env` to put your own RPC first). For each signal at 40 s, 5 min and 15 min:
- Walks the token's transaction history back to the launch block
- Bundlers: wallets that bought in the launch block (not the dev). Snipers: bought in the next 3 slots (~1.5 s)
- Fresh wallets: early buyers with under 30 lifetime transactions whose first one is under 3 days old
- Linked wallets: fresh buyers funded by the dev, or by a funder shared with another early buyer
- Current balances of all of them via their token accounts, so the hold % is what they hold now
- Combined risk: dev + bundlers + snipers + fresh + linked, each wallet counted once

Scoring: combined 30%+ -15, bundlers 10%+ -10, snipers 20%+ -8, fresh 15%+ -8, 2+ linked -10,
10+ bundlers -10, clean launch +6. Rug likely (junk): combined 50%+, bundlers 25%+, 4+ linked, or fresh 30%+.
Feed: Clean launch filter and a Limits panel (mcap range, max bundlers / snipers / fresh / combined %).

## Heaters

`/api/heaters` lists Solana pools under 24h that are heating up right now (GeckoTerminal 5 min trending
and newest pools: 15+ buyers in 5 min, more buys than sells, price up), narrative or not. The top 3 get a
wallet cohort read automatically, the rest on click.

## Market temperature

Header shows how many signals from the last 24h reached 2x (needs 10 settled signals): Hot 25%+, Warm 12%+, Cold.

## Shared mode: one scanner, everyone sees the same feed

`worker/index.ts` runs the whole engine 24/7 (`lib/core.ts`, the same logic as the browser engine) and serves:
- `GET /state` full signal list, narratives, stats (with `?since=<serverTime>` only what changed)
- `GET /heaters` heaters with wallet cohorts already read
- `GET /health`

It calls the site's API routes in-process, so it needs nothing from Vercel. State is saved to `DATA_DIR`
(signals, dev history, narrative baselines) and survives restarts when that folder is kept.

Run it anywhere Node 22 or Docker runs:

```
npm install
npm run worker            # PORT=8787 by default
# or: docker build -t tns-worker . && docker run -d -p 8787:8787 -v tns-data:/app/data tns-worker
```

On a VPS keep it alive with pm2 (`pm2 start "npm run worker" --name tns-worker && pm2 save`) and put it behind
HTTPS (Caddy: `your.domain { reverse_proxy localhost:8787 }`), because the site is served over HTTPS.
On Railway / Render / Fly: deploy the repo with the Dockerfile and attach a volume at `/app/data`.
Cloudflare Workers cannot run it (it needs a long-lived Node process and WebSocket client).

Then set `NEXT_PUBLIC_WORKER_URL=https://your-worker-url` on Vercel and redeploy. Every visitor now reads the
same feed. Without the variable the site falls back to scanning in each visitor's tab.

## Telegram calls (pnl.meme style), on hold

Off by default. Turn on with `NEXT_PUBLIC_CALLS_ENABLED=1` (site and worker) plus `CALL_CHANNELS`.

`/api/calls` reads the public web preview (`t.me/s/<channel>`) of every channel in `CALL_CHANNELS` (or
`DEFAULT_CHANNELS` in `lib/calls.ts`), no key or bot needed, and pulls Solana token addresses out of the posts
and their links. The Calls board ranks tokens by how many followed channels called them, with FDV at the
call (first price seen after it), now vs call and peak. Signals that were also called get a badge and a small
score bonus (1 channel +4, 2 +8, 3+ +12, not backtested yet). The report groups results by called / not called.

## Track record

Shown above the feed: last 24h signals older than 30 min, 2x and 3x rates for all signals, Strong, clean
launches, rising and Telegram-called signals, plus the best calls. With the shared worker it is the same for
everyone, like a public win rate.

## Faster wallet reads

Wallet cohorts are now read at about 15 s, 2 min and 10 min after a signal (was 40 s, 5 min, 15 min).
For faster and more reliable reads set a free Helius RPC: `NEXT_PUBLIC_RPC_URL` (browser) or `RPC_URL` (worker).

## Smart money (learned from the chain, no copied lists)

`lib/smart.ts`. No smart wallet list is bought or copied from other services. The scanner learns its own:
- Every wallet read as an early buyer (first 10 minutes) of a token is remembered. Bundlers and dev-funded
  wallets never count
- About 45 minutes later the token is judged: signals by their tracked peak, and on the worker one random
  launch per minute is also sampled and judged from GeckoTerminal candles (`/api/peak`)
- A wallet becomes smart after 2+ early buys that reached 3x, at a 25%+ hit rate. This filters out bots that
  buy everything
- `SMART_WALLETS=` (comma separated) adds wallets you know yourself; they count as smart from the start

Uses:
- Signals show how many smart wallets are among the early buyers (score +6 / +12 / +18, not backtested yet)
- Worker only: the top 40 smart wallets (`SMART_WATCH`) are polled every minute; a token bought by 2+ of them
  within 30 minutes shows up under "Smart wallets buying together", whether it matched a narrative or not
- Smart wallet board: wins / seen, hit rate, best multiple, with GMGN links

## Graduation pace

pump.fun tokens before graduation get their bonding curve progress estimated from market cap (constant product
math in `lib/curve.ts`), its speed in % per minute and the minutes left at that pace. Filling 3%+ a minute past
20% adds +4.

## Track record with ranges (worker)

The worker logs every settled signal (entry market cap, time, peak, Strong, clean, rising, smart) and serves
`/record?range=24h|7d|30d|all`: count, 2x / 3x / 5x / 10x / 25x / 50x / 100x distribution, median peak, groups
and best calls. Multiples are entry to peak while tracked (up to 1 hour), not realized profit.

## Reliability

- One shared RPC budget (`RPC_RPS`, default 8 per second on public endpoints, 25 with your own RPC) for every
  chain read, plus per endpoint and method cool-downs: a 429 parks that endpoint for that method for a few
  seconds, "needs a token" or "too many accounts" parks it for 10 minutes, and the other endpoint is used
- Cohort backlog is capped (150 signal reads, 25 heater / learning reads); when the chain is slow the oldest
  waiting work is dropped instead of piling up
- One-shot timers remove themselves when they fire, dev and narrative memory are pruned, outcome and smart
  wallet stores are size capped, so the worker can run for weeks
- The worker logs and survives unhandled errors; `/health` shows stream state, tokens per minute, last flush,
  cohort queue, RPC calls / 429s / failures, smart wallet stats and memory
- Smart wallet book is checkpointed every 15 minutes and on shutdown

## Sharing and alerts

- Every signal has "Copy signal link" (`/?mint=<address>`), which opens that signal for whoever clicks it
- Alerts also fire when 2+ smart wallets are among a signal's early buyers
- Quick links: Jupiter, BullX, Pump.fun, DexScreener, GMGN, Axiom, Solscan

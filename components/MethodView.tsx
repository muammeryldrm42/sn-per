"use client";

// How it works: every rule in plain words with its numbers, where the data comes from, what we do not know,
// the public export and the changelog. Nothing on this site is hidden or paid for.
import { useEffect, useState } from "react";
import { PageTitle } from "./ui";
import { CHANGELOG } from "@/lib/changelog";
import { TIERS, RUG_RULE, GEM_RULE } from "@/lib/tiers";
import { PAPER_RULES } from "@/lib/archive";

interface Score {
  tier: string;
  n: number;
  hit2: number;
  down80: number;
  paper: number;
}

// Exit plans compared on the same calls of both recordings (45 min, average multiple per call, before costs).
const EXITS: { plan: string; risky: string; ultra: string; balanced: string }[] = [
  { plan: "Hold 45 minutes", risky: "0.99x", ultra: "0.93x", balanced: "0.95x" },
  { plan: "Half at 2x, cut at 0.6x, rest trailed 35% (site's plan)", risky: "1.17x", ultra: "1.08x", balanced: "1.02x" },
  { plan: "All at 2x, cut at 0.6x", risky: "1.15x", ultra: "1.03x", balanced: "1.07x" },
  { plan: "All at 1.5x, cut at 0.6x", risky: "1.02x", ultra: "0.89x", balanced: "0.96x" },
  { plan: "All at 1.3x, cut at 0.7x", risky: "0.95x", ultra: "0.89x", balanced: "0.96x" },
  { plan: "All at 3x, cut at 0.6x", risky: "1.05x", ultra: "0.93x", balanced: "0.97x" },
];

export function MethodView({ remoteUrl }: { remoteUrl?: string }) {
  const base = remoteUrl?.replace(/\/$/, "");
  const [score, setScore] = useState<Score[] | null>(null);
  useEffect(() => {
    if (!base) return;
    fetch(`${base}/scoreboard?range=7d`, { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => setScore(j.tiers ?? []))
      .catch(() => setScore(null));
  }, [base]);

  return (
    <div className="max-w-5xl">
      <PageTitle dim="How it" bright="Works" />

      <Section title="What this site promises">
        <ul className="list-disc space-y-1.5 pl-5">
          <li>Every call is free and the same for everyone. No paid tier, no paid placement, no promoted tokens.</li>
          <li>Every call is kept forever, losers included, with the market cap at the call and every price check after it.</li>
          <li>
            Peaks are not profits. Every call also carries a paper trade with one fixed exit plan, and the lab shows it after ~2.5% round-trip costs.
          </li>
          <li>Every rule is written below with the numbers it came from. Every change is in the changelog. Every call can be downloaded.</li>
          <li>
            Nothing is copied from other call sites. We read how Gem Bot and pnl.meme present their feeds and use the same ideas (tiers, rug check,
            launch numbers), with our own data and rules.
          </li>
        </ul>
      </Section>

      <Section title="The four tiers">
        <div className="grid gap-3 md:grid-cols-2">
          {TIERS.map((t) => {
            const s = score?.find((x) => x.tier === t.id);
            return (
              <div key={t.id} className="rounded-lg border border-line bg-row/40 p-3">
                <p className="flex items-center gap-2 font-semibold text-text">
                  <span className="h-2 w-2 rounded-full" style={{ background: t.color }} aria-hidden />
                  {t.label}
                </p>
                <p className="mt-1 text-[12.5px] leading-relaxed text-muted">{t.blurb}</p>
                <p className="mt-2 font-mono text-[11px] text-dim">
                  {s
                    ? s.n
                      ? `Last 7 days: ${s.n} settled calls, ${s.hit2}% hit 2x, ${s.down80}% now down 80%+, paper ${s.paper.toFixed(2)}x before costs`
                      : "Last 7 days: no settled calls yet"
                    : base
                      ? "Loading the live record..."
                      : "Live record on the shared scanner"}
                </p>
              </div>
            );
          })}
        </div>
        <p className="mt-3 text-[12.5px] text-muted">
          Numbers in the rule texts come from two live recordings (3.6 hours, 601 radar tokens, every 15 seconds, outcome over the next 45 minutes).
          That is a small sample: the live record and the <a href="#lab" className="text-flow hover:underline">public lab</a> are the real measure.
        </p>
      </Section>

      <Section title="Checks every main call passes">
        <ul className="list-disc space-y-1.5 pl-5">
          <li>A proof: graduated from the pump.fun curve, a 5x run since launch that still holds near its high ($30K+), or 2+ independent smart wallets or KOLs with 30+ buys in 5 minutes.</li>
          <li>Health: dev has not sold, not dumped, within 20% of its high, more buys than sells and price not falling over 5 minutes, traded at least 30% of its market cap.</li>
          <li>Anti-rug: nothing in the first 3 minutes (47% of tokens under 2 minutes old ended under 0.2x in the recordings, 18% of those 5 minutes and older); a fast mover is never called before its wallet read is in.</li>
          <li>Wallet read vetoes: bundlers holding 15%+, or bundlers, snipers, fresh and linked wallets holding 30%+ together. RugCheck: creator flagged for past rugs.</li>
          <li>Never more than 3 main calls an hour, never on a price older than 90 seconds.</li>
        </ul>
      </Section>

      <Section title="On every call">
        <ul className="list-disc space-y-1.5 pl-5">
          <li>
            <b className="text-text">Rug check</b> (Gem Bot&apos;s published rule v1, on volume): reference = the largest of market cap, peak and $
            {RUG_RULE.minReferenceUsd / 1000}K. Gem Bot asks for $35 of trading fees per $10K of it, capped at $7K; we read volume, so we ask for{" "}
            {Math.round(RUG_RULE.volumeShare * 100)}% of the reference traded (assuming ~1.25% fees), capped at ${RUG_RULE.volumeCapUsd / 1000}K.
            Clean = real buying and selling for its size. Rug likely = barely any real trading. Checking = not enough data yet, or under 5 minutes old.
          </li>
          <li>
            <b className="text-text">Launch read</b>: share of supply bought with the create by other wallets (bundled), in the next 3 slots (sniped), and
            by the dev. Read from the chain for every young radar token; it is history, so it can land a few seconds after a call.
          </li>
          <li>
            <b className="text-text">Gem</b>: under {GEM_RULE.bundledMax}% bundled, under {GEM_RULE.snipedMax}% sniped, dev buy under {GEM_RULE.creatorMax}%, fresh wallets under{" "}
            {GEM_RULE.freshMax}% and no linked wallets when the wallet read is in. A signal, not a guarantee.
          </li>
          <li>
            <b className="text-text">Paper trade</b>: buy at the call, sell half at {PAPER_RULES.tp}x, cut everything at {PAPER_RULES.stop}x before that, sell the rest{" "}
            {Math.round((1 - PAPER_RULES.trail) * 100)}% off its high, close after 7 days. Prices are our own readings (every 30 s for the first hour).
          </li>
        </ul>
      </Section>

      <Section title="Which exit plan, measured">
        <p className="mb-2 text-[12.5px] text-muted">Same calls, different exits, average multiple per call before costs (both recordings, 45 minutes):</p>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] font-mono text-[12px]">
            <thead>
              <tr className="text-left text-[10px] uppercase tracking-wider text-dim">
                <th className="py-1.5 pr-3 font-normal">Exit plan</th>
                <th className="py-1.5 pr-3 font-normal">Risky</th>
                <th className="py-1.5 pr-3 font-normal">Ultra</th>
                <th className="py-1.5 font-normal">Balanced</th>
              </tr>
            </thead>
            <tbody>
              {EXITS.map((e) => (
                <tr key={e.plan} className="border-t border-line">
                  <td className="py-1.5 pr-3 text-text">{e.plan}</td>
                  <td className="py-1.5 pr-3">{e.risky}</td>
                  <td className="py-1.5 pr-3">{e.ultra}</td>
                  <td className="py-1.5">{e.balanced}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-[12.5px] text-muted">
          Holding loses on every tier. Taking profit at 2x and cutting losers early is what made money on these samples; fast tiers fall back hard after
          their first spike.
        </p>
      </Section>

      <Section title="Where the data comes from">
        <ul className="list-disc space-y-1.5 pl-5">
          <li>Launches: PumpPortal&apos;s free stream, plus launches it dropped read back from the chain (pump.fun&apos;s mint authority signs every create).</li>
          <li>Prices, volume, buys and sells: DexScreener. Candles: GeckoTerminal. Risk report: RugCheck. Wallet and launch reads: Solana RPC.</li>
          <li>KOL wallets: kolscan.io&apos;s public leaderboard (the list only; their trades are read from the chain). Smart wallets: learned by the scanner from who bought early in tokens that later ran.</li>
        </ul>
      </Section>

      <Section title="What we do not know yet">
        <ul className="list-disc space-y-1.5 pl-5">
          <li>Rule numbers come from 3.6 hours of recordings: 20 to 160 calls per rule. The 95% bands in the lab show how wide that is.</li>
          <li>Whether a bundled launch predicts a rug: the launch read is new, so it runs in the lab before it becomes a filter.</li>
          <li>Launches from other launchpads (Meteora, Bonk and others) are only seen once they reach DexScreener.</li>
        </ul>
      </Section>

      <Section title="Download every call">
        <div className="flex flex-wrap gap-2">
          {TIERS.map((t) => (
            <a
              key={t.id}
              href={base ? `${base}/export?tier=${t.id}` : undefined}
              aria-disabled={!base}
              className={`rounded-md border border-line px-3 py-1.5 font-mono text-[11px] uppercase tracking-wider ${base ? "text-muted hover:text-text" : "pointer-events-none text-dim"}`}
            >
              {t.label} CSV
            </a>
          ))}
        </div>
        <p className="mt-2 text-[12.5px] text-muted">Time, mint, market cap at the call, peak, now, paper result, launch numbers. JSON: add &format=json.</p>
      </Section>

      <Section title="Changelog">
        <div className="space-y-3">
          {CHANGELOG.map((c) => (
            <div key={c.date}>
              <p className="font-mono text-[11px] uppercase tracking-wider text-dim">{c.date}</p>
              <ul className="mt-1 list-disc space-y-1 pl-5">
                {c.items.map((i) => (
                  <li key={i}>{i}</li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </Section>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="card mb-4 px-4 py-4">
      <h2 className="label mb-3">{title}</h2>
      <div className="text-[13px] leading-relaxed text-muted">{children}</div>
    </section>
  );
}

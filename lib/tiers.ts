// Call tiers, the way Gem Bot splits its feed (conservative, balanced, risky, ultra risky), with our own rules and
// numbers behind each one. Every tier is free and has its own list and its own track record.
//  - Conservative: balanced calls whose wallet read and RugCheck were in and clean at the call (grade "solid")
//  - Balanced: the main gate (graduated, 5x runner or smart money, health checks, anti-rug)
//  - Risky: fresh launch rule (first 3 min on the curve, curve 65% full or less, dev's own buy under 1 SOL)
//  - Ultra risky: launches over $6K in their first 3 minutes, before any proof (curve, dev buy and buying cuts)
import type { CallRow } from "./archive";

export type TierId = "conservative" | "balanced" | "risky" | "ultra";
// Where each tier's calls are stored: the main archive (conservative is a filter on it), "early" and "ultra".
export type Book = "main" | "early" | "ultra";

export const TIERS: { id: TierId; label: string; short: string; color: string; book: Book; blurb: string }[] = [
  {
    id: "conservative",
    label: "Conservative",
    short: "Safe",
    color: "#60a5fa",
    book: "main",
    blurb: "Balanced calls whose wallet read and RugCheck were both in and clean at the call. Fewest calls.",
  },
  {
    id: "balanced",
    label: "Balanced",
    short: "Main",
    color: "#4ade50",
    book: "main",
    blurb: "A proof first (graduated, a 5x run that holds, or 2+ smart wallets), then every health and anti-rug check.",
  },
  {
    id: "risky",
    label: "Risky",
    short: "Risky",
    color: "#ff9f43",
    book: "early",
    blurb: "First 3 minutes on the pump.fun curve: 2x+ since launch, buys 1.5x sells, curve 65% full or less, dev's own buy under 1 SOL.",
  },
  {
    id: "ultra",
    label: "Ultra risky",
    short: "Ultra",
    color: "#b07cff",
    book: "ultra",
    blurb: "Launches over $6K in their first 3 minutes, before any proof: 2x+ since launch, more buys than sells, curve 80% full or less, dev's own buy under 1 SOL.",
  },
];

export const tierOf = (id: string | undefined): (typeof TIERS)[number] => TIERS.find((t) => t.id === id) ?? TIERS[1];

export function rowsForTier(tier: TierId, main: CallRow[], early: CallRow[], ultra: CallRow[]): CallRow[] {
  if (tier === "conservative") return main.filter((r) => r.g === "solid");
  if (tier === "risky") return early;
  if (tier === "ultra") return ultra;
  return main;
}

// Rug check, Gem Bot's rule v1 on our data. Gem Bot compares the trading fees a coin has paid with its size:
// reference = max(market cap now, peak, $40K), cutoff = $35 per $10K of reference, capped at $7K. Fees are a share
// of volume and we read volume, not fees, so the cutoff is turned into volume since launch, assuming fees of about
// 1.25% a trade: $35 of fees per $10K is ~$2,800 traded per $10K, i.e. 28% of the reference cap (max $560K).
export const RUG_RULE = { minReferenceUsd: 40_000, volumeShare: 0.28, volumeCapUsd: 560_000 };
export type RugVerdict = "clean" | "rug" | "checking";

// A coin under 5 minutes old that has not reached the cutoff yet is still "checking", not "rug": a $40K reference is
// more volume than most launches can trade in their first minutes. It is graded for real after that.
export const RUG_GRACE_MS = 5 * 60_000;
export function rugCheck(vol: number | null | undefined, nowUsd: number, peakUsd: number, ageMs = Infinity) {
  const ref = Math.max(nowUsd || 0, peakUsd || 0, RUG_RULE.minReferenceUsd);
  const cutoff = Math.min(ref * RUG_RULE.volumeShare, RUG_RULE.volumeCapUsd);
  if (vol == null || !(vol >= 0)) return { verdict: "checking" as RugVerdict, cutoff, ref };
  if (vol >= cutoff) return { verdict: "clean" as RugVerdict, cutoff, ref };
  return { verdict: (ageMs < RUG_GRACE_MS ? "checking" : "rug") as RugVerdict, cutoff, ref };
}

export const RUG_TEXT: Record<RugVerdict, { label: string; line: string }> = {
  clean: { label: "Clean", line: "Real buying and selling for a coin this size. Not a safety guarantee." },
  rug: { label: "Rug likely", line: "Barely any real trading for a coin this size. Coins like this are usually scams." },
  checking: { label: "Checking", line: "Not enough trading data yet." },
};

// Graded with the volume of the last price check, so the age is the token's age at that check.
export const rowRug = (r: CallRow) => rugCheck(r.vol, r.now, r.pk, r.chk - (r.la ?? r.t)).verdict;

// Gem: a clean launch, from the launch read (only when it is in). Gem Bot keeps its exact rule private; ours: under
// 5% of supply bought with the create by other wallets (bundled), under 5% in the next 3 slots (sniped), the dev's
// own buy under 5%, fresh wallets under 10% and no linked wallets when the wallet read is in.
export const GEM_RULE = { bundledMax: 5, snipedMax: 5, creatorMax: 5, freshMax: 10 };
export function isGem(r: Pick<CallRow, "bp" | "sp" | "cb" | "fw" | "lk">): boolean {
  if (r.bp == null || r.sp == null) return false;
  return r.bp < GEM_RULE.bundledMax && r.sp < GEM_RULE.snipedMax && (r.cb ?? 0) < GEM_RULE.creatorMax && (r.fw ?? 0) < GEM_RULE.freshMax && !(r.lk ?? 0);
}

// Board filters, the same set Gem Bot offers. null = off.
export interface Filters {
  mcMin: number | null;
  mcMax: number | null;
  bundledMax: number | null;
  snipedMax: number | null;
  creatorMax: number | null;
  freshMax: number | null;
  peakMin: number | null;
  gemOnly: boolean;
  hideRug: boolean;
}
export const NO_FILTERS: Filters = { mcMin: null, mcMax: null, bundledMax: null, snipedMax: null, creatorMax: null, freshMax: null, peakMin: null, gemOnly: false, hideRug: false };

export function activeFilters(f: Filters): number {
  return Object.entries(f).filter(([, v]) => (typeof v === "boolean" ? v : v != null)).length;
}

// A filter on a launch number drops calls whose number is unknown (no wallet read), like Gem Bot.
export function passFilters(r: CallRow, f: Filters): boolean {
  if (f.mcMin != null && !(r.c >= f.mcMin)) return false;
  if (f.mcMax != null && !(r.c <= f.mcMax)) return false;
  if (f.bundledMax != null && !(r.bp != null && r.bp <= f.bundledMax)) return false;
  if (f.snipedMax != null && !(r.sp != null && r.sp <= f.snipedMax)) return false;
  if (f.creatorMax != null && !(r.cb != null && r.cb <= f.creatorMax)) return false;
  if (f.freshMax != null && !(r.fw != null && r.fw <= f.freshMax)) return false;
  if (f.peakMin != null && !(r.pk / r.c >= f.peakMin)) return false;
  if (f.gemOnly && !isGem(r)) return false;
  if (f.hideRug && rowRug(r) === "rug") return false;
  return true;
}

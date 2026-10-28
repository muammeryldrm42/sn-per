// Every change to how calls are made, newest first. Shown on the "How it works" page.
export const CHANGELOG: { date: string; items: string[] }[] = [
  {
    date: "2026-10-28",
    items: [
      "Public lab: every live tier and every candidate rule is now measured live, uncapped, the same way (45 min outcome, paper trade, net of costs), with 95% bands.",
      "Ultra risky tightened: 2x+ since launch, more buys than sells, curve 80% full or less, dev's own buy under 1 SOL. On both recordings the first version (every healthy launch over $6K) hit 2x 23% with 21% ending under 0.2x and lost money with the paper plan (0.96x); the cut version hit 2x 35% with 8% under 0.2x (1.08x). The first version keeps running in the lab.",
      "Launch read for every young radar token: share of supply bundled with the create, sniped in the next 3 slots, and the dev's own buy. Shown on every call; the bundle as a rug filter is being measured in the lab first.",
      "Launch backfill: launches the free PumpPortal stream drops (about half at busy times) are read from the chain within 20-60 s.",
      "Public export: every call of every tier as CSV or JSON.",
    ],
  },
  {
    date: "2026-10-27",
    items: [
      "Four tiers like Gem Bot's feeds (conservative, balanced, risky, ultra risky), each with its own list and track record. Rug check verdict on every call (Gem Bot's published rule v1, on volume). Gem flag and board filters.",
      "Insider rule fixed: a token is no longer thrown away for having 5+ insider wallets when they hold 15% or less (it removed 46 of 602 radar tokens for nothing, Frongus among them).",
      "DEX paid profiles are now flagged on tokens whose launch the scanner saw (they were skipped before).",
      "Risky tier (fresh launch rule): first 3 minutes on the curve, curve 65% or less, buys 1.5x sells, dev's own buy under 1 SOL.",
      "Anti-rug for the main calls: nothing in the first 3 minutes; a fast mover is never called before its wallet read (bundle check) is in.",
      "KOL and smart wallet buys under 0.2 SOL no longer count toward a call.",
    ],
  },
  {
    date: "earlier",
    items: [
      "Call gate v3: a proof first (graduated, 5x run that holds, or 2+ independent smart wallets), then health checks. Graduating proof turned off after it failed on unseen data.",
    ],
  },
];

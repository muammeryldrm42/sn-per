import { NextResponse } from "next/server";
import { UA } from "@/lib/dex";

export const dynamic = "force-dynamic";

// SOL price in USD, CoinGecko first, DexScreener SOL/USDC pair as fallback.
export async function GET() {
  try {
    const r = await fetch("https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd", {
      headers: UA,
      next: { revalidate: 60 },
      signal: AbortSignal.timeout(6000),
    });
    const j = await r.json();
    if (typeof j?.solana?.usd === "number") return NextResponse.json({ solUsd: j.solana.usd });
  } catch {
    /* fall back */
  }
  try {
    const r = await fetch("https://api.dexscreener.com/tokens/v1/solana/So11111111111111111111111111111111111111112", {
      headers: UA,
      cache: "no-store",
      signal: AbortSignal.timeout(6000),
    });
    const pairs = (await r.json()) as { quoteToken?: { symbol?: string }; priceUsd?: string; liquidity?: { usd?: number } }[];
    const best = pairs
      .filter((p) => /USDC|USDT/.test(p.quoteToken?.symbol ?? ""))
      .sort((a, b) => (b.liquidity?.usd ?? 0) - (a.liquidity?.usd ?? 0))[0];
    if (best?.priceUsd) return NextResponse.json({ solUsd: Number(best.priceUsd) });
  } catch {
    /* none */
  }
  return NextResponse.json({ solUsd: null }, { status: 502 });
}

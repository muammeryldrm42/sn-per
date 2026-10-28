import type { TokenLookup } from "./types";

export const UA = { "User-Agent": "Mozilla/5.0 (compatible; TalonsNarrativeSniper/1.0)" };

interface DexPair {
  chainId: string;
  dexId: string;
  url: string;
  pairAddress?: string;
  baseToken: { address: string; name: string; symbol: string };
  fdv?: number;
  priceUsd?: string;
  liquidity?: { usd?: number };
  txns?: { m5?: { buys: number; sells: number } };
  priceChange?: { m5?: number };
  volume?: { m5?: number; h1?: number; h24?: number };
  pairCreatedAt?: number;
  info?: { imageUrl?: string };
}

// DexScreener accepts up to 30 addresses per call.
export async function lookupTokens(addresses: string[]): Promise<TokenLookup[]> {
  const uniq = [...new Set(addresses.filter(Boolean))].slice(0, 30);
  if (!uniq.length) return [];
  const res = await fetch(`https://api.dexscreener.com/tokens/v1/solana/${uniq.join(",")}`, {
    headers: UA,
    cache: "no-store",
    signal: AbortSignal.timeout(7000),
  });
  if (!res.ok) throw new Error(`dexscreener ${res.status}`);
  const pairs = (await res.json()) as DexPair[];
  const best = new Map<string, DexPair>();
  for (const p of Array.isArray(pairs) ? pairs : []) {
    const addr = p.baseToken?.address;
    if (!addr || !uniq.includes(addr)) continue;
    const cur = best.get(addr);
    if (!cur || (p.liquidity?.usd ?? 0) > (cur.liquidity?.usd ?? 0)) best.set(addr, p);
  }
  return [...best.entries()].map(([address, p]) => ({
    address,
    name: p.baseToken.name,
    symbol: p.baseToken.symbol,
    dexId: p.dexId,
    pairUrl: p.url,
    pairAddress: p.pairAddress,
    fdvUsd: p.fdv,
    liquidityUsd: p.liquidity?.usd,
    m5Buys: p.txns?.m5?.buys,
    m5Sells: p.txns?.m5?.sells,
    pairCreatedAt: p.pairCreatedAt,
    image: p.info?.imageUrl,
    priceChange5m: p.priceChange?.m5,
    volume5m: p.volume?.m5,
    priceUsd: p.priceUsd ? Number(p.priceUsd) : undefined,
    volume24h: p.volume?.h24,
  }));
}

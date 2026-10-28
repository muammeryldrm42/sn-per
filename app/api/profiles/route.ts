import { NextResponse } from "next/server";
import { lookupTokens, UA } from "@/lib/dex";

export const dynamic = "force-dynamic";

interface Profile {
  chainId: string;
  tokenAddress: string;
  icon?: string;
  description?: string;
  links?: { type?: string; label?: string; url: string }[];
}

export async function GET() {
  try {
    const res = await fetch("https://api.dexscreener.com/token-profiles/latest/v1", {
      headers: UA,
      cache: "no-store",
      signal: AbortSignal.timeout(7000),
    });
    if (!res.ok) throw new Error(`dexscreener ${res.status}`);
    const profiles = ((await res.json()) as Profile[]).filter((p) => p.chainId === "solana");
    const tokens = await lookupTokens(profiles.map((p) => p.tokenAddress));
    const byAddr = new Map(tokens.map((t) => [t.address, t]));

    const out = profiles
      .filter((p) => byAddr.has(p.tokenAddress))
      .map((p) => {
        const t = byAddr.get(p.tokenAddress)!;
        const link = (kind: string) =>
          p.links?.find((l) => (l.type || l.label || "").toLowerCase().includes(kind))?.url;
        return {
          ...t,
          description: p.description,
          image: p.icon || t.image,
          twitter: link("twitter"),
          telegram: link("telegram"),
          website: p.links?.find((l) => !l.type)?.url,
        };
      });
    return NextResponse.json({ profiles: out });
  } catch (e) {
    return NextResponse.json({ profiles: [], error: String((e as Error).message) }, { status: 502 });
  }
}

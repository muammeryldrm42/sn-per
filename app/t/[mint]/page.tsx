import type { Metadata } from "next";
import { CallsApp } from "@/components/CallsApp";
import { getCall, shortUsd, shortX } from "@/lib/receipt";

export const dynamic = "force-dynamic";

// Shareable call page: /t/<mint>. Same app, opened on the token, with a preview card for X and Telegram.
export async function generateMetadata({ params }: { params: Promise<{ mint: string }> }): Promise<Metadata> {
  const { mint } = await params;
  const c = await getCall(mint);
  const sym = c?.s?.replace(/^\$+/, "");
  const title = c ? `$${sym} ${shortX(c.pk / c.c)} since the Talons call` : "Talons Calls";
  const description = c
    ? `Called at ${shortUsd(c.c)} market cap, peak ${shortUsd(c.pk)}. Free Solana calls, every call logged forever.`
    : "Free Solana memecoin calls. Every launch watched on-chain, every call tracked forever.";
  return { title, description, openGraph: { title, description }, twitter: { card: "summary_large_image", title, description } };
}

export default async function TokenPage({ params }: { params: Promise<{ mint: string }> }) {
  const { mint } = await params;
  return <CallsApp initialMint={mint} />;
}

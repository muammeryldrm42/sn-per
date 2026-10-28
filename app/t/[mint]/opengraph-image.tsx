import { ImageResponse } from "next/og";
import { getCall, shortUsd, shortX } from "@/lib/receipt";

export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const alt = "Talons call receipt";

// Call receipt for link previews: ticker, market cap at the call, peak and the multiple.
export default async function Image({ params }: { params: Promise<{ mint: string }> }) {
  const { mint } = await params;
  const c = await getCall(mint);
  const sym = c ? c.s.replace(/^\$+/, "") : "";
  const x = c ? c.pk / c.c : 0;
  const now = c ? c.now / c.c : 0;
  const green = "#4ade50";
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", background: "#08090c", color: "#e5ebf1", padding: 64, fontFamily: "sans-serif" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
            <div style={{ width: 44, height: 44, borderRadius: 10, border: "2px solid #4ade5059", background: "#4ade5014", display: "flex", alignItems: "center", justifyContent: "center", color: green, fontSize: 26, fontWeight: 800 }}>
              T
            </div>
            <div style={{ display: "flex", fontSize: 30, fontWeight: 800, letterSpacing: 2 }}>TALONS CALLS</div>
          </div>
          <div style={{ display: "flex", fontSize: 22, color: "#8b93a1" }}>{c ? new Date(c.t).toISOString().slice(0, 16).replace("T", " ") + " UTC" : "free solana calls"}</div>
        </div>
        {c ? (
          <div style={{ display: "flex", flex: 1, flexDirection: "column", justifyContent: "center" }}>
            <div style={{ display: "flex", fontSize: 84, fontWeight: 800 }}>{`$${sym}`}</div>
            <div style={{ display: "flex", alignItems: "flex-end", gap: 40, marginTop: 12 }}>
              <div style={{ display: "flex", fontSize: 190, fontWeight: 800, color: x >= 2 ? green : "#e5ebf1", lineHeight: 1 }}>{shortX(x)}</div>
              <div style={{ display: "flex", flexDirection: "column", fontSize: 30, color: "#8b93a1", paddingBottom: 18 }}>
                <div style={{ display: "flex" }}>{`called at ${shortUsd(c.c)}`}</div>
                <div style={{ display: "flex", color: green }}>{`peak ${shortUsd(c.pk)}`}</div>
                <div style={{ display: "flex" }}>{`now ${shortX(now)}`}</div>
              </div>
            </div>
          </div>
        ) : (
          <div style={{ display: "flex", flex: 1, alignItems: "center", fontSize: 72, fontWeight: 800 }}>Every Solana launch, watched.</div>
        )}
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 22, color: "#5d6371" }}>
          <div style={{ display: "flex" }}>peak = highest market cap after the call, not profit</div>
          <div style={{ display: "flex" }}>every call logged forever</div>
        </div>
      </div>
    ),
    size
  );
}

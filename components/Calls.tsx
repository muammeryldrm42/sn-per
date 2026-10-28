"use client";

import { useEffect, useRef, useState } from "react";
import { createCallboard, type CallboardState } from "@/lib/callboard";
import { age, mult, usd } from "@/lib/format";

const local = {
  get: (k: string) => {
    try {
      return localStorage.getItem(k);
    } catch {
      return null;
    }
  },
  set: (k: string, v: string) => {
    try {
      localStorage.setItem(k, v);
    } catch {
      /* ignore */
    }
  },
};

// Tokens called by the followed Telegram channels, ranked by how many channels called them.
export function Calls({ remoteUrl }: { remoteUrl?: string } = {}) {
  const [state, setState] = useState<CallboardState | null>(null);
  const [open, setOpen] = useState(true);
  const [now, setNow] = useState(() => Date.now());
  const board = useRef<ReturnType<typeof createCallboard> | null>(null);

  useEffect(() => {
    let alive = true;
    if (!remoteUrl && !board.current) board.current = createCallboard({ api: (p) => fetch(p), storage: local });
    const load = async () => {
      try {
        if (remoteUrl) {
          const r = await fetch(`${remoteUrl.replace(/\/$/, "")}/calls`, { cache: "no-store" });
          if (!r.ok) throw new Error(`HTTP ${r.status}`);
          const j = (await r.json()) as CallboardState;
          if (alive) setState(j);
        } else if (board.current) {
          await board.current.refresh();
          if (alive) setState(board.current.state());
        }
      } catch (e) {
        if (alive) setState((s) => ({ entries: s?.entries ?? [], channels: s?.channels ?? [], updatedAt: s?.updatedAt ?? 0, error: (e as Error).message }));
      }
      if (alive) setNow(Date.now());
    };
    load();
    const t = setInterval(load, 60_000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [remoteUrl]);

  const noChannels = state && state.channels.length === 0;

  return (
    <section className="border-b border-line px-5 py-5 md:px-8" aria-labelledby="calls-title">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-baseline justify-between text-left"
      >
        <h2 id="calls-title" className="font-display text-lg font-bold">
          Calls
        </h2>
        <span className="text-sm text-muted">
          {open ? "Hide" : "Show"} tokens called by followed Telegram channels, last 24h
        </span>
      </button>
      {open &&
        (!state ? (
          <p className="mt-3 text-sm text-muted">Reading channels...</p>
        ) : noChannels ? (
          <p className="mt-3 max-w-prose text-sm text-muted">
            No channels followed yet. Add public Telegram channel usernames to <code className="font-mono">CALL_CHANNELS</code> in
            .env (comma separated) or to <code className="font-mono">DEFAULT_CHANNELS</code> in lib/calls.ts.
          </p>
        ) : (
          <>
            <ul className="mt-3 flex flex-wrap gap-2 text-xs">
              {state.channels.map((c) => (
                <li
                  key={c.name}
                  title={c.error}
                  className={`rounded-full border px-2.5 py-1 ${c.ok ? "border-line text-muted" : "border-warn/40 text-warn"}`}
                >
                  @{c.name} {c.ok ? `(${c.posts})` : "unavailable"}
                </li>
              ))}
            </ul>
            {state.entries.length === 0 ? (
              <p className="mt-3 text-sm text-muted">No token calls in the last 24h from these channels.</p>
            ) : (
              <div className="mt-3 overflow-x-auto">
                <table className="w-full min-w-[720px] text-sm tabular-nums">
                  <thead>
                    <tr className="text-left text-xs text-muted">
                      <th className="pb-2 font-normal">Token</th>
                      <th className="pb-2 text-right font-normal">Channels</th>
                      <th className="pb-2 text-right font-normal">First call</th>
                      <th className="pb-2 text-right font-normal">FDV at call</th>
                      <th className="pb-2 text-right font-normal">Now</th>
                      <th className="pb-2 text-right font-normal">Now vs call</th>
                      <th className="pb-2 text-right font-normal">Peak</th>
                    </tr>
                  </thead>
                  <tbody>
                    {state.entries.slice(0, 40).map((e) => {
                      const callers = Object.keys(e.callers);
                      const x = e.baseFdv && e.fdv ? e.fdv / e.baseFdv : null;
                      const px = e.baseFdv && e.peakFdv ? e.peakFdv / e.baseFdv : null;
                      return (
                        <tr key={e.mint} className="border-t border-line">
                          <td className="py-2 pr-2">
                            <a
                              href={`https://dexscreener.com/solana/${e.mint}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="font-semibold hover:text-narr"
                            >
                              {e.name}
                            </a>{" "}
                            <span className="text-muted">${e.symbol}</span>
                          </td>
                          <td className="py-2 text-right" title={callers.map((c) => `@${c}`).join(", ")}>
                            {callers.length}
                          </td>
                          <td className="py-2 text-right">{age(e.firstAt, now)} ago</td>
                          <td className="py-2 text-right" title={e.baseLate ? "Called before tracking started" : undefined}>
                            {e.baseLate ? <span className="text-muted">before tracking</span> : usd(e.baseFdv)}
                          </td>
                          <td className="py-2 text-right">{usd(e.fdv)}</td>
                          <td className={`py-2 text-right ${x != null && x >= 1 ? "text-flow" : "text-warn"}`}>{x != null ? mult(x) : "-"}</td>
                          <td className="py-2 text-right">{px != null ? mult(px) : "-"}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                <p className="mt-2 text-xs text-muted">
                  FDV at call is the first price we saw after the call, refreshed every minute, so very fast moves can be missed.
                </p>
              </div>
            )}
          </>
        ))}
    </section>
  );
}

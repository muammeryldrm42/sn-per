"use client";

import { useEffect, useRef, useState } from "react";
import type { Signal } from "./types";
import { NARRATIVE_ENABLED } from "./flags";

const ALERT_KEY = "tns.alerts.v1";

type Kind = "rising" | "strong" | "graduated" | "smart" | "call";

function beep(kind: Kind) {
  try {
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new Ctx();
    const notes = kind === "call" ? [660, 880, 1100, 1320] : kind === "strong" ? [660, 880, 1100] : kind === "smart" ? [880, 660, 880] : kind === "graduated" ? [520, 780] : [700, 950];
    notes.forEach((f, i) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = "sine";
      o.frequency.value = f;
      const t = ctx.currentTime + i * 0.13;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.25, t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.12);
      o.connect(g).connect(ctx.destination);
      o.start(t);
      o.stop(t + 0.13);
    });
    setTimeout(() => ctx.close(), 800);
  } catch {
    /* audio blocked */
  }
}

const label: Record<Kind, string> = { rising: "Rising", strong: "Strong", graduated: "Graduated", smart: "Smart money", call: "New call" };

export function useAlerts(signals: Signal[]) {
  const [enabled, setEnabled] = useState(false);
  const [permission, setPermission] = useState<NotificationPermission | "unsupported">("default");
  const fired = useRef(new Set<string>());
  const primed = useRef(false);

  useEffect(() => {
    try {
      setEnabled(localStorage.getItem(ALERT_KEY) === "1");
    } catch {
      /* ignore */
    }
    setPermission(typeof Notification === "undefined" ? "unsupported" : Notification.permission);
  }, []);

  const toggle = async () => {
    const next = !enabled;
    if (next && typeof Notification !== "undefined" && Notification.permission === "default") {
      setPermission(await Notification.requestPermission());
    }
    if (next) beep("rising"); // user gesture unlocks audio
    setEnabled(next);
    try {
      localStorage.setItem(ALERT_KEY, next ? "1" : "0");
    } catch {
      /* ignore */
    }
  };

  useEffect(() => {
    // First pass only records current state, so a page reload does not replay old alerts.
    const events: { s: Signal; kind: Kind }[] = [];
    for (const s of signals) {
      // On-chain mode alerts only on calls: few, and only the ones that cleared every check.
      for (const kind of (NARRATIVE_ENABLED ? ["strong", "smart", "rising", "graduated"] : ["call"]) as Kind[]) {
        const on =
          kind === "call"
            ? !!s.calledAt
            : kind === "strong"
            ? s.strong
            : kind === "smart"
              ? (s.smartBuyers?.length ?? 0) >= 2 && !s.junk
              : kind === "rising"
                ? s.rising
                : s.graduated;
        const key = `${s.mint}:${kind}`;
        if (on && !fired.current.has(key)) {
          fired.current.add(key);
          if (primed.current) events.push({ s, kind });
        }
      }
    }
    primed.current = true;
    if (!enabled || !events.length) return;

    const top = events.sort((a, b) => (a.kind === "strong" ? -1 : 1) - (b.kind === "strong" ? -1 : 1))[0];
    beep(top.kind);
    if (typeof Notification !== "undefined" && Notification.permission === "granted") {
      for (const { s, kind } of events.slice(0, 3)) {
        try {
          const n = new Notification(`${label[kind]}: ${s.name} ($${s.symbol})`, {
            body: s.calledAt ? s.callWhy ?? `${s.matchedDisplay}: ${s.matchContext}` : `Narrative "${s.matchedDisplay}", score ${s.score}`,
            icon: s.image,
            tag: `${s.mint}:${kind}`,
          });
          n.onclick = () => {
            window.focus();
            window.open(`https://dexscreener.com/solana/${s.mint}`, "_blank", "noopener");
          };
        } catch {
          /* notifications blocked */
        }
      }
    }
  }, [signals, enabled]);

  return { enabled, toggle, permission };
}

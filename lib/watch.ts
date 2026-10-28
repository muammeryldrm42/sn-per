"use client";

// Per-viewer watchlist of starred tokens. Lives in this browser only (a convenience, not shared state).
import { useEffect, useState } from "react";

const KEY = "tns.star.v1";
const EVENT = "tns-star";
let mem: string[] | null = null; // used when the browser refuses to store

function read(): string[] {
  if (mem) return mem;
  try {
    const v = JSON.parse(localStorage.getItem(KEY) || "[]");
    return Array.isArray(v) ? v.filter((x) => typeof x === "string") : [];
  } catch {
    return [];
  }
}

export function useStars() {
  const [stars, setStars] = useState<string[]>([]);
  useEffect(() => {
    setStars(read());
    const on = () => setStars(read());
    window.addEventListener(EVENT, on);
    window.addEventListener("storage", on);
    return () => {
      window.removeEventListener(EVENT, on);
      window.removeEventListener("storage", on);
    };
  }, []);
  const toggle = (mint: string) => {
    const cur = read();
    const next = cur.includes(mint) ? cur.filter((m) => m !== mint) : [mint, ...cur].slice(0, 300);
    try {
      localStorage.setItem(KEY, JSON.stringify(next));
    } catch {
      mem = next; // storage blocked: keep it for this page view
    }
    setStars(next);
    window.dispatchEvent(new Event(EVENT));
  };
  return { stars, has: (m: string) => stars.includes(m), toggle };
}

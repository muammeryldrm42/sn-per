"use client";

import { NARRATIVE_ENABLED } from "@/lib/flags";
import { LegacyHome } from "@/components/LegacyHome";
import { CallsApp } from "@/components/CallsApp";

// The call terminal. The old narrative page only comes back with NEXT_PUBLIC_NARRATIVE=1.
export default function Page() {
  return NARRATIVE_ENABLED ? <LegacyHome /> : <CallsApp />;
}

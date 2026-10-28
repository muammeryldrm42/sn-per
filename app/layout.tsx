import type { Metadata, Viewport } from "next";
import { Anton, Inter, Inter_Tight, JetBrains_Mono } from "next/font/google";
import "./globals.css";

const big = Anton({ subsets: ["latin"], variable: "--font-big", weight: ["400"] });
const display = Inter_Tight({ subsets: ["latin"], variable: "--font-display", weight: ["600", "700", "800"] });
const body = Inter({ subsets: ["latin"], variable: "--font-body", weight: ["400", "500", "600"] });
const mono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-mono", weight: ["400", "500", "700"] });

export const metadata: Metadata = {
  title: "Talons Calls",
  description: "Free Solana memecoin calls. Every launch watched on-chain, only the ones that clear every check get called, every call tracked forever.",
};

export const viewport: Viewport = {
  themeColor: "#08090c",
  colorScheme: "dark",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${big.variable} ${display.variable} ${body.variable} ${mono.variable}`}>
      <body className="min-h-screen">{children}</body>
    </html>
  );
}

import type { Metadata } from "next";
import { Geist, Geist_Mono, Fraunces, Fredoka } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

// Premium editorial serif for display headings. `weight: "variable"` loads
// the single variable-font file (continuous 100-900 range) instead of 4
// weights x 2 styles = 8 separate static font files — the discrete-array
// form is what triggers a known Turbopack bug ("next/font/google queries
// have exactly one entry") on `next build`, confirmed failing twice in a
// row on the production build server even though it happened to succeed
// locally (a stale per-machine font-fetch cache was almost certainly
// masking it here). Every weight this app actually uses (400-700) still
// renders correctly — a variable font isn't limited to preset weights.
const fraunces = Fraunces({
  variable: "--font-display",
  subsets: ["latin"],
  weight: "variable",
  style: ["normal", "italic"],
});

// Rounded geometric sans for the Broadway wordmark — same fix.
const fredoka = Fredoka({
  variable: "--font-logo",
  subsets: ["latin"],
  weight: "variable",
});

export const metadata: Metadata = {
  title: "Broadway Home Schooling — Admissions",
  description:
    "Broadway Home Schooling admissions — applications, assessments, payments and enrollment.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} ${fraunces.variable} ${fredoka.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}

import type { Metadata, Viewport } from "next";
import { Press_Start_2P, VT323 } from "next/font/google";
import "./globals.css";
import { Providers } from "./providers";

// Пиксельные шрифты: заголовки — Press Start 2P, тело/цифры — VT323 (читаемый пиксель-моно).
const pixel = Press_Start_2P({
  weight: "400",
  subsets: ["latin"],
  variable: "--font-pixel",
  display: "swap",
});
const mono = VT323({
  weight: "400",
  subsets: ["latin"],
  variable: "--font-mono",
  display: "swap",
});

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";
const TITLE = "THE VAULTLER — wind it, it stacks while you sleep";
const DESC =
  "A daily stacking game on Robinhood Chain. Crank once a day, keep your streak, climb the weekly board. No deposits, no custody — we never hold your funds.";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: { default: TITLE, template: "%s · The Vaultler" },
  description: DESC,
  applicationName: "The Vaultler",
  keywords: ["Vaultler", "VLTR", "Robinhood Chain", "stacking game", "meme token"],
  openGraph: {
    type: "website",
    url: SITE_URL,
    siteName: "The Vaultler",
    title: TITLE,
    description: DESC,
  },
  twitter: {
    card: "summary_large_image",
    site: "@VaultlerRH",
    creator: "@VaultlerRH",
    title: TITLE,
    description: DESC,
  },
  robots: { index: true, follow: true },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // Зум НЕ блокируем: user-scalable=no — нарушение доступности (WCAG 1.4.4).
  themeColor: "#0f0a06",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${pixel.variable} ${mono.variable}`}>
      <body>
        <a className="skip-link" href="#main">
          Skip to content
        </a>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}

"use client";

import { useSession } from "./useSession";
import ConnectButton from "./ConnectButton";
import { LINKS } from "@/lib/links";

export default function SiteHeader() {
  const { wallet, refresh } = useSession();

  return (
    <header className="site-header">
      <div className="shell header-inner">
        <a className="brand" href="#top">
          <span className="brand-mark" aria-hidden="true">
            V
          </span>
          <span className="brand-name">VAULTLER</span>
        </a>

        <nav className="site-nav" aria-label="main">
          <a href="#game">Game</a>
          <a href="#how">How it works</a>
          <a href="#token">$VLTR</a>
          <a href="#board">Leaderboard</a>
        </nav>

        <div className="header-actions">
          <div className="header-socials">
            {LINKS.map((l) =>
              l.href ? (
                <a
                  key={l.key}
                  className="btn btn-ghost sm"
                  href={l.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  title={l.label}
                >
                  {l.key === "x" ? "𝕏" : l.key === "tg" ? "TG" : "DEX"}
                </a>
              ) : (
                <button
                  key={l.key}
                  className="btn btn-ghost sm is-stub"
                  disabled
                  title={`${l.label} — soon`}
                >
                  {l.key === "tg" ? "TG" : "DEX"}
                </button>
              ),
            )}
          </div>
          <ConnectButton wallet={wallet} onChanged={refresh} />
        </div>
      </div>
    </header>
  );
}

"use client";

import { useEffect, useState } from "react";
import { useSession } from "./useSession";
import ConnectButton from "./ConnectButton";
import { LINKS } from "@/lib/links";

const NAV = [
  { href: "#game", label: "Game" },
  { href: "#how", label: "How it works" },
  { href: "#token", label: "$VLTR" },
  { href: "#board", label: "Leaderboard" },
  { href: "#roadmap", label: "Roadmap" },
  { href: "#faq", label: "FAQ" },
];

export default function SiteHeader() {
  const { wallet, refresh } = useSession();
  const [open, setOpen] = useState(false);

  // Esc закрывает меню; при открытом меню блокируем прокрутку фона.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [open]);

  return (
    <header className="site-header">
      <div className="shell header-inner">
        <a className="brand" href="#top" onClick={() => setOpen(false)}>
          <span className="brand-mark" aria-hidden="true">
            V
          </span>
          <span className="brand-name">VAULTLER</span>
        </a>

        <nav className="site-nav" aria-label="Main">
          {NAV.map((n) => (
            <a key={n.href} href={n.href}>
              {n.label}
            </a>
          ))}
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
                  aria-label={l.label}
                >
                  {l.key === "x" ? "𝕏" : l.key === "tg" ? "TG" : "DEX"}
                </a>
              ) : (
                <button
                  key={l.key}
                  className="btn btn-ghost sm is-stub"
                  disabled
                  aria-label={`${l.label} — coming soon`}
                >
                  {l.key === "tg" ? "TG" : "DEX"}
                </button>
              ),
            )}
          </div>

          <ConnectButton wallet={wallet} onChanged={refresh} />

          <button
            className="btn btn-ghost burger"
            aria-expanded={open}
            aria-controls="mobile-nav"
            aria-label={open ? "Close menu" : "Open menu"}
            onClick={() => setOpen((v) => !v)}
          >
            {open ? "✕" : "☰"}
          </button>
        </div>
      </div>

      {open && (
        <div className="mobile-nav" id="mobile-nav">
          {NAV.map((n) => (
            <a key={n.href} href={n.href} onClick={() => setOpen(false)}>
              {n.label}
            </a>
          ))}
          <div className="mobile-nav-socials">
            {LINKS.map((l) =>
              l.href ? (
                <a
                  key={l.key}
                  className="btn btn-wood"
                  href={l.href}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {l.label}
                </a>
              ) : (
                <button key={l.key} className="btn btn-wood is-stub" disabled>
                  {l.label}
                  <span className="stub-tag">soon</span>
                </button>
              ),
            )}
          </div>
        </div>
      )}
    </header>
  );
}

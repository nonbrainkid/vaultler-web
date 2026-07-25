import Socials from "./Socials";
import { BUY_URL } from "@/lib/links";

export default function Hero() {
  return (
    <section className="hero" id="top">
      <div className="shell hero-inner">
        <div className="hero-copy">
          <p className="eyebrow">DAILY STACKING GAME · ROBINHOOD CHAIN</p>
          <h1 className="hero-title">
            THE
            <br />
            VAULTLER
          </h1>
          <p className="hero-tag">Wind it. It stacks while you sleep.</p>
          <p className="hero-sub">
            Everyone else is over-trading and down bbad. You just wound the machine and
            let it cook. <b>Trading is cope. Stacking is based.</b>
          </p>

          <div className="hero-cta">
            <a className="btn btn-neon lg" href="#game">
              PLAY THE GAME
            </a>
            <a
              className="btn btn-gold lg"
              href={BUY_URL}
              target="_blank"
              rel="noopener noreferrer"
            >
              BUY $VLTR
            </a>
          </div>

          <Socials size="sm" />
        </div>

        <div className="hero-art" aria-hidden="true">
          <div className="vault-badge">
            <span className="vault-v">V</span>
          </div>
          <p className="hero-art-cap">RAID THE SAFES · SPLIT THE POT</p>
        </div>
      </div>
    </section>
  );
}

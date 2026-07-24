import Socials from "./Socials";

export default function SiteFooter() {
  return (
    <footer className="site-footer">
      <div className="shell">
        <div className="footer-top">
          <div>
            <div className="brand">
              <span className="brand-mark" aria-hidden="true">
                V
              </span>
              <span className="brand-name">VAULTLER</span>
            </div>
            <p className="footer-tag">Wind it. It stacks while you sleep.</p>
          </div>
          <Socials size="sm" />
        </div>

        <p className="disclaimer">
          $VLTR is a meme token with a game attached. Nothing here is financial advice or
          an offer to sell securities. <b>We do not custody user funds.</b> $STACK is an
          in-game score with no monetary value. The weekly prize is a game reward for top
          players, funded by trading fees, paid manually and not guaranteed. Crypto is
          risky — only bring what you can afford to lose.
        </p>

        <p className="footer-meta">
          SERVER-AUTHORITATIVE · NO CUSTODY · BUILT ON ROBINHOOD CHAIN
        </p>
      </div>
    </footer>
  );
}

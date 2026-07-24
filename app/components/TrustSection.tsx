const TRUST = [
  {
    h: "YOUR WALLET STAYS YOURS",
    d: "Connecting does two things: we read your public $VLTR balance, and you sign a plain text message to prove the wallet is yours. That signature costs no gas and moves nothing. We never ask for token approvals, never request a transaction, and cannot touch your funds.",
  },
  {
    h: "WE HOLD NOTHING",
    d: "There is no deposit, no staking contract, no vault holding your money. A real custody vault needs a serious audit, and we are not going to babysit your funds in unaudited code. The prize pool comes from trading fees and is paid out manually each week — not from other people's deposits.",
  },
  {
    h: "THE BOARD IS CHEAT-RESISTANT",
    d: "Your stack, streak and timers are computed and stored on our server — not in your browser. Editing values in DevTools does nothing. This protects the weekly pot from being drained by whoever opens the console first.",
  },
];

const STATUS = [
  { s: "live", t: "The game", d: "Playable right now, no wallet required." },
  { s: "live", t: "Server-side scoring", d: "Stacks, streaks and anti-cheat are running." },
  { s: "live", t: "Weekly leaderboard", d: "Live ranking and community vault." },
  { s: "wip", t: "$VLTR token", d: "Not launched yet. Fair launch via launchpad." },
  { s: "wip", t: "On-chain boost", d: "Wired up, switches on when the token exists." },
  { s: "todo", t: "Contract audit", d: "Not audited. No contract holds funds today." },
];

export default function TrustSection() {
  return (
    <section className="section" id="trust">
      <div className="shell">
        <h2 className="section-title">WHY YOU CAN TRUST THIS</h2>
        <p className="section-lead">
          Crypto is full of things that quietly take your money. Here is exactly what this
          does and does not do — in plain words.
        </p>

        <div className="cards-3">
          {TRUST.map((t) => (
            <article className="card" key={t.h}>
              <h3 className="card-h neon">{t.h}</h3>
              <p>{t.d}</p>
            </article>
          ))}
        </div>

        <div className="card status-card">
          <h3 className="card-h">HONEST STATUS — WHAT IS AND ISN&apos;T DONE</h3>
          <ul className="status-list">
            {STATUS.map((s) => (
              <li key={s.t} className={"status-item " + s.s}>
                <span className="status-dot" aria-hidden="true" />
                <span className="status-flag">
                  {s.s === "live" ? "LIVE" : s.s === "wip" ? "SOON" : "NOT YET"}
                </span>
                <span className="status-t">{s.t}</span>
                <span className="status-d">{s.d}</span>
              </li>
            ))}
          </ul>
          <p className="fly-note">
            If something here ever stops being true, it is a bug — tell us on X.
          </p>
        </div>
      </div>
    </section>
  );
}

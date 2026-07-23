const QA = [
  {
    q: "Do I need to buy anything to play?",
    a: "No. The game is free and works without a wallet. Holding $VLTR only multiplies your stacking rate by 1.5 — it is an advantage, not an entry ticket.",
  },
  {
    q: "What can you do with my wallet once I connect?",
    a: "Read your public balance and check a signature. That is the whole surface. We never request token approvals or transactions, so there is no mechanism for us to move your assets. You can disconnect at any time.",
  },
  {
    q: "Is $STACK worth money?",
    a: "No. $STACK is an in-game score with no monetary value and it is not a token. It decides your position on the weekly leaderboard, nothing else.",
  },
  {
    q: "So where do real rewards come from?",
    a: "Creator fees — 0.5% of trading volume on the token. Those fees fund the weekly pot that the top of the leaderboard splits. No fees, no pot: rewards scale with real activity and are never guaranteed.",
  },
  {
    q: "Is the code audited?",
    a: "No, and we will not pretend otherwise. That is exactly why nothing in this project holds your funds. If the token earns enough to pay for a proper audit, we can consider building more on-chain — not before.",
  },
  {
    q: "What happens if I miss my window?",
    a: "The machine stalls, a raider skims a share of your stack, and your streak resets. That is the whole tension of the game — showing up is the skill.",
  },
  {
    q: "How do you stop people from faking their score?",
    a: "Every stack, streak and timer is computed on the server against the server clock. The browser only draws what the server says. Cranking early, editing local values or spamming the endpoint does not work.",
  },
  {
    q: "When is the token launching?",
    a: "Not announced yet. It will be a fair launch through a launchpad: no presale, no team allocation, no treasury, liquidity locked automatically. Announcements go out on X first — ignore any other source.",
  },
];

export default function Faq() {
  return (
    <section className="section alt" id="faq">
      <div className="shell">
        <h2 className="section-title">FAQ</h2>
        <p className="section-lead">The questions you should be asking any crypto project.</p>

        <div className="faq">
          {QA.map((item) => (
            <details className="faq-item" key={item.q}>
              <summary>
                <span className="faq-q">{item.q}</span>
                <span className="faq-mark" aria-hidden="true" />
              </summary>
              <p className="faq-a">{item.a}</p>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}

const QA = [
  {
    q: "Do I need to buy anything to play?",
    a: "No. The game is free and works without a wallet. Holding $VLTR puts you on the boost ladder — five steps from ×1.5 to ×5 stacking speed, depending on how big your share of the supply is. That speed is realistically what gets you into the paid top 10. But anyone can play, earn $STACK and unlock skins.",
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
    a: "Trading fees — 7% of volume on the token. Half of what we collect funds a weekly pool that the top 10 of the leaderboard split, paid manually each week in real tokens. No volume, no pool: rewards scale with real activity and are never guaranteed.",
  },
  {
    q: "So holding pays me a cut of fees — is that a dividend?",
    a: "No. The pool is a prize for the top 10 players on the weekly board, earned by playing — not a payout on your balance. Holding only changes how fast the machine stacks, and the speed is capped at ×5 no matter how much you hold. You still have to crank every day: two people with identical bags finish very differently depending on how they play, and a player with no tokens at all can outrank a holder who sleeps through the window. It is a game prize, not a share of profits.",
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

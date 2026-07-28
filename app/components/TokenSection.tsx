import ContractAddress from "./ContractAddress";

const FLYWHEEL = [
  "You play the game",
  "You want the top 10",
  "You buy & hold $VLTR",
  "A bigger share = a higher step",
  "You climb into the top 10",
  "Trades generate fees",
  "Half the fees pay the top 10",
];

export default function TokenSection() {
  return (
    <section className="section alt" id="token">
      <div className="shell">
        <h2 className="section-title">$VLTR</h2>
        <p className="section-lead">
          A meme with a reason to hold — not a dog coin, not a promise of returns.
        </p>

        <ContractAddress />

        <div className="cards-3">
          <article className="card">
            <h3 className="card-h neon">HOLD = A HIGHER STEP</h3>
            <p>
              Your $VLTR bag puts you on a <b>ladder</b>: five steps from <b>×1.5</b> to{" "}
              <b>×5</b>{" "}
              stacking speed, and each step asks for a bigger share of the total
              supply. Non-holders stack at ×1. That&apos;s the utility — no deposit, no
              lockup, no staking contract, the site just reads your balance on-chain. Speed
              is capped at ×5, so no bag is big enough to own the board outright.
            </p>
          </article>

          <article className="card">
            <h3 className="card-h neon">WEEKLY POOL FROM FEES</h3>
            <p>
              Trading generates <b>7%</b> fees on volume. <b>Half</b> of that funds a weekly
              pool, split by the <b>top 10</b> of the leaderboard in real tokens. No volume,
              no pool — rewards scale with real activity and are never guaranteed.
            </p>
          </article>

          <article className="card">
            <h3 className="card-h neon">FAIR LAUNCH</h3>
            <p>
              Launched via a fair-launch launchpad. <b>No team allocation, no presale, no
              treasury</b> — the whole supply went on the curve and LP is locked
              automatically. We buy like everyone else.
            </p>
          </article>
        </div>

        <div className="card flywheel">
          <h3 className="card-h">THE FLYWHEEL</h3>
          <ol className="fly-list">
            {FLYWHEEL.map((f, i) => (
              <li key={f}>
                <span className="fly-i">{i + 1}</span>
                {f}
              </li>
            ))}
          </ol>
          <p className="fly-note">
            Buying to stack faster feeds the same volume that funds the pool. Meme + game +
            mechanics as one loop — not three glued together.
          </p>
        </div>

        <div className="card warnbox">
          <h3 className="card-h warn">WHAT WE DO NOT DO</h3>
          <ul className="warn-list">
            <li>
              <b>We never hold your funds.</b> No deposits, no custody, no vault contract
              taking your money. Connect is read-only: we read your balance and verify a
              signature.
            </li>
            <li>
              <b>We never promise a fixed yield or APY.</b> $STACK is an in-game score with
              no monetary value. The pool depends entirely on trading volume.
            </li>
            <li>
              <b>The pool is a game prize, not a dividend.</b> It rewards the top 10 players
              on the weekly board — earned by playing, not by holding a balance.
            </li>
            <li>
              <b>No team dump.</b> Fair launch means no insider allocation to sell into you.
            </li>
          </ul>
        </div>
      </div>
    </section>
  );
}

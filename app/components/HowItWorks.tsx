import SkinShowcase from "./SkinShowcase";

const STEPS = [
  {
    n: "01",
    t: "CRANK IT",
    d: "Pull the lever once a day. The machine winds up and stacks $STACK for the next 24 hours while you do literally nothing.",
  },
  {
    n: "02",
    t: "KEEP THE STREAK",
    d: "Come back inside the window and crank again — your streak grows and so does your multiplier. Compounding, but as a game.",
  },
  {
    n: "03",
    t: "DON'T GET RAIDED",
    d: "Sleep through the window and the machine stalls. A raider rolls in, skims part of your stack, and your streak resets to zero.",
  },
  {
    n: "04",
    t: "CLIMB THE BOARD",
    d: "The top 10 of the weekly leaderboard split a pool funded by half of the token's trading fees, paid in real tokens. Hold $VLTR to climb the boost ladder — up to ×5 stacking speed — and get there.",
  },
];

const TIERS = ["TIN CAN", "SAFE", "VAULT", "FORT", "GOLD RESERVE"];

export default function HowItWorks() {
  return (
    <section className="section" id="how">
      <div className="shell">
        <h2 className="section-title">HOW IT WORKS</h2>
        <p className="section-lead">
          One button. One decision a day. The whole game is showing up.
        </p>

        <div className="steps">
          {STEPS.map((s) => (
            <article className="step card" key={s.n}>
              <span className="step-n">{s.n}</span>
              <h3 className="step-t">{s.t}</h3>
              <p className="step-d">{s.d}</p>
            </article>
          ))}
        </div>

        <SkinShowcase />

        <div className="tiers card">
          <h3 className="tiers-h">STACK MILESTONES — YOUR PERSONAL PROGRESS</h3>
          <div className="tier-track">
            {TIERS.map((t, i) => (
              <div className="tier-chip" key={t}>
                <span className="tier-i">{String(i + 1).padStart(2, "0")}</span>
                {t}
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

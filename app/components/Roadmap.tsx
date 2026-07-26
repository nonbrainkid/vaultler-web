/**
 * Публичный роадмап. Источник правды — docs/roadmap.md; здесь та же картина словами,
 * которые видит игрок.
 *
 * Два правила этой секции:
 *  1) НИКАКИХ ДАТ на том, что не в нашей власти. Обещанная и просроченная дата — это долг,
 *     за которым приходят в комментарии; репутационно она дороже самой фичи.
 *  2) Кривая выплат публикуется вместе с формулой, а не одними процентами: игрок должен
 *     уметь пересчитать свою долю сам, не веря нам на слово. Это то же требование, что и
 *     к остальной экономике проекта.
 */
import { PAYOUT_SHARES, payoutSharePct } from "@/lib/payout";

const LIVE = [
  { t: "The daily game", d: "Free, no wallet needed." },
  { t: "Server-side scoring", d: "Your stack lives on our server, not in your browser." },
  { t: "Weekly board", d: "Resets Saturday 00:00 New York, plus the community vault." },
  {
    t: "$VLTR trading",
    d: "Holder ladder ×1.5 to ×5, re-checked on every crank.",
  },
];

const NEXT = [
  {
    t: "Window reminders",
    d: "The whole game depends on you coming back inside a 12h window, and right now nothing tells you it opened. A Telegram bot will ping you when it opens and again before it closes.",
    top: true,
  },
  {
    t: "A payouts page",
    d: "Every week, every winner, every transaction, at a permanent link. Receipts, not promises.",
  },
  {
    t: "Board history",
    d: "Past weeks and past winners, so the game accumulates a story instead of resetting into a void.",
  },
  {
    t: "Shareable stack cards",
    d: "One button turns your stack, streak, rank and safe skin into an image worth posting.",
  },
];

const NEVER = [
  {
    t: "Custody, deposits, a staking contract",
    d: "Not now, not later.",
  },
  {
    t: "A promised yield",
    d: "$STACK is a game score with no monetary value.",
  },
  {
    t: "PvP raids",
    d: "The raider is the house. If players could rob each other, the game stops being about showing up.",
  },
];

export default function Roadmap() {
  const first = payoutSharePct(1);
  const last = payoutSharePct(PAYOUT_SHARES.length);

  return (
    <section className="section" id="roadmap">
      <div className="shell">
        <h2 className="section-title">WHERE THIS GOES</h2>
        <p className="section-lead">
          No dates on anything we don&apos;t fully control. Every roadmap item is a debt
          someone comes to collect.
        </p>

        <div className="cards-3 rm-two">
          <article className="card">
            <h3 className="card-h neon">⚙ LIVE NOW</h3>
            <ul className="status-list">
              {LIVE.map((r) => (
                <li className="status-item live" key={r.t}>
                  <span className="status-dot" aria-hidden="true" />
                  <span className="status-flag">LIVE</span>
                  <span className="status-t">{r.t}</span>
                  <span className="status-d">{r.d}</span>
                </li>
              ))}
            </ul>
          </article>

          <article className="card">
            <h3 className="card-h">🔜 NEXT UP</h3>
            <ul className="status-list">
              {NEXT.map((r) => (
                <li className="status-item wip" key={r.t}>
                  <span className="status-dot" aria-hidden="true" />
                  <span className="status-flag">{r.top ? "FIRST" : "NEXT"}</span>
                  <span className="status-t">
                    {r.t}
                    {r.top && <span className="rm-top">top priority</span>}
                  </span>
                  <span className="status-d">{r.d}</span>
                </li>
              ))}
            </ul>
          </article>
        </div>

        <div className="card rm-fees">
          <h3 className="card-h neon">💰 HOW THE FEES SPLIT</h3>
          <ul className="rules-list rm-split">
            <li>
              Half funds the <b>weekly pool</b> for the top 10 players.
            </li>
            <li>
              The other half goes to <b>buybacks</b>.
            </li>
            <li>
              <b>Nothing goes to the team.</b>
            </li>
          </ul>

          <h3 className="card-h rm-curve-h">🏆 THE PAYOUT CURVE IS SET</h3>
          <p>
            Rank 1 takes <b>{first}%</b> of the pool. Rank 10 takes <b>{last}%</b>. Even
            slide in between. Ten seats pay — and first place is worth fighting for.
          </p>

          {/* Полосы + формула: долю можно пересчитать в уме и не верить нам на слово. */}
          <ol className="rm-bars" aria-label="Pool share by rank">
            {PAYOUT_SHARES.map((weight, i) => {
              const rank = i + 1;
              const pct = payoutSharePct(rank);
              return (
                <li key={rank} className={"rm-bar" + (rank === 1 ? " lead" : "")}>
                  <span className="rm-rank">#{rank}</span>
                  <span className="rm-track" aria-hidden="true">
                    <span
                      className="rm-fill"
                      style={{ width: `${(weight / PAYOUT_SHARES[0]) * 100}%` }}
                    />
                  </span>
                  <span className="rm-pct">{pct}%</span>
                </li>
              );
            })}
          </ol>

          <p className="muted-note">
            The weight of rank N is <b>11 − N</b>, and the weights always add up to 55 — so
            your share is <b>(11 − N) / 55</b>. With fewer than ten players on the board the
            same rule renormalises to the seats that exist. No pool without trading volume:
            rewards scale with real activity and are never guaranteed.
          </p>
        </div>

        <div className="card rm-never">
          <h3 className="card-h">🚫 WHAT WE WILL NEVER BUILD</h3>
          <ul className="status-list">
            {NEVER.map((r) => (
              <li className="status-item todo" key={r.t}>
                <span className="status-dot" aria-hidden="true" />
                <span className="status-flag">NEVER</span>
                <span className="status-t">{r.t}</span>
                <span className="status-d">{r.d}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}

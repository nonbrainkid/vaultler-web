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
import { PAYOUT_SEATS, PAYOUT_SHARES, payoutSharePct } from "@/lib/payout";

const LIVE = [
  { t: "The daily game", d: "Free, no wallet needed." },
  { t: "Server-side scoring", d: "Your stack lives on our server, not in your browser." },
  { t: "Weekly board", d: "Resets Saturday 00:00 New York, plus the community vault." },
  { t: "$VLTR trading", d: "Holder ladder ×1.5 to ×5, re-checked on every crank." },
];

const NEXT = [
  {
    t: "Window reminders",
    d: "The whole game depends on you coming back inside a 12h window, and right now nothing tells you it opened. A Telegram bot will ping you when it opens and again before it closes.",
    first: true,
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

/**
 * Лестница верифицируемости (docs/roadmap.md, «Стратегические направления»): наружу
 * идут только C1–C3, переформулированные как обещание игроку, а не внутренний план.
 * C4 (merkle-распределитель выплат) и разбор «почему не делаем кастодию» сюда намеренно
 * не попадают — так решено в разделе «Публичная версия» того же документа.
 */
const PROOF = [
  {
    t: "Signed weekly results",
    d: "Every week's board gets signed with a key, and the public key lives right here on the site — anyone can check a result is genuinely ours and untouched.",
  },
  {
    t: "An independent timestamp",
    d: "The hash of each week's snapshot goes into a transaction on chain. Once it's there, not even we can rewrite who won after the fact.",
  },
  {
    t: "Open log, open math",
    d: "The crank log goes public, pseudonymous, next to the code that turns it into a board. Run it yourself and get our exact numbers back — don't take our word for it.",
  },
];

const NEVER = [
  { t: "Custody or deposits", d: "No staking contract. Not now, not later." },
  { t: "A promised yield", d: "$STACK is a game score with no monetary value." },
  {
    t: "PvP raids",
    d: "The raider is the house. If players could rob each other, the game stops being about showing up.",
  },
];

export default function Roadmap() {
  const first = payoutSharePct(1);
  const last = payoutSharePct(PAYOUT_SEATS);

  return (
    <section className="section" id="roadmap">
      <div className="shell">
        <h2 className="section-title">WHERE THIS GOES</h2>
        <p className="section-lead">
          No dates on anything we don&apos;t fully control. Every roadmap item is a debt
          someone comes to collect.
        </p>

        <div className="rm-cols">
          <article className="card rm-card is-live">
            <h3 className="card-h neon">LIVE NOW</h3>
            <ul className="rm-list">
              {LIVE.map((r) => (
                <li className="rm-item" key={r.t}>
                  <span className="rm-t">{r.t}</span>
                  <span className="rm-d">{r.d}</span>
                </li>
              ))}
            </ul>
          </article>

          <article className="card rm-card is-next">
            <h3 className="card-h gold">NEXT UP</h3>
            <ul className="rm-list">
              {NEXT.map((r) => (
                <li className={"rm-item" + (r.first ? " is-first" : "")} key={r.t}>
                  <span className="rm-t">
                    {r.t}
                    {r.first && <span className="rm-flag">top priority</span>}
                  </span>
                  <span className="rm-d">{r.d}</span>
                </li>
              ))}
            </ul>
          </article>
        </div>

        <div className="rm-cols">
          <article className="card rm-card">
            <h3 className="card-h neon">HOW THE FEES SPLIT</h3>
            {/* Проценты крупно: это первое, что ищут глазами, и «0% team» должно читаться
                мгновенно — оно же главное обещание секции. */}
            <ul className="rm-fees">
              <li>
                <b className="rm-num neon">50%</b>
                <span>
                  the <b>weekly pool</b> for the top 10 players
                </span>
              </li>
              <li>
                <b className="rm-num gold">50%</b>
                <span>
                  <b>buybacks</b>
                </span>
              </li>
              <li>
                <b className="rm-num zero">0%</b>
                <span>
                  to the <b>team</b> — team wallets play, but never appear on the board and
                  never take a payout
                </span>
              </li>
            </ul>
          </article>

          <article className="card rm-card">
            <h3 className="card-h gold">THE PAYOUT CURVE IS SET</h3>
            <p className="rm-lead">
              Rank 1 takes <b>{first}%</b> of the pool, rank 10 takes <b>{last}%</b>, even
              slide in between. Ten seats pay — and first place is worth fighting for.
            </p>

            <ol className="rm-bars" aria-label="Pool share by rank">
              {PAYOUT_SHARES.map((weight, i) => {
                const rank = i + 1;
                return (
                  <li key={rank} className={"rm-bar" + (rank === 1 ? " is-lead" : "")}>
                    <span className="rm-rank">{rank}</span>
                    <span className="rm-track" aria-hidden="true">
                      <span
                        className="rm-fill"
                        style={{ width: `${(weight / PAYOUT_SHARES[0]) * 100}%` }}
                      />
                    </span>
                    <span className="rm-pct">{payoutSharePct(rank)}%</span>
                  </li>
                );
              })}
            </ol>

            <p className="muted-note">
              The weight of rank N is <b>11 − N</b> and the weights always add up to 55, so
              your share is <b>(11 − N) / 55</b> — check it yourself. Fewer than ten players
              on the board and the same rule renormalises to the seats that exist. No volume,
              no pool: rewards scale with real activity and are never guaranteed.
            </p>
          </article>
        </div>

        <article className="card rm-card is-proof">
          <h3 className="card-h gold">PROOF, NOT PROMISES</h3>
          <p className="rm-lead">
            Everything above is a claim. A claim you cannot check is worth nothing, so
            here is how each week gets checked instead of trusted:
          </p>
          <ul className="rm-list">
            {PROOF.map((r) => (
              <li className="rm-item" key={r.t}>
                <span className="rm-t">{r.t}</span>
                <span className="rm-d">{r.d}</span>
              </li>
            ))}
          </ul>
        </article>

        <article className="card rm-card is-never">
          <h3 className="card-h">WHAT WE WILL NEVER BUILD</h3>
          <ul className="rm-never">
            {NEVER.map((r) => (
              <li className="rm-item" key={r.t}>
                <span className="rm-t">{r.t}</span>
                <span className="rm-d">{r.d}</span>
              </li>
            ))}
          </ul>
        </article>
      </div>
    </section>
  );
}

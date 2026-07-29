import type { Metadata } from "next";
import SiteHeader from "../components/SiteHeader";
import SiteFooter from "../components/SiteFooter";
import { getStore } from "@/lib/store";
import { toPayoutWeek, type PayoutWeek } from "@/lib/payout-history";
import { weekInfo } from "@/lib/week";

// Тот же режим, что у лендинга: статический HTML не может получить per-request CSP-nonce
// (proxy.ts). Плюс страница обязана показывать свежие хеши сразу после ручной выплаты.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const EXPLORER = (process.env.NEXT_PUBLIC_RH_EXPLORER || "").replace(/\/$/, "");

/** Сколько недель показываем. История растёт бессрочно — список сверху вниз, свежие первыми. */
const WEEKS_SHOWN = 12;

export const metadata: Metadata = {
  title: "Payouts — THE VAULTLER",
  description:
    "Every weekly pool, every winner, every transaction hash. The post scrolls away; this page does not.",
};

function fmtStack(n: number): string {
  return n.toLocaleString("en-US", { maximumFractionDigits: n < 100 ? 2 : 0 });
}

async function loadWeeks(): Promise<PayoutWeek[]> {
  const store = await getStore();
  const ids = await store.closedWeekIds(WEEKS_SHOWN);
  if (ids.length === 0) return [];

  // Ник и флаг приватности лежат в текущем стейте игрока, а не в записи недели, поэтому
  // строки джойнятся со снапшотом — см. lib/payout-history.ts, там же про то, почему
  // запись нельзя рендерить как есть.
  const snapshot = await store.snapshot();
  const states = new Map(snapshot.map((p) => [p.identity, p.state]));

  const weeks = await Promise.all(
    ids.map(async (id) => toPayoutWeek(id, await store.weekResults(id), states)),
  );
  return weeks;
}

export default async function PayoutsPage() {
  const weeks = await loadWeeks();
  const next = weekInfo(Date.now());

  return (
    <>
      <SiteHeader />
      <main id="main">
        <section className="section">
          <div className="shell">
            <h1 className="section-title">PAYOUTS</h1>
            <p className="section-lead">
              Every week, every winner, every hash. A post scrolls away — this page does not.
            </p>

            <div className="card pay-note">
              <p>
                The board resets every Saturday at 00:00 New York. The pool is half of what
                the token&apos;s trading fees actually produced that week, split by the top
                ten <b>connected wallets</b> on the board. Tokens are sent by hand, from
                outside the site — there is no contract holding anyone&apos;s money.
              </p>
              <p className="muted-note">
                No volume, no pool. Rewards scale with real activity and are never
                guaranteed.
              </p>
            </div>

            {weeks.length === 0 ? (
              <div className="card pay-empty">
                <h2 className="card-h gold">NOTHING PAID YET</h2>
                <p>
                  Week {next.weekId} is still running. When it closes, the standings and the
                  transaction hashes land here — including the weeks where the pool turns out
                  to be dust. We publish the small ones too; that is the whole point of
                  having a page instead of a promise.
                </p>
              </div>
            ) : (
              weeks.map((w) => (
                <article className="card pay-week" key={w.weekId}>
                  <h2 className="card-h gold">WEEK {w.weekId}</h2>
                  <p className="muted-note">
                    {w.paidSeats} {w.paidSeats === 1 ? "seat" : "seats"} in the money ·{" "}
                    {w.paidTxCount} of {w.paidSeats} confirmed on-chain
                  </p>

                  <div className="pay-scroll">
                    <table className="pay-table">
                      <thead>
                        <tr>
                          <th scope="col">#</th>
                          <th scope="col">Player</th>
                          <th scope="col">Weekly gain</th>
                          <th scope="col">Share</th>
                          <th scope="col">Transaction</th>
                        </tr>
                      </thead>
                      <tbody>
                        {w.rows.map((r, i) => (
                          <tr
                            key={`${w.weekId}-${i}`}
                            className={r.rank !== null ? "is-money" : ""}
                          >
                            <td>{r.rank ?? "—"}</td>
                            <td>
                              {r.address && EXPLORER ? (
                                <a
                                  className="addrlink"
                                  href={`${EXPLORER}/address/${r.address}`}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                >
                                  {r.label}
                                </a>
                              ) : (
                                r.label
                              )}
                              {!r.eligible && <span className="pay-tag">no wallet</span>}
                            </td>
                            <td>{fmtStack(r.gain)}</td>
                            <td>{r.rank !== null ? `${r.sharePct}%` : "—"}</td>
                            <td>
                              {r.payoutTx ? (
                                EXPLORER ? (
                                  <a
                                    className="addrlink"
                                    href={`${EXPLORER}/tx/${r.payoutTx}`}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                  >
                                    {r.payoutTx.slice(0, 10)}…
                                  </a>
                                ) : (
                                  <span className="mono">{r.payoutTx.slice(0, 10)}…</span>
                                )
                              ) : r.rank !== null ? (
                                <span className="muted-note">pending</span>
                              ) : (
                                "—"
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </article>
              ))
            )}
          </div>
        </section>
      </main>
      <SiteFooter />
    </>
  );
}

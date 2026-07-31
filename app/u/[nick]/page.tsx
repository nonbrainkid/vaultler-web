/**
 * Публичная страница игрока `/u/<ник>` — то, куда ведёт кнопка «share my card».
 *
 * Зачем страница, а не только картинка: картинку нельзя нажать. Пришедший по ссылке должен
 * попадать не в изображение, а на страницу, где рядом с чужим стриком стоит кнопка
 * «сыграть». Мета-теги здесь подхватывают карточку из соседнего `opengraph-image.tsx`
 * автоматически (файловая конвенция Next), поэтому вручную `openGraph.images` НЕ задаём —
 * заданное значение перекрыло бы сгенерированный URL, и превью отвалилось бы молча.
 *
 * Что отдаётся наружу и почему именно это — см. `lib/public-profile.ts`. Коротко: ровно те
 * поля, что борд уже публикует про игрока из топа, и ни адреса скрывшего кошелёк, ни
 * internal id, ни холдерского тира, ни таймеров.
 */
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { cache } from "react";
import SiteHeader from "../../components/SiteHeader";
import SiteFooter from "../../components/SiteFooter";
import SafeSprite from "../../components/SafeSprite";
import { profilePath } from "@/lib/public-profile";
import { loadPublicProfile } from "@/lib/public-profile-server";
import { weekInfo } from "@/lib/week";

// Тот же режим, что у лендинга и `/payouts`: статический HTML не получит per-request
// CSP-nonce (proxy.ts), а цифры игрока должны быть свежими на каждый запрос.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const EXPLORER = (process.env.NEXT_PUBLIC_RH_EXPLORER || "").replace(/\/$/, "");

/**
 * Один запрос в стор на весь рендер: `generateMetadata` и сама страница просят профиль
 * независимо, а `cache()` из React мемоизирует вызов на время запроса. Без него каждый
 * заход на страницу читал бы снапшот борда дважды.
 */
const load = cache(async (nick: string) => loadPublicProfile(nick, Date.now()));

function fmtStack(n: number): string {
  return n.toLocaleString("en-US", { maximumFractionDigits: n < 100 ? 2 : 0 });
}

function shortAddr(a: string): string {
  return a.slice(0, 6) + "…" + a.slice(-4);
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ nick: string }>;
}): Promise<Metadata> {
  const { nick } = await params;
  const p = await load(nick);
  if (!p) return { title: "Unknown stacker", robots: { index: false, follow: false } };

  // Хвастаться местом и стриком — можно, доходностью — нет (гардрейлы копирайтинга,
  // docs/frontend.md). Поэтому в описании только стрик и место.
  const place = p.rank === null ? "" : ` · rank #${p.rank} of ${p.players}`;
  const description = `${p.nick} keeps the machine running on The Vaultler — streak ${p.streak}${place}. Wind it once a day, keep the streak, climb the weekly board.`;

  return {
    // Бренд добавит шаблон layout-а («%s · The Vaultler») — дублировать нельзя.
    title: p.nick,
    description,
    // Ник уникален без регистра, поэтому `/u/EGOR` и `/u/egor` ведут на одну страницу.
    // Каноничным считаем написание, которое выбрал сам игрок.
    alternates: { canonical: profilePath(p.nick) },
    /**
     * Индексацию выключаем осознанно. Ник — opt-in для БОРДА и для шеринга ссылкой; в
     * «пробей человека в гугле» игрок не подписывался, а страница со стеком и стриком по
     * запросу его никнейма — именно это. Превью в чатах и таймлайнах от `noindex` не
     * страдает: Twitterbot/TelegramBot читают og-теги и на директиву для поисковиков не
     * смотрят. В `robots.txt` путь тоже НЕ закрыт — вот его краулеры превью как раз
     * уважают, и карточка перестала бы рисоваться совсем.
     */
    robots: { index: false, follow: true },
    openGraph: {
      type: "profile",
      title: `${p.nick} · The Vaultler`,
      description,
      url: profilePath(p.nick),
    },
    twitter: { card: "summary_large_image", title: `${p.nick} · The Vaultler`, description },
  };
}

export default async function PublicProfilePage({
  params,
}: {
  params: Promise<{ nick: string }>;
}) {
  const { nick } = await params;
  const p = await load(nick);
  // Ника нет, он мусорный, стёрт игроком или принадлежит боту — во всех случаях 404,
  // а не пустая страница: иначе любой перебор ников выглядел бы как список игроков.
  if (!p) notFound();

  const week = weekInfo(Date.now());
  const daysLeft = Math.max(1, Math.ceil(week.endsInMs / 86_400_000));

  return (
    <>
      <SiteHeader />
      <main id="main">
        <section className="section">
          <div className="shell">
            <p className="eyebrow">STACKER CARD · WEEK {week.weekId}</p>
            <h1 className="section-title">{p.nick}</h1>
            <p className="section-lead">
              {p.rank === null ? (
                <>Not on this week&apos;s board.</>
              ) : (
                <>
                  Rank <b>#{p.rank}</b> of {p.players} this week
                  {p.moneyRank !== null && (
                    <>
                      {" — "}
                      <b>
                        prize seat {p.moneyRank} of {p.payoutSeats}
                      </b>
                    </>
                  )}
                  . The board resets in {daysLeft} {daysLeft === 1 ? "day" : "days"}.
                </>
              )}
            </p>

            <div className="card prof-card">
              <div className="prof-head">
                <div className="prof-safe">
                  <SafeSprite level={p.skinLevel} />
                  <div className="skin-tag">
                    <b>{p.skinLabel}</b>
                    <span>{p.skinHint}</span>
                  </div>
                </div>

                <div className="prof-stats">
                  <div className="readouts">
                    <div className="ro">
                      <div className="lab">STACK / WEEK</div>
                      <div className="val">{fmtStack(p.weekStack)}</div>
                    </div>
                    <div className="ro streak">
                      <div className="lab">STREAK</div>
                      <div className="val">{p.streak}</div>
                    </div>
                    <div className="ro">
                      <div className="lab">ALL TIME</div>
                      <div className="val">{fmtStack(p.lifetimeStack)}</div>
                    </div>
                  </div>

                  {p.badges.length > 0 ? (
                    <ul className="streakbadges" aria-label="streak badges">
                      {p.badges.map((b) => (
                        <li key={b} className="sbadge earned">
                          {b}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="muted-note prof-nobadge">
                      No streak badges yet — the first one lands at three days in a row.
                    </p>
                  )}

                  {/* Адрес — только если игрок его не скрывал. Ссылкой, чтобы её можно
                      было проверить в эксплорере; на картинке адреса нет вовсе. */}
                  {p.address && (
                    <p className="prof-addr">
                      {EXPLORER ? (
                        <a
                          className="addrlink"
                          href={`${EXPLORER}/address/${p.address}`}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          {shortAddr(p.address)}
                        </a>
                      ) : (
                        <span className="mono">{shortAddr(p.address)}</span>
                      )}
                      <em>shown because this player chose to show it</em>
                    </p>
                  )}
                </div>
              </div>

              <p className="muted-note">
                $STACK is a score inside the game — it is not a token and has no price. The
                machine runs on our server, so nobody can edit these numbers in a browser.
                Nothing is deposited or held: playing needs one signature, no gas.
              </p>
            </div>

            <div className="prof-cta">
              <a className="btn btn-neon lg" href="/#game">
                START YOUR OWN MACHINE
              </a>
              <a className="btn btn-ghost lg" href="/#board">
                SEE THE WEEKLY BOARD
              </a>
            </div>
          </div>
        </section>
      </main>
      <SiteFooter />
    </>
  );
}

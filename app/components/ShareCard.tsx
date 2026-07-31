"use client";

/**
 * «Share my stack» — единственная кнопка, которой у игры до сих пор не было.
 *
 * Правило: ТУПИКА БЫТЬ НЕ ДОЛЖНО ни в одном состоянии. Отсюда три ветки:
 *
 * 1) ник есть → делимся личной карточкой `/u/<ник>`;
 * 2) кошелёк есть, ника нет → ник задаётся в карточке прямо выше (`ProfileEditor`), а
 *    кнопка пока делится самой игрой. Отключённая кнопка с текстом «сначала придумай ник»
 *    была бы честной, но бесполезной: поделиться-то есть чем и сейчас;
 * 3) кошелька нет → ник в принципе недоступен (его выдаёт только сессия с подтверждённым
 *    кошельком, иначе анонимы сквоттили бы ники), поэтому объясняем путь и опять делимся
 *    игрой.
 *
 * Никаких сторонних виджетов шеринга: в проде `script-src` — `'self' 'nonce-…'
 * 'strict-dynamic'`, чужой скрипт туда не влезет и не должен (docs/security.md). Работаем
 * штатными Web Share API и клипбордом, а если оба недоступны — просто показываем ссылку
 * текстом, чтобы её можно было выделить руками.
 */
import { useState } from "react";
import { profilePath, profileUrl } from "@/lib/public-profile";

type Done = null | "shared" | "copied" | "manual";

export default function ShareCard({
  nickname,
  wallet,
  streak,
  rank,
}: {
  nickname: string | null;
  wallet: string | null;
  /** Стрик и место идут только в ТЕКСТ сообщения. Картинку сервер рисует по своим данным. */
  streak: number;
  rank: number | null;
}) {
  const [done, setDone] = useState<Done>(null);
  const [url, setUrl] = useState("");

  const nick = nickname?.trim() || null;
  const path = nick ? profilePath(nick) : "/";

  // Хвастаемся стриком и местом, не деньгами (гардрейлы копирайтинга, docs/frontend.md).
  const text = nick
    ? `Streak ${streak}${rank !== null ? ` · rank #${rank}` : ""} on The Vaultler.` +
      " Wind it once a day and it stacks while you sleep."
    : "The Vaultler — wind it once a day and it stacks while you sleep.";

  async function share() {
    // origin читаем в момент клика, а не при рендере: страница серверная, на сервере
    // window нет, и предрассчитанное значение уехало бы в разметку пустым. Ссылку собираем
    // тем же `profileUrl`, что и мета-теги, — двух написаний одного адреса быть не должно.
    const origin = window.location.origin;
    const absolute = nick ? profileUrl(origin, nick) : origin + "/";
    setUrl(absolute);

    if (typeof navigator !== "undefined" && navigator.share) {
      try {
        await navigator.share({ title: "The Vaultler", text, url: absolute });
        setDone("shared");
        return;
      } catch (err) {
        // Отмена пользователем — это НЕ ошибка (тот же случай, что
        // UserRejectedRequestError у кошелька): молча возвращаем экран как был.
        if (err instanceof DOMException && err.name === "AbortError") return;
        // Остальное — не поддержали/запретили: падаем в клипборд ниже.
      }
    }

    try {
      await navigator.clipboard.writeText(absolute);
      setDone("copied");
      return;
    } catch {
      // Нет разрешения на клипборд или небезопасный контекст — показываем ссылку текстом.
      setDone("manual");
    }
  }

  return (
    <div className="card sharecard">
      <h3 className="card-h neon">SHARE YOUR STACK</h3>

      <button className="btn btn-gold wide" onClick={share}>
        {nick ? "SHARE MY CARD" : "SHARE THE MACHINE"}
      </button>

      {done === "copied" && <p className="share-ok">Link copied — paste it anywhere.</p>}
      {done === "shared" && <p className="share-ok">Sent.</p>}
      {done === "manual" && (
        <p className="share-manual">
          Copy it by hand: <span className="mono">{url}</span>
        </p>
      )}

      {nick ? (
        <>
          <p className="muted-note">
            Your card shows your board name, stack, streak and place — and never your wallet
            address. Clear your board name above and the page is gone.
          </p>
          <a className="share-view" href={path}>
            OPEN MY CARD ↗
          </a>
        </>
      ) : (
        <p className="muted-note">
          {wallet
            ? "Pick a board name above and this turns into your own card — your streak, your place, your skin."
            : "Connect a wallet and pick a board name to get your own card. One signature, no gas, no custody."}
        </p>
      )}
    </div>
  );
}

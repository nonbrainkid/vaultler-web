/**
 * Внешние ссылки проекта. Заглушки (`href: null`) рендерятся как неактивные кнопки
 * с пометкой «soon» — коллеге останется просто вписать URL.
 */
export interface SiteLink {
  key: string;
  label: string;
  href: string | null;
  note?: string;
}

/**
 * Username Telegram-бота напоминаний (без @). Значение по умолчанию — В КОДЕ, тем же
 * способом, что и адрес контракта $VLTR (`lib/chain.ts`, разбор — NOTES.md 2026-07-25):
 * это публичный факт, а не секрет, и опечатка в поле env-панели Vercel уехала бы в прод
 * молча, без ревью и диффа. В git значение проходит ревью и одинаково во всех окружениях.
 * Env-переопределение оставлено для тестового бота (dev/staging).
 *
 * КРИТИЧНО: и ссылка "наш бот" в `LINKS` ниже, и deep link привязки на кранк-экране
 * (`TelegramLink.tsx`) читают ОДНУ И ТУ ЖЕ константу. Если бы значения разошлись, сайт
 * рекламировал бы одного бота, пока привязка кода идёт к другому, — а подмена ссылки на
 * "официального" бота на странице мем-токена это ровно то, чем занимаются клоны-дрейнеры.
 */
const TELEGRAM_BOT_USERNAME_DEFAULT = "vaultler_bot";
export const TELEGRAM_BOT_USERNAME =
  process.env.NEXT_PUBLIC_TELEGRAM_BOT_USERNAME?.trim() || TELEGRAM_BOT_USERNAME_DEFAULT;

export const LINKS: SiteLink[] = [
  { key: "x", label: "X / TWITTER", href: "https://x.com/VaultlerRH" },
  // Канал комьюнити — не путать с личным ботом напоминаний ниже: игрок не должен искать
  // напоминания в канале и наоборот, у них разные назначения и разные t.me-адреса.
  { key: "tg", label: "TELEGRAM", href: "https://t.me/VaultlerRH" },
  {
    key: "tgbot",
    label: "REMINDER BOT",
    href: `https://t.me/${TELEGRAM_BOT_USERNAME}`,
  },
  // URL пары — как его дал владелец проекта, дословно. В пути DEXScreener стоит адрес
  // ПУЛА (0x1e8e…), а не контракта токена (0x4CAe…, см. lib/chain.ts) — это разные
  // сущности, и подставлять одну вместо другой нельзя.
  {
    key: "dex",
    label: "DEXSCREENER",
    href: "https://dexscreener.com/robinhood/0x1e8e3098bc37d2343f2c27871c29a785b554a920",
  },
];

/**
 * Куда ведёт кнопка BUY $VLTR — лончпад pons, на котором токен и запущен (2026-07-25).
 *
 * Отдельная константа, а не элемент `LINKS`: это главный CTA, а не иконка соцсети, и
 * рендерится он в других местах. Один источник на весь сайт — чтобы кнопка «купить»
 * не разъехалась между секциями.
 *
 * В пути лончпада стоит адрес КОНТРАКТА ТОКЕНА (`0x4CAe…7613`, тот же, что в
 * `lib/chain.ts`) — сверено с DEXScreener, где он подписан «VLTR», в отличие от адреса
 * пула `0x1E8E…a920`. Проверять это обязательно: ссылка «купить» на странице мем-токена —
 * первое, что подменяют, и цена ошибки здесь измеряется в чужих деньгах.
 */
export const BUY_URL =
  "https://www.ponsfamily.com/launchpad/0x4CAec139dfC936a2043FE3035B0d0D59ba877613";

export function linkByKey(key: string): SiteLink | undefined {
  return LINKS.find((l) => l.key === key);
}

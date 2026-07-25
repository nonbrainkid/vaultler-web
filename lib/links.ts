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

export const LINKS: SiteLink[] = [
  { key: "x", label: "X / TWITTER", href: "https://x.com/VaultlerRH" },
  { key: "tg", label: "TELEGRAM", href: "https://t.me/VaultlerRH" },
  // URL пары — как его дал владелец проекта, дословно. В пути DEXScreener стоит адрес
  // ПУЛА (0x1e8e…), а не контракта токена (0x4CAe…, см. lib/chain.ts) — это разные
  // сущности, и подставлять одну вместо другой нельзя.
  {
    key: "dex",
    label: "DEXSCREENER",
    href: "https://dexscreener.com/robinhood/0x1e8e3098bc37d2343f2c27871c29a785b554a920",
  },
];

export function linkByKey(key: string): SiteLink | undefined {
  return LINKS.find((l) => l.key === key);
}

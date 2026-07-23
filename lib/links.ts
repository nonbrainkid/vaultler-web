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
  { key: "tg", label: "TELEGRAM", href: null, note: "soon" },
  { key: "dex", label: "DEXSCREENER", href: null, note: "soon" },
];

export function linkByKey(key: string): SiteLink | undefined {
  return LINKS.find((l) => l.key === key);
}

/**
 * Скины сейфа по рангу в недельном борде — чистая логика, без рендера.
 *
 * `maxRank` — до какого места действует скин.
 * `unlockAt` — сколько должно быть игроков, чтобы скин вообще включился.
 *
 * Правило: «TOP N» имеет смысл только когда игроков БОЛЬШЕ N. Иначе в топ-N попадают
 * вообще все и награда обесценивается. Поэтому при 100 участниках работают только
 * топ-10 и топ-1, при 501 открывается топ-500 и так далее — потолок едет вверх вместе
 * с комьюнити, и прокачиваться всегда есть куда.
 */

export interface RankSkin {
  label: string;
  hint: string;
  maxRank: number;
  unlockAt: number;
}

export const RANK_SKINS: readonly RankSkin[] = [
  { label: "ROOKIE SAFE", hint: "unranked", maxRank: Infinity, unlockAt: 0 },
  { label: "TOP 1000", hint: "bronze plating", maxRank: 1000, unlockAt: 1000 },
  { label: "TOP 500", hint: "silver plating", maxRank: 500, unlockAt: 500 },
  { label: "TOP 100", hint: "gold cornice", maxRank: 100, unlockAt: 100 },
  { label: "TOP 10", hint: "crowned in gold", maxRank: 10, unlockAt: 10 },
  { label: "#1 VAULT", hint: "the crown itself", maxRank: 1, unlockAt: 1 },
] as const;

/** Открыт ли скин при текущем размере комьюнити. Базовый доступен всегда. */
export function isSkinUnlocked(level: number, players: number): boolean {
  if (level <= 0) return true;
  const s = RANK_SKINS[level];
  return s ? players > s.unlockAt : false;
}

/**
 * Ранг + размер комьюнити → уровень скина.
 * Берём самый высокий скин, которому игрок соответствует И который уже разблокирован.
 */
export function rankLevel(
  rank: number | null | undefined,
  players: number = 0,
): number {
  if (rank == null) return 0;
  for (let lv = RANK_SKINS.length - 1; lv >= 1; lv--) {
    if (rank <= RANK_SKINS[lv].maxRank && isSkinUnlocked(lv, players)) return lv;
  }
  return 0;
}

export interface SkinGoal {
  level: number;
  label: string;
  unlockAt: number;
  /** Открыт ли скин уже сейчас (иначе комьюнити должно подрасти). */
  unlocked: boolean;
}

/**
 * Следующая цель игрока.
 * Сначала ищем ближайшую ДОСТИЖИМУЮ ступень — самый низкий открытый скин выше текущего.
 * Если выше ничего не открыто, показываем ту, что откроется раньше всех (минимальный
 * unlockAt) — чтобы было видно, сколько ещё людей должно прийти.
 */
export function nextSkin(level: number, players: number = 0): SkinGoal | null {
  if (level >= RANK_SKINS.length - 1) return null;

  for (let lv = level + 1; lv < RANK_SKINS.length; lv++) {
    if (isSkinUnlocked(lv, players)) {
      const s = RANK_SKINS[lv];
      return { level: lv, label: s.label, unlockAt: s.unlockAt, unlocked: true };
    }
  }

  let best = level + 1;
  for (let lv = level + 1; lv < RANK_SKINS.length; lv++) {
    if (RANK_SKINS[lv].unlockAt < RANK_SKINS[best].unlockAt) best = lv;
  }
  const s = RANK_SKINS[best];
  return { level: best, label: s.label, unlockAt: s.unlockAt, unlocked: false };
}

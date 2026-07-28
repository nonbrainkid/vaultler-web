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

/**
 * Метки за стрик — вторая, независимая ось косметики (2026-07-28).
 *
 * Зачем нужна отдельно от `RANK_SKINS`: скины сейфа выше привязаны к МЕСТУ в недельном
 * борде — метрике относительной (новичку недостижимой) и ещё гейтящейся `unlockAt` по
 * размеру комьюнити. На проде это дало пустой результат: максимальный стрик за всё время
 * работы игры — 1, у лидера борда стрик вообще 0 (обчистил рейдер). Компаунд, вокруг
 * которого построена вся игра, ни разу не сработал ни у кого.
 *
 * Стрик — метрика АБСОЛЮТНАЯ и личная, поэтому здесь сознательно нет `unlockAt` и нет
 * параметра `players` ни у одной функции: гейтинг по размеру комьюнити применим только
 * там, где ранняя выдача обесценивает статус («топ-10» из всех при 10 игроках). У стрика
 * обесценивать нечего — дошёл человек до 7 дней или нет, не зависит от того, сколько ещё
 * игроков дошло. Достижимо с первого дня для кого угодно, включая игрока без токенов.
 */
export interface StreakBadge {
  /** Стрик, начиная с которого метка засчитана (включительно). */
  streak: number;
  label: string;
  hint: string;
  /**
   * Задел под Сезон 1 (см. docs/roadmap.md → «Стратегические направления», направление A,
   * и NOTES.md 2026-07-28). Смысл метки — вечная отметка раннего игрока: её нельзя купить
   * (только заработать стриком) и со временем перестанут выдавать новым — но кампания
   * Сезона 1 ещё не объявлена, поэтому сейчас это ТОЛЬКО косметический маркер: наград,
   * дедлайна выдачи или текста про сезон здесь намеренно нет.
   */
  founding?: boolean;
}

export const STREAK_BADGES: readonly StreakBadge[] = [
  { streak: 3, label: "STEADY HAND", hint: "three days, machine never went cold" },
  {
    streak: 7,
    label: "FOUNDING PROSPECTOR",
    hint: "a week on schedule — earned, not bought",
    founding: true,
  },
  { streak: 14, label: "IRON WILL", hint: "two weeks without a single raid" },
  { streak: 30, label: "LEGEND OF THE LINE", hint: "thirty days straight — name carved in the vault" },
] as const;

/** Все метки, которые игрок уже заслужил стриком, по возрастанию порога. */
export function earnedStreakBadges(streak: number): readonly StreakBadge[] {
  return STREAK_BADGES.filter((b) => streak >= b.streak);
}

/** Ближайшая метка впереди, либо null — уже все получены. В отличие от `nextSkin`
 *  тут нет запасного «откроется раньше всех»: порог фиксирован и от комьюнити не зависит. */
export function nextStreakBadge(streak: number): StreakBadge | null {
  return STREAK_BADGES.find((b) => streak < b.streak) ?? null;
}

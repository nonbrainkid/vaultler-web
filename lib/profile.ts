/** Валидация и нормализация ников для лидерборда. */

export const NICK_MIN = 3;
export const NICK_MAX = 16;

// Нельзя выдавать себя за системные ярлыки/официоз.
const RESERVED = new Set([
  "anon", "you", "bot", "test", "admin", "mod", "raider", "vaultler",
  "official", "team", "staff", "support", "null", "undefined", "system",
]);

export interface NickCheck {
  ok: boolean;
  value?: string; // очищенное значение для сохранения
  error?: string; // код ошибки для UI
}

/**
 * Проверить и очистить ник. Разрешены буквы/цифры/подчёркивание, 3–16 символов.
 * Регистр сохраняем для отображения, но уникальность — без регистра (см. store).
 */
export function validateNickname(raw: unknown): NickCheck {
  if (typeof raw !== "string") return { ok: false, error: "bad" };
  const value = raw.trim();
  if (value.length < NICK_MIN) return { ok: false, error: "too_short" };
  if (value.length > NICK_MAX) return { ok: false, error: "too_long" };
  if (!/^[a-zA-Z0-9_]+$/.test(value)) return { ok: false, error: "bad_chars" };
  // Ник не должен маскироваться под адрес кошелька (на борде рядом настоящие 0x…).
  if (/^0x/i.test(value)) return { ok: false, error: "reserved" };
  if (RESERVED.has(value.toLowerCase())) return { ok: false, error: "reserved" };
  return { ok: true, value };
}

/** Ключ уникальности: одинаковые ники в разном регистре считаются одним. */
export function nicknameKey(nickname: string): string {
  return nickname.toLowerCase();
}

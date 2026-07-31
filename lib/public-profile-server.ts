/**
 * Серверная загрузка публичного профиля: ник из URL → данные для `/u/[nick]` и для карточки.
 *
 * ПОЧЕМУ ОТДЕЛЬНЫЙ ФАЙЛ, а не функция в `lib/public-profile.ts`. Тот модуль импортирует
 * клиентская кнопка шеринга (ей нужен `profilePath`). Стоило добавить туда `getStore`, и в
 * клиентский бандл уехал `lib/store-file.ts` вместе с `node:fs` — Turbopack валит сборку
 * целиком, причём на главной странице, а не на профиле. Правила публичности при этом
 * остаются чистыми и тестируемыми там, где были; здесь только ввод-вывод.
 *
 * ИМПОРТИРОВАТЬ ЭТОТ ФАЙЛ МОЖНО ТОЛЬКО ИЗ СЕРВЕРНОГО КОДА (страница, route, генератор
 * картинки). Из файла с `"use client"` — никогда.
 */
import { buildLeaderboard } from "./leaderboard";
import { buildPublicProfile, parseNickParam, type PublicProfile } from "./public-profile";
import { getStore } from "./store";

/**
 * Порядок обращений к стору выбран так, чтобы 404 стоил дешево: сначала точечный поиск по
 * нику (в Postgres это уникальный индекс `nicknameKey`), и только для найденного игрока —
 * снапшот всего борда. Страницу перебирают краулеры, и неизвестный ник не должен обходиться
 * чтением всей таблицы игроков.
 *
 * Место берём из `buildLeaderboard`, а не считаем заново: там живут правила про кошельки
 * команды, ботов, нулевой прирост и призовые места. Своя копия этих правил однажды
 * разошлась бы с бордом — и карточка хвасталась бы местом, которого на борде нет.
 */
export async function loadPublicProfile(
  rawNick: unknown,
  now: number,
): Promise<PublicProfile | null> {
  const nick = parseNickParam(rawNick);
  if (nick === null) return null;

  const store = await getStore();
  const player = await store.playerByNickname(nick);
  if (player === null) return null;

  const board = buildLeaderboard(await store.snapshot(), now, player.identity);
  return buildPublicProfile(player, now, {
    rank: board.you?.rank ?? null,
    moneyRank: board.you?.moneyRank ?? null,
    players: board.players,
  });
}

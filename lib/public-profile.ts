/**
 * Публичный профиль игрока по нику — данные для страницы `/u/[nick]` и для карточки
 * шеринга (`app/u/[nick]/opengraph-image.tsx`).
 *
 * ЗАЧЕМ ЭТО ЕСТЬ. У игры нет виральности: игроку нечем похвастаться и нечем привести
 * друга. Ссылка на свою карточку — единственный носитель, который несёт наш бренд и домен
 * туда, где мы сами не постим (личные чаты, реплаи). Поэтому карточка обязана быть
 * картинкой, а картинка — жить по постоянному публичному адресу.
 *
 * ГЛАВНАЯ ОСТОРОЖНОСТЬ ЗДЕСЬ — ПРИВАТНОСТЬ, и правило выбрано одно, максимально простое:
 *
 *   публичный профиль показывает РОВНО те поля, которые борд уже публикует про игрока
 *   из топа (ник, недельный прирост, накопленный стек, стрик, место, адрес — и адрес
 *   только если игрок его не скрыл), плюс то, что из них выводится (скин по месту, метки
 *   за стрик).
 *
 * Отсюда сознательные вычеты, каждый — закрытая утечка:
 *
 * - **нет internal id** (`wallet:0x…`, `dev:uuid`) — инвариант 5, тот же, что и в
 *   `lib/leaderboard.ts` и `lib/payout-history.ts`. Тест следит, что он не просочился ни
 *   в одно поле;
 * - **нет адреса у скрывшего кошелёк** — инвариант 5. Ник при этом остаётся: игрок
 *   выбирал ник именно чтобы его называли ником, а не адресом;
 * - **нет множителя и холдерского тира**. Множитель — это функция от доли в эмиссии, то
 *   есть публикация размера бэга. Для игрока со скрытым адресом это утечка «сколько у него
 *   токенов» без возможности проверить, чьих. Борд множитель не показывает — и профиль не
 *   показывает;
 * - **нет фазы и таймеров** (`phaseEndsInMs`). «У этого игрока окно закрывается через
 *   20 минут» — готовая подводка для срочного сообщения со ссылкой не туда. Своё окно
 *   игрок видит на своём экране, чужое ему знать незачем.
 *
 * Ник — единственный вход в эту страницу и он opt-in: задать его может только сессия с
 * подтверждённым кошельком (`app/api/profile/route.ts`), а стереть — она же. Стёр ник →
 * публичной страницы больше нет, и это единственный нужный «выключатель».
 *
 * ЭТОТ МОДУЛЬ НЕ ОБРАЩАЕТСЯ К ХРАНИЛИЩУ и обращаться не должен: из него берёт `profilePath`
 * клиентская кнопка шеринга (`app/components/ShareCard.tsx`). Один `import { getStore }`
 * здесь протянул в клиентский бандл `lib/store-file.ts`, а с ним `node:fs`, — сборка падает
 * целиком («the chunking context does not support external modules»), и падает не на
 * профиле, а на главной странице. Загрузка живёт отдельно: `lib/public-profile-server.ts`.
 */
import { settle, type PlayerState } from "./game";
import { addressFromIdentity } from "./auth";
import { PAYOUT_SEATS } from "./payout";
import { validateNickname } from "./profile";
import { RANK_SKINS, earnedStreakBadges, rankLevel } from "./skins";
import type { PlayerSnapshot } from "./store";

export interface PublicProfile {
  /** Ник в том виде, в каком его сохранил игрок (регистр сохранён). */
  nick: string;
  /** Прирост стека за текущую неделю — то, по чему борд ранжирует. */
  weekStack: number;
  /** Накопленный за всё время стек: справочно, на место не влияет. */
  lifetimeStack: number;
  streak: number;
  /** Место в недельной гонке, либо null — игрока в борде нет (например, кошелёк команды). */
  rank: number | null;
  /** Место в призовой зоне (1…10) либо null — вне денег. НЕ равно `rank`, см. docs/api.md. */
  moneyRank: number | null;
  /** Размер комьюнити — от него зависит, какие скины вообще открыты (lib/skins.ts). */
  players: number;
  skinLevel: number;
  skinLabel: string;
  skinHint: string;
  /** Заслуженные метки за стрик — производная от `streak`, ничего нового не раскрывает. */
  badges: string[];
  /** Полный адрес для ссылки в эксплорер. null — игрок скрыл кошелёк или его нет вовсе. */
  address: string | null;
  /** Сколько мест в деньгах бывает — чтобы страница не хардкодила десятку. */
  payoutSeats: number;
}

/**
 * Ник из URL → каноничный ник, либо null (тогда страница отвечает 404).
 *
 * Проверяем ТЕМ ЖЕ `validateNickname`, которым проверяется сохранение ника. Иначе правила
 * разъехались бы: в URL пролезли бы значения, которые невозможно завести (`anon`, `0xdead`,
 * `../../etc`), и страница выглядела бы как существующая сущность, которой нет. Заодно это
 * отбивает мусор до обращения к хранилищу — краулер, перебирающий пути, не должен
 * оплачиваться запросом в базу.
 *
 * Требование «URL совпадает с ником посимвольно» (без trim) — не педантизм: иначе
 * `/u/egor%20` и `/u/egor` были бы двумя адресами одной страницы, и ссылки на одного
 * игрока перестали бы совпадать между собой.
 */
export function parseNickParam(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  if (raw !== raw.trim()) return null;
  const check = validateNickname(raw);
  return check.ok ? check.value! : null;
}

/**
 * Путь публичного профиля. Единственный источник для кнопки шеринга, canonical и мета-тегов:
 * разъехавшиеся ссылки на одной странице мем-токена — это заготовка для клона-фишера
 * (та же причина, по которой deep link бота собирается из одной константы, см. lib/links.ts).
 */
export function profilePath(nick: string): string {
  return `/u/${encodeURIComponent(nick)}`;
}

/** Абсолютная ссылка на профиль — то, что уходит в шеринг и в мета-теги. */
export function profileUrl(origin: string, nick: string): string {
  return origin.replace(/\/$/, "") + profilePath(nick);
}

/**
 * Стейт игрока → публичный профиль. Чистая функция: время и место в борде приходят
 * аргументами, ничего не читается из окружения.
 *
 * `null` означает «публичной страницы у этой записи нет»:
 * - **нет ника** — единственный вход на страницу; стёр ник → страницы нет;
 * - **бот** (`bot:`) — засеянные для тестов записи не должны выглядеть живыми игроками.
 *   Ников у них не бывает, но проверка стоит здесь, а не «в сидере», потому что цена
 *   ошибки — публичная страница фейкового игрока в игре, которая делит реальные токены.
 */
export function buildPublicProfile(
  player: PlayerSnapshot,
  now: number,
  ranking: { rank: number | null; moneyRank: number | null; players: number },
): PublicProfile | null {
  if (player.identity.startsWith("bot:")) return null;

  // settle на now — цифры должны быть живыми, как на борде: у зарейженного стек уже
  // урезан, у стакающего досчитан. Сохранённый stored-stack тут врал бы.
  const state: PlayerState = settle(player.state, now).state;

  const nick = state.nickname?.trim() || null;
  if (!nick) return null;

  const skinLevel = rankLevel(ranking.rank, ranking.players);
  const skin = RANK_SKINS[skinLevel];

  return {
    nick,
    // max(0, …) — как в борде: после рейда стек бывает ниже базы недели.
    weekStack: Math.max(0, state.stack - state.weekStartStack),
    lifetimeStack: state.stack,
    streak: state.streak,
    rank: ranking.rank,
    moneyRank: ranking.moneyRank,
    players: ranking.players,
    skinLevel,
    skinLabel: skin.label,
    skinHint: skin.hint,
    badges: earnedStreakBadges(state.streak).map((b) => b.label),
    // Скрыл кошелёк — адрес не уходит вообще (инвариант 5), ник остаётся.
    address: state.hideWallet ? null : addressFromIdentity(player.identity),
    payoutSeats: PAYOUT_SEATS,
  };
}

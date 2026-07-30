/**
 * Весь текст ролика — в одном файле.
 *
 * Дословно снят с лендинга (`app/components/*`) и `docs/roadmap.md`. Это не вкусовщина:
 * гардрейлы копирайтинга проекта (CLAUDE.md, инвариант 6) запрещают обещать APY,
 * намекать на депозиты и называть пул дивидендом. Пока ролик цитирует сайт, он не может
 * случайно пообещать больше сайта — а разошедшийся с сайтом промо-текст это ровно то,
 * за что проекту прилетает.
 *
 * Язык — английский, как и весь сайт: аудитория ролика та же, что у лендинга.
 */

export const SITE = "thevaultler.fun";
export const X_HANDLE = "@VaultlerRH";
export const TICKER = "$VLTR";
export const CHAIN = "ROBINHOOD CHAIN";

export const HERO = {
  eyebrow: "DAILY STACKING GAME · ROBINHOOD CHAIN",
  title: ["THE", "VAULTLER"],
  tag: "Wind it. It stacks while you sleep.",
};

export const VIBE = {
  lead: "Everyone else is over-trading and down bad.",
  punch: ["TRADING IS COPE.", "STACKING IS BASED."],
  sub: "You just wound the machine and let it cook.",
};

export const STEPS = [
  {
    n: "01",
    t: "CRANK IT",
    d: "Pull the lever once a day. The machine winds up and stacks $STACK for 24 hours while you do nothing.",
    accent: "neon" as const,
  },
  {
    n: "02",
    t: "KEEP THE STREAK",
    d: "Come back inside the 12-hour window and crank again. Your streak grows, and so does your multiplier.",
    accent: "gold" as const,
  },
  {
    n: "03",
    t: "DON'T GET RAIDED",
    d: "Sleep through the window and the machine stalls. A raider skims part of your stack, and your streak resets to zero.",
    accent: "rust" as const,
  },
  {
    n: "04",
    t: "CLIMB THE BOARD",
    d: "The top 10 of the weekly board split a pool funded by trading fees, paid in real tokens.",
    accent: "gold" as const,
  },
];

/** Лестница холдерского буста — значения из `lib/game.ts` (HOLDER_TIERS). */
export const TIERS = [
  { name: "DRIFTER", share: "no bag", mult: 1 },
  { name: "PROSPECTOR", share: "0.001%", mult: 1.5 },
  { name: "RANCHER", share: "0.005%", mult: 2 },
  { name: "OUTLAW", share: "0.02%", mult: 2.75 },
  { name: "BARON", share: "0.1%", mult: 3.75 },
  { name: "TYCOON", share: "0.5%", mult: 5 },
];

export const FEES = [
  { pct: 50, label: "WEEKLY POOL", note: "for the top 10 players", tone: "neon" as const },
  { pct: 50, label: "BUYBACKS", note: "straight back into the token", tone: "gold" as const },
  { pct: 0, label: "TEAM", note: "team wallets never take a payout", tone: "zero" as const },
];

/** Кривая выплат: доля(N) = (11 − N)/55, `lib/payout.ts`. */
export const PAYOUT = {
  formula: "(11 − N) / 55",
  first: 18.2,
  last: 1.8,
  note: "Ten seats pay. Check the math yourself.",
};

export const TRUST = [
  {
    h: "WE HOLD NOTHING",
    d: "No deposits. No custody. No staking contract. Connect is read-only — we read your balance and verify a signature.",
  },
  {
    h: "NO YIELD, NO APY",
    d: "$STACK is an in-game score with no monetary value. The pool depends entirely on trading volume.",
  },
  {
    h: "THE BOARD IS CHEAT-RESISTANT",
    d: "Stacks, streaks and timers are computed on the server. Editing values in DevTools does nothing.",
  },
  {
    h: "FAIR LAUNCH",
    d: "No team allocation, no presale, no treasury. The whole supply went on the curve, LP locked.",
  },
];

export const LIVE = [
  "The daily game — free, no wallet needed",
  "Server-side scoring and anti-cheat",
  "Weekly board + community vault",
  // Множитель здесь пишется через латинскую "x", а не "×": строка рендерится шрифтом
  // VT323, в котором нет глифа U+00D7, и браузер подставляет его из фолбэк-шрифта —
  // в кадре получается надстрочная закорючка вместо знака умножения.
  "$VLTR trading, holder ladder x1.5 to x5",
  "Telegram window reminders",
  "A public payouts page — every week, every hash",
];

export const NEXT = [
  "Board history — past weeks, past winners",
  "Shareable stack cards",
  "A phone-shaped game",
];

export const PROOF = {
  head: "PROOF, NOT PROMISES",
  items: [
    "Weekly results signed with a public key",
    "Each week's hash timestamped on chain",
    "Open crank log, open math — run it yourself",
  ],
};

export const NEVER = ["Custody or deposits", "A promised yield", "PvP raids"];

export const OUTRO = {
  title: ["THE", "VAULTLER"],
  tag: "Wind it. It stacks while you sleep.",
  cta: "PLAY FREE — NO WALLET NEEDED",
};

import { describe, it, expect } from "vitest";
import { buildLeaderboard, parseExcluded, weekInfo } from "./leaderboard";
import { initialState, type PlayerState } from "./game";
import type { PlayerSnapshot } from "./store";

const NOW = 1_760_000_000_000;

function off(stack: number): PlayerState {
  return { ...initialState(NOW), stack };
}

/**
 * Граница недели — суббота 00:00 по Нью-Йорку. Проверяем не «примерно раз в 7 суток»,
 * а что момент сброса действительно приходится на субботнюю полночь В ЗОНЕ, включая
 * недели с переходом на летнее время: игроки видят обратный отсчёт до раздачи призов,
 * и сдвиг на час — это чей-то не сделанный вовремя кранк.
 */
describe("weekInfo — граница недели", () => {
  const DAY = 24 * 3600 * 1000;
  /**
   * Как выглядит момент в Нью-Йорке — «Sat 00:00».
   * Собираем из частей, а не сравниваем отформатированную строку: разные версии ICU
   * ставят запятую после дня недели по-разному, и тест падал бы на форматировании,
   * а не на логике.
   */
  const inNY = (ts: number) => {
    const p: Record<string, string> = {};
    for (const part of new Intl.DateTimeFormat("en-US", {
      timeZone: "America/New_York",
      weekday: "short",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).formatToParts(new Date(ts))) {
      p[part.type] = part.value;
    }
    return `${p.weekday} ${p.hour}:${p.minute}`;
  };

  it("endsInMs в пределах недели и убывает со временем", () => {
    const a = weekInfo(NOW);
    expect(a.endsInMs).toBeGreaterThan(0);
    expect(a.endsInMs).toBeLessThanOrEqual(7 * DAY);
    const b = weekInfo(NOW + 3600_000);
    expect(b.endsInMs).toBeLessThan(a.endsInMs);
  });

  it("сброс всегда попадает на субботу 00:00 по Нью-Йорку", () => {
    // Проходим год с шагом в трое суток — попадаем и в летнее, и в зимнее время.
    for (let i = 0; i < 122; i++) {
      const ts = Date.UTC(2026, 0, 1) + i * 3 * DAY;
      expect(inNY(weekInfo(ts).endsAt)).toBe("Sat 00:00");
    }
  });

  /**
   * Регрессия на старую реализацию: якорь в UTC + остаток от деления на 7 суток.
   * В неделю перехода на летнее время такая сетка даёт 23:00 пятницы или 01:00 субботы.
   */
  it("переход на летнее время не сдвигает сброс (март 2026)", () => {
    // Часы переводят вперёд в воскресенье 8 марта 2026, 02:00 → «кривая» неделя это
    // суббота 7 марта … суббота 14 марта, в ней 167 часов.
    const insideDstWeek = Date.UTC(2026, 2, 10, 12); // вторник внутри этой недели
    expect(inNY(weekInfo(insideDstWeek).endsAt)).toBe("Sat 00:00");
    const week = weekInfo(insideDstWeek).endsAt - weekInfo(insideDstWeek - 7 * DAY).endsAt;
    expect(week).toBe(7 * DAY - 3600_000);
  });

  it("переход на зимнее время не сдвигает сброс (ноябрь 2026)", () => {
    // Часы переводят назад в воскресенье 1 ноября 2026 → неделя суббота 31 октября …
    // суббота 7 ноября длиннее обычной на час (169 часов).
    const insideDstWeek = Date.UTC(2026, 10, 3, 12); // вторник внутри этой недели
    expect(inNY(weekInfo(insideDstWeek).endsAt)).toBe("Sat 00:00");
    const week = weekInfo(insideDstWeek).endsAt - weekInfo(insideDstWeek - 7 * DAY).endsAt;
    expect(week).toBe(7 * DAY + 3600_000);
  });

  it("номер недели растёт ровно на 1 через границу", () => {
    const ts = Date.UTC(2026, 6, 25, 12);
    const w = weekInfo(ts);
    const next = weekInfo(w.endsAt + 60_000);
    expect(next.weekId).toBe(w.weekId + 1);
    // и не меняется в пределах одной недели
    expect(weekInfo(ts + 3 * DAY).weekId).toBe(w.weekId);
  });

  it("в субботу сразу после полуночи неделя уже новая, а не заканчивается", () => {
    const justAfterReset = weekInfo(Date.UTC(2026, 6, 25, 12)).endsAt + 1000;
    const w = weekInfo(justAfterReset);
    // до следующего сброса почти полные 7 суток
    expect(w.endsInMs).toBeGreaterThan(6.9 * DAY);
  });
});

/**
 * Кошельки команды не должны попадать в борд: на сайте написано «nothing goes to the
 * team», а выплаты делаются руками по этому же борду — значит «нет в борде» и означает
 * «не получает». Проверяем, что игрок вырезается из РАСЧЁТА, а не прячется в вёрстке.
 */
describe("исключение кошельков команды", () => {
  const DEV = "wallet:0x5a443ffafe4c2a7d16f242eebcbabb1f46ca7baa";
  const snap: PlayerSnapshot[] = [
    { identity: DEV, state: off(9999) },
    { identity: "wallet:0xabc0000000000000000000000000000000000001", state: off(100) },
    { identity: "dev:someone", state: off(50) },
  ];
  const withEnv = (value: string | undefined, fn: () => void) => {
    const prev = process.env.BOARD_EXCLUDE;
    if (value === undefined) delete process.env.BOARD_EXCLUDE;
    else process.env.BOARD_EXCLUDE = value;
    try {
      fn();
    } finally {
      if (prev === undefined) delete process.env.BOARD_EXCLUDE;
      else process.env.BOARD_EXCLUDE = prev;
    }
  };

  it("исключённый кошелёк не занимает место, и топ смыкается", () => {
    withEnv("0x5a443ffafe4c2a7d16f242eebcbabb1f46ca7baa", () => {
      const lb = buildLeaderboard(snap, NOW, "dev:someone");
      expect(lb.top.map((r) => r.stack)).toEqual([100, 50]);
      expect(lb.top[0].rank).toBe(1); // первое место достаётся живому игроку
      expect(lb.top.some((r) => r.address === "0x5a443ffafe4c2a7d16f242eebcbabb1f46ca7baa")).toBe(
        false,
      );
    });
  });

  it("не считается ни в числе игроков, ни в общем сейфе", () => {
    withEnv("0x5a443ffafe4c2a7d16f242eebcbabb1f46ca7baa", () => {
      const lb = buildLeaderboard(snap, NOW, "dev:someone");
      expect(lb.players).toBe(2);
      expect(lb.communalVault).toBe(150); // 9999 команды не подмешался
    });
  });

  it("сам исключённый игрок не видит у себя ранга (но играть ему ничто не мешает)", () => {
    withEnv("0x5a443ffafe4c2a7d16f242eebcbabb1f46ca7baa", () => {
      expect(buildLeaderboard(snap, NOW, DEV).you).toBeNull();
    });
  });

  it("регистр адреса не важен", () => {
    withEnv("0x5A443FFAFE4C2A7D16F242EEBCBABB1F46CA7BAA", () => {
      expect(buildLeaderboard(snap, NOW, "dev:someone").players).toBe(2);
    });
  });

  it("без переменной борд не меняется", () => {
    withEnv(undefined, () => {
      expect(buildLeaderboard(snap, NOW, "dev:someone").players).toBe(3);
    });
  });

  /** Опечатка в env не должна ни ронять борд, ни выкидывать случайного игрока. */
  it("мусор в списке игнорируется, валидные адреса продолжают работать", () => {
    withEnv("не адрес, 0x123, , 0x5a443ffafe4c2a7d16f242eebcbabb1f46ca7baa", () => {
      const lb = buildLeaderboard(snap, NOW, "dev:someone");
      expect(lb.players).toBe(2);
    });
    expect(parseExcluded("0xZZZ, 0x1")).toEqual(new Set());
    expect(parseExcluded(undefined)).toEqual(new Set());
  });

  it("разделители — запятая, пробел, точка с запятой", () => {
    const a = "0x5a443ffafe4c2a7d16f242eebcbabb1f46ca7baa";
    const b = "0xabc0000000000000000000000000000000000001";
    expect(parseExcluded(`${a},${b}`).size).toBe(2);
    expect(parseExcluded(`${a} ${b}`).size).toBe(2);
    expect(parseExcluded(`${a}; ${b}`).size).toBe(2);
  });
});

describe("buildLeaderboard", () => {
  const snap: PlayerSnapshot[] = [
    { identity: "wallet:0xabc0000000000000000000000000000000000001", state: off(100) },
    { identity: "dev:whale", state: off(200) },
    { identity: "dev:me", state: off(50) },
  ];

  it("ранжирует по стеку по убыванию", () => {
    const lb = buildLeaderboard(snap, NOW, "dev:me");
    expect(lb.top.map((r) => r.stack)).toEqual([200, 100, 50]);
    expect(lb.top[0].rank).toBe(1);
  });

  it("общий сейф = сумма стеков", () => {
    const lb = buildLeaderboard(snap, NOW, "dev:me");
    expect(lb.communalVault).toBe(350);
    expect(lb.players).toBe(3);
  });

  it("приватность: кошелёк = короткий адрес + полный адрес, dev = anon без адреса", () => {
    const lb = buildLeaderboard(snap, NOW, "dev:me");
    const wallet = lb.top.find((r) => r.kind === "wallet")!;
    expect(wallet.label).toMatch(/^0x.{4}….{4}$/);
    expect(wallet.address).toMatch(/^0x[0-9a-fA-F]{40}$/); // адрес открыт по умолчанию
    const anon = lb.top.find((r) => r.kind === "anon")!;
    expect(anon.label).toBe("anon");
    expect(anon.address).toBeNull();
  });

  it("ник кошелька показывается вместо адреса, но адрес всё равно доступен", () => {
    const withNick: PlayerSnapshot[] = [
      {
        identity: "wallet:0xabc0000000000000000000000000000000000001",
        state: { ...off(100), nickname: "SlimPete" },
      },
    ];
    const lb = buildLeaderboard(withNick, NOW, "x");
    expect(lb.top[0].label).toBe("SlimPete");
    expect(lb.top[0].address).not.toBeNull(); // для explorer-ссылки
  });

  it("скрытый кошелёк не отдаёт адрес наружу", () => {
    const hidden: PlayerSnapshot[] = [
      {
        identity: "wallet:0xabc0000000000000000000000000000000000002",
        state: { ...off(100), nickname: "Ghost", hideWallet: true },
      },
      {
        identity: "wallet:0xabc0000000000000000000000000000000000003",
        state: { ...off(50), hideWallet: true }, // скрыт, без ника
      },
    ];
    const lb = buildLeaderboard(hidden, NOW, "x");
    expect(lb.top[0].label).toBe("Ghost");
    expect(lb.top[0].address).toBeNull(); // адрес НЕ уходит
    expect(lb.top[1].label).toBe("anon"); // скрыт без ника → anon
    expect(lb.top[1].address).toBeNull();
  });

  it("отмечает «you» и отдаёт ранг игрока", () => {
    const lb = buildLeaderboard(snap, NOW, "dev:me");
    expect(lb.top.find((r) => r.isYou)?.stack).toBe(50);
    expect(lb.you).toEqual({ rank: 3, stack: 50 });
  });

  it("живой стек: заводящийся игрок докапывается на момент запроса", () => {
    const winding: PlayerState = {
      ...initialState(NOW),
      machineOn: true,
      streak: 1,
      stack: 0,
      lastCrankAt: NOW - 10_000, // 10с назад, внутри окна завода
      lastSettleAt: NOW - 10_000,
    };
    const lb = buildLeaderboard([{ identity: "dev:me", state: winding }], NOW, "dev:me");
    expect(lb.top[0].stack).toBeGreaterThan(0); // settle начислил за 10с
  });
});

/**
 * Публичный профиль: главный риск здесь — не расчёт, а приватность.
 *
 * Страница и карточка шеринга — это первые в проекте публичные адреса, отдающие данные
 * КОНКРЕТНОГО игрока по угадываемому URL. Всё, что просочится в объект профиля, немедленно
 * оказывается и на странице, и на картинке, которую перепостят дальше. Поэтому тесты ниже
 * закрывают три вещи: internal id не утекает, скрытый адрес остаётся скрытым, и мусорный
 * ник до хранилища не доходит.
 */
import { describe, it, expect } from "vitest";
import { GAME, initialState, type PlayerState } from "./game";
import {
  buildPublicProfile,
  parseNickParam,
  profilePath,
  profileUrl,
} from "./public-profile";
import { PAYOUT_SEATS } from "./payout";

const ADDR = "0x281e57cdab271de434aed2100cb125f5df1018db";
const T0 = 1_769_000_000_000;

function state(patch: Partial<PlayerState> = {}): PlayerState {
  return { ...initialState(T0), ...patch };
}

const RANKED = { rank: 3, moneyRank: 3, players: 240 };

describe("ник из URL", () => {
  it("нормальный ник проходит и сохраняет регистр", () => {
    expect(parseNickParam("Egor_99")).toBe("Egor_99");
  });

  it("правила те же, что при сохранении: короткий, длинный, мусорные символы — 404", () => {
    expect(parseNickParam("ab")).toBeNull();
    expect(parseNickParam("a".repeat(17))).toBeNull();
    expect(parseNickParam("egor-99")).toBeNull();
    expect(parseNickParam("егор")).toBeNull();
  });

  it("зарезервированные и похожие на адрес ники не имеют страниц", () => {
    // Их нельзя занять (lib/profile.ts), поэтому страница с таким адресом означала бы
    // сущность, которой не существует, — или подделку под системный ярлык борда.
    expect(parseNickParam("anon")).toBeNull();
    expect(parseNickParam("admin")).toBeNull();
    expect(parseNickParam("vaultler")).toBeNull();
    expect(parseNickParam("0xdeadbeef")).toBeNull();
  });

  it("путь и обход каталогов до хранилища не доходят", () => {
    expect(parseNickParam("../../etc/passwd")).toBeNull();
    expect(parseNickParam("egor/../admin")).toBeNull();
    expect(parseNickParam("%2e%2e")).toBeNull();
    expect(parseNickParam("")).toBeNull();
    expect(parseNickParam(undefined)).toBeNull();
    expect(parseNickParam(42)).toBeNull();
  });

  it("URL должен совпадать с ником посимвольно — иначе у профиля два адреса", () => {
    expect(parseNickParam(" egor")).toBeNull();
    expect(parseNickParam("egor ")).toBeNull();
  });

  it("ссылка собирается из одного места", () => {
    expect(profilePath("Egor_99")).toBe("/u/Egor_99");
    expect(profileUrl("https://thevaultler.fun/", "Egor_99")).toBe(
      "https://thevaultler.fun/u/Egor_99",
    );
  });
});

describe("приватность — главный риск этой страницы", () => {
  it("internal id не утекает ни в одно поле", () => {
    const p = buildPublicProfile(
      { identity: `wallet:${ADDR}`, state: state({ nickname: "egor" }) },
      T0,
      RANKED,
    );
    const dump = JSON.stringify(p);
    expect(dump).not.toContain("wallet:");
    expect(dump).not.toContain("dev:");
    expect(dump).not.toContain("bot:");
  });

  it("скрывший адрес не раскрывается: ник остаётся, адреса нет", () => {
    const p = buildPublicProfile(
      { identity: `wallet:${ADDR}`, state: state({ nickname: "egor", hideWallet: true }) },
      T0,
      RANKED,
    );
    expect(p?.nick).toBe("egor");
    expect(p?.address).toBeNull();
    expect(JSON.stringify(p)).not.toContain("0x281e");
  });

  it("открытый адрес отдаётся — на него ссылается эксплорер, как и на борде", () => {
    const p = buildPublicProfile(
      { identity: `wallet:${ADDR}`, state: state({ nickname: "egor" }) },
      T0,
      RANKED,
    );
    expect(p?.address).toBe(ADDR);
  });

  it("холдерский тир и таймеры фазы наружу не идут", () => {
    // Множитель — это публикация доли в эмиссии, то есть размера бэга; таймер окна —
    // подсказка «этому игроку сейчас срочно надо кранкать». Ни то, ни другое борд не
    // показывает, и профиль не показывает.
    const p = buildPublicProfile(
      {
        identity: `wallet:${ADDR}`,
        state: state({
          nickname: "egor",
          hideWallet: true,
          boostTier: 5,
          boostPpb: 9_000_000,
          machineOn: true,
          lastCrankAt: T0 - 1000,
        }),
      },
      T0,
      RANKED,
    );
    const keys = Object.keys(p!);
    expect(keys).not.toContain("multiplier");
    expect(keys).not.toContain("boostTier");
    expect(keys).not.toContain("holder");
    expect(keys).not.toContain("phase");
    expect(keys).not.toContain("phaseEndsInMs");
    expect(JSON.stringify(p)).not.toContain("TYCOON");
  });
});

describe("кому страницы не положено", () => {
  it("без ника публичной страницы нет — стёр ник, страница исчезла", () => {
    const p = buildPublicProfile(
      { identity: `wallet:${ADDR}`, state: state({ nickname: null }) },
      T0,
      RANKED,
    );
    expect(p).toBeNull();
  });

  it("пробельный ник считается отсутствующим", () => {
    const p = buildPublicProfile(
      { identity: `wallet:${ADDR}`, state: state({ nickname: "   " }) },
      T0,
      RANKED,
    );
    expect(p).toBeNull();
  });

  it("бот не получает страницы даже с ником — борд делит реальные токены", () => {
    const p = buildPublicProfile(
      { identity: "bot:Dusty Pete", state: state({ nickname: "dusty" }) },
      T0,
      RANKED,
    );
    expect(p).toBeNull();
  });
});

describe("цифры профиля", () => {
  it("стек живой: settle досчитывает начисление на момент запроса", () => {
    const crankedAt = T0 - 60_000;
    const p = buildPublicProfile(
      {
        identity: `wallet:${ADDR}`,
        state: state({
          nickname: "egor",
          machineOn: true,
          streak: 1,
          lastCrankAt: crankedAt,
          lastSettleAt: crankedAt,
        }),
      },
      T0,
      RANKED,
    );
    // 60 секунд завода при стрике 1 без буста.
    const expected = GAME.BASE_RATE_PER_SEC * (1 + GAME.STREAK_STEP) * 60;
    expect(p!.lifetimeStack).toBeCloseTo(expected, 6);
    expect(p!.weekStack).toBeCloseTo(expected, 6);
  });

  it("прирост за неделю не бывает отрицательным после рейда", () => {
    const p = buildPublicProfile(
      {
        identity: `wallet:${ADDR}`,
        state: state({ nickname: "egor", stack: 80, weekStartStack: 100 }),
      },
      T0,
      RANKED,
    );
    expect(p!.weekStack).toBe(0);
    expect(p!.lifetimeStack).toBe(80);
  });

  it("скин считается по месту и размеру комьюнити, а не сам по себе", () => {
    const player = {
      identity: `wallet:${ADDR}`,
      state: state({ nickname: "egor" }),
    };
    // 240 игроков: топ-100 открыт, топ-500 ещё нет — третье место даёт «TOP 10».
    expect(buildPublicProfile(player, T0, RANKED)!.skinLabel).toBe("TOP 10");
    // Тот же ранг при крошечном комьюнити скина не даёт: «топ-10 из 9» ничего не значит.
    expect(
      buildPublicProfile(player, T0, { rank: 3, moneyRank: 3, players: 9 })!.skinLabel,
    ).toBe("ROOKIE SAFE");
    // Вне борда (кошелёк команды исключён из расчёта) — базовый скин, без места.
    const off = buildPublicProfile(player, T0, { rank: null, moneyRank: null, players: 240 })!;
    expect(off.rank).toBeNull();
    expect(off.skinLevel).toBe(0);
  });

  it("метки за стрик — производная от стрика, лишнего не добавляют", () => {
    const p = buildPublicProfile(
      { identity: `wallet:${ADDR}`, state: state({ nickname: "egor", streak: 7 }) },
      T0,
      RANKED,
    );
    expect(p!.badges).toEqual(["STEADY HAND", "FOUNDING PROSPECTOR"]);
  });

  it("число призовых мест приходит из ядра, а не хардкодится страницей", () => {
    const p = buildPublicProfile(
      { identity: `wallet:${ADDR}`, state: state({ nickname: "egor" }) },
      T0,
      RANKED,
    );
    expect(p!.payoutSeats).toBe(PAYOUT_SEATS);
  });
});

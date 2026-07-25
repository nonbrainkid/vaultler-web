import { describe, it, expect } from "vitest";
import {
  GAME,
  crank,
  settle,
  phase,
  multiplier,
  ratePerSec,
  tierIndex,
  initialState,
  type PlayerState,
} from "./game";

// Тесты в реальных (прод) таймингах, т.к. GAME_MODE не выставлен в тест-окружении.
const T0 = 1_700_000_000_000; // фиксированный "сейчас" для детерминизма
const HOUR = 60 * 60 * 1000;

function fresh(): PlayerState {
  return initialState(T0);
}

describe("экономика", () => {
  it("множитель растёт со стриком", () => {
    expect(multiplier(1, false)).toBeCloseTo(1.2);
    expect(multiplier(5, false)).toBeCloseTo(2.0);
  });

  it("буст за холд даёт ×5 (не-холдер ×1)", () => {
    expect(GAME.BOOST_MULT).toBe(5);
    expect(multiplier(1, true)).toBeCloseTo(1.2 * 5);
    expect(multiplier(1, false)).toBeCloseTo(1.2); // без холда — только стрик
    expect(ratePerSec(1, true)).toBeCloseTo(GAME.BASE_RATE_PER_SEC * 1.2 * 5);
  });

  it("тиры по порогам стека", () => {
    expect(tierIndex(0)).toBe(0);
    expect(tierIndex(499)).toBe(0);
    expect(tierIndex(500)).toBe(1);
    expect(tierIndex(50000)).toBe(4);
    expect(tierIndex(999999)).toBe(4);
  });
});

describe("фазы петли", () => {
  it("свежая машина выключена", () => {
    expect(phase(fresh(), T0)).toBe("off");
  });

  it("во время завода — winding, после — ready, потом stall", () => {
    const s = crank(fresh(), T0).state;
    expect(phase(s, T0 + HOUR)).toBe("winding");
    expect(phase(s, T0 + GAME.WIND_MS + HOUR)).toBe("ready");
    expect(phase(s, T0 + GAME.WIND_MS + GAME.GRACE_MS + 1)).toBe("stall");
  });
});

describe("кранк", () => {
  it("первый кранк заводит машину со стриком 1", () => {
    const r = crank(fresh(), T0);
    expect(r.ok).toBe(true);
    expect(r.state.machineOn).toBe(true);
    expect(r.state.streak).toBe(1);
    expect(r.state.lastCrankAt).toBe(T0);
  });

  it("кранк во время завода ОТКЛОНЯЕТСЯ (нельзя ускорить время)", () => {
    const s = crank(fresh(), T0).state;
    const r = crank(s, T0 + HOUR); // ещё winding
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("winding");
    expect(r.state.streak).toBe(1); // стрик не изменился
    expect(r.state.lastCrankAt).toBe(T0); // тайминг не сдвинулся
  });

  it("перекранк в окне ready поднимает стрик", () => {
    const s = crank(fresh(), T0).state;
    const readyAt = T0 + GAME.WIND_MS + HOUR;
    const r = crank(s, readyAt);
    expect(r.ok).toBe(true);
    expect(r.state.streak).toBe(2);
    expect(r.state.lastCrankAt).toBe(readyAt);
  });

  it("кранк после stall стартует свежий стрик = 1 (с рейдом)", () => {
    const s = crank(fresh(), T0).state;
    // накопим немного стека и просрочим окно
    const stalledAt = T0 + GAME.WIND_MS + GAME.GRACE_MS + HOUR;
    const r = crank(s, stalledAt);
    expect(r.ok).toBe(true);
    expect(r.state.streak).toBe(1);
    expect(r.raid).not.toBeNull(); // рейд случился при settle перед кранком
  });
});

// Буст даёт ×5 к начислению, поэтому важно КОГДА он применяется.
describe("буст на кранке", () => {
  it("успешный кранк ставит свежий буст", () => {
    const r = crank(fresh(), T0, true);
    expect(r.state.boost).toBe(true);
  });

  it("снимает буст, если игрок больше не холдит", () => {
    const held = crank(fresh(), T0, true).state;
    const after = crank(held, T0 + GAME.WIND_MS + HOUR, false);
    expect(after.state.boost).toBe(false);
  });

  it("null (RPC не ответил) оставляет прежний буст, а не снимает его", () => {
    const held = crank(fresh(), T0, true).state;
    const after = crank(held, T0 + GAME.WIND_MS + HOUR, null);
    expect(after.state.boost).toBe(true);
  });

  it("undefined (не проверяли) тоже не трогает буст", () => {
    const held = crank(fresh(), T0, true).state;
    expect(crank(held, T0 + GAME.WIND_MS + HOUR).state.boost).toBe(true);
  });

  it("отклонённый кранк буст не меняет — ставка завода уже зафиксирована", () => {
    const held = crank(fresh(), T0, true).state;
    const rejected = crank(held, T0 + HOUR, false); // ещё winding
    expect(rejected.ok).toBe(false);
    expect(rejected.state.boost).toBe(true);
  });

  /**
   * Ключевой инвариант: буст задаёт ставку СЛЕДУЮЩЕГО завода. Если применить его до
   * settle, уже отработавший отрезок пересчитается по новому множителю задним числом —
   * игрок получил бы ×5 за сутки, которые стакал без токена (или наоборот потерял бы).
   */
  it("не пересчитывает задним числом уже начисленный отрезок", () => {
    const noBoost = crank(fresh(), T0, false).state;
    const readyAt = T0 + GAME.WIND_MS + HOUR; // полный завод без буста

    const withNewBoost = crank(noBoost, readyAt, true);
    const withoutBoost = crank(noBoost, readyAt, false);

    // Стек за прошедший завод одинаков: включение буста прошлое не трогает.
    expect(withNewBoost.state.stack).toBeCloseTo(withoutBoost.state.stack, 9);
    // А ставка на следующий завод уже разная.
    expect(withNewBoost.state.boost).toBe(true);
    expect(withoutBoost.state.boost).toBe(false);
  });
});

// phaseAt уходит в журнал CrankLog — по нему потом разбирают спорные ситуации.
describe("фаза на момент попытки (для аудита)", () => {
  it("первый кранк застаёт машину выключенной", () => {
    expect(crank(fresh(), T0).phaseAt).toBe("off");
  });

  it("отклонённый кранк фиксирует winding", () => {
    const s = crank(fresh(), T0).state;
    expect(crank(s, T0 + HOUR).phaseAt).toBe("winding");
  });

  it("перекранк в окне фиксирует ready", () => {
    const s = crank(fresh(), T0).state;
    expect(crank(s, T0 + GAME.WIND_MS + HOUR).phaseAt).toBe("ready");
  });

  it("после простоя — off, потому что рейд уже погасил машину; простой виден по raid", () => {
    const s = crank(fresh(), T0).state;
    const r = crank(s, T0 + GAME.WIND_MS + GAME.GRACE_MS + HOUR);
    expect(r.phaseAt).toBe("off");
    expect(r.raid).not.toBeNull();
  });
});

describe("начисление стека (settle)", () => {
  it("стек капает по ставке за секунды внутри окна завода", () => {
    const s = crank(fresh(), T0).state; // streak 1
    const r = settle(s, T0 + 100_000); // 100 секунд
    const expected = ratePerSec(1, false) * 100;
    expect(r.accrued).toBeCloseTo(expected);
    expect(r.state.stack).toBeCloseTo(expected);
  });

  it("начисление не выходит за конец окна завода", () => {
    const s = crank(fresh(), T0).state;
    // settle далеко за WIND, но всё ещё в grace (не stall)
    const t = T0 + GAME.WIND_MS + HOUR;
    const r = settle(s, t);
    const expected = ratePerSec(1, false) * (GAME.WIND_MS / 1000);
    expect(r.state.stack).toBeCloseTo(expected);
    expect(r.raid).toBeNull();
  });

  it("settle идемпотентен: повтор с тем же now не добавляет стек", () => {
    const s = crank(fresh(), T0).state;
    const t = T0 + 100_000;
    const once = settle(s, t);
    const twice = settle(once.state, t);
    expect(twice.accrued).toBe(0);
    expect(twice.state.stack).toBeCloseTo(once.state.stack);
  });

  it("рейд скимит SKIM и обнуляет стрик при простое", () => {
    let s = crank(fresh(), T0).state;
    // сначала накопим полный завод
    s = settle(s, T0 + GAME.WIND_MS).state;
    const beforeRaid = s.stack;
    // теперь просрочим grace
    const r = settle(s, T0 + GAME.WIND_MS + GAME.GRACE_MS + 1);
    expect(r.raid).not.toBeNull();
    expect(r.raid!.lost).toBeCloseTo(beforeRaid * GAME.SKIM);
    expect(r.state.stack).toBeCloseTo(beforeRaid * (1 - GAME.SKIM));
    expect(r.state.streak).toBe(0);
    expect(r.state.machineOn).toBe(false);
  });
});

describe("защита от накрутки времени", () => {
  it("клиент не может начислить больше, чем реально прошло по серверным часам", () => {
    // Симуляция: игрок крутит, «уходит» и возвращается. Сколько бы клиент ни слал,
    // сервер начисляет строго по своему now. Тут проверяем, что за фиксированный now
    // результат детерминирован и не зависит от числа вызовов.
    const s = crank(fresh(), T0).state;
    const t = T0 + 50_000;
    const a = settle(s, t).state.stack;
    // повторный «спам» settle тем же временем не раздувает стек
    let acc = settle(s, t).state;
    for (let i = 0; i < 10; i++) acc = settle(acc, t).state;
    expect(acc.stack).toBeCloseTo(a);
  });
});

import { describe, it, expect } from "vitest";
import {
  GAME,
  HOLDER_TIERS,
  MAX_HOLDER_LEVEL,
  MAX_SHARE_PPB,
  clampHolderLevel,
  crank,
  holderMult,
  holderTierFromPpb,
  hydrateState,
  nextHolderTier,
  settle,
  phase,
  multiplier,
  ratePerSec,
  sharePctFromPpb,
  tierIndex,
  toPublicView,
  initialState,
  type PlayerState,
} from "./game";
import { weekInfo } from "./week";

// Тесты в реальных (прод) таймингах, т.к. GAME_MODE не выставлен в тест-окружении.
const T0 = 1_700_000_000_000; // фиксированный "сейчас" для детерминизма
const HOUR = 60 * 60 * 1000;

function fresh(): PlayerState {
  return initialState(T0);
}

describe("экономика", () => {
  it("множитель растёт со стриком", () => {
    expect(multiplier(1, 0)).toBeCloseTo(1.2);
    expect(multiplier(5, 0)).toBeCloseTo(2.0);
  });

  it("верхний тир холда даёт ×5, отсутствие холда — ×1", () => {
    expect(GAME.BOOST_MULT).toBe(5);
    expect(multiplier(1, MAX_HOLDER_LEVEL)).toBeCloseTo(1.2 * 5);
    expect(multiplier(1, 0)).toBeCloseTo(1.2); // без холда — только стрик
    expect(ratePerSec(1, MAX_HOLDER_LEVEL)).toBeCloseTo(GAME.BASE_RATE_PER_SEC * 1.2 * 5);
  });

  it("тиры по стеку — по порогам", () => {
    expect(tierIndex(0)).toBe(0);
    expect(tierIndex(499)).toBe(0);
    expect(tierIndex(500)).toBe(1);
    expect(tierIndex(50000)).toBe(4);
    expect(tierIndex(999999)).toBe(4);
  });
});

/**
 * Лестница холда — главный экономический рычаг: она решает, зачем держать БОЛЬШЕ
 * минимума. Поэтому проверяем не только границы, но и форму кривой.
 */
describe("лестница холдерского буста", () => {
  it("ступени идут строго по возрастанию и порога, и множителя", () => {
    for (let i = 1; i < HOLDER_TIERS.length; i++) {
      expect(HOLDER_TIERS[i].minPpb).toBeGreaterThan(HOLDER_TIERS[i - 1].minPpb);
      expect(HOLDER_TIERS[i].mult).toBeGreaterThan(HOLDER_TIERS[i - 1].mult);
    }
  });

  it("верх лестницы равен GAME.BOOST_MULT — экономику пула не инфлируем", () => {
    expect(HOLDER_TIERS[MAX_HOLDER_LEVEL].mult).toBe(GAME.BOOST_MULT);
    expect(holderMult(MAX_HOLDER_LEVEL)).toBe(5);
  });

  it("тир по доле в эмиссии: граница включительно, ниже порога — предыдущая ступень", () => {
    expect(holderTierFromPpb(0)).toBe(0);
    expect(holderTierFromPpb(HOLDER_TIERS[1].minPpb - 1)).toBe(0);
    expect(holderTierFromPpb(HOLDER_TIERS[1].minPpb)).toBe(1);
    expect(holderTierFromPpb(HOLDER_TIERS[3].minPpb)).toBe(3);
    expect(holderTierFromPpb(HOLDER_TIERS[3].minPpb - 1)).toBe(2);
    expect(holderTierFromPpb(HOLDER_TIERS[MAX_HOLDER_LEVEL].minPpb)).toBe(MAX_HOLDER_LEVEL);
  });

  /**
   * Кит с половиной эмиссии не должен получать больше холдера с 0.5%: иначе один кошелёк
   * забирает призовой пул навсегда, и игра для остальных заканчивается.
   */
  it("выше вершины множитель не растёт — кит упирается в тот же ×5", () => {
    const top = HOLDER_TIERS[MAX_HOLDER_LEVEL].minPpb;
    expect(holderTierFromPpb(top * 100)).toBe(MAX_HOLDER_LEVEL);
    expect(holderTierFromPpb(1e9)).toBe(MAX_HOLDER_LEVEL); // 100% эмиссии
    expect(holderMult(99)).toBe(GAME.BOOST_MULT);
  });

  /**
   * Смысл кривой: бэг растёт на порядки, ставка — в разы. Иначе крупный холдер отрывается
   * так, что остальным нет смысла играть.
   */
  it("кривая сильно вогнутая: ×500 к бэгу даёт меньше ×4 к ставке", () => {
    const first = HOLDER_TIERS[1];
    const top = HOLDER_TIERS[MAX_HOLDER_LEVEL];
    const bagRatio = top.minPpb / first.minPpb;
    const multRatio = top.mult / first.mult;
    expect(bagRatio).toBeGreaterThan(100); // бэг больше в сотни раз
    expect(multRatio).toBeLessThan(4); // ставка — меньше чем вчетверо
  });

  /**
   * Анти-сивил: дробить бэг по кошелькам не должно повышать множитель ни одного из них.
   * Это следствие вогнутости порогов — доля каждого кошелька падает пропорционально.
   */
  it("дробление бэга снижает тир каждого кошелька", () => {
    const whole = HOLDER_TIERS[MAX_HOLDER_LEVEL].minPpb; // ровно вершина
    expect(holderTierFromPpb(whole)).toBe(MAX_HOLDER_LEVEL);
    for (const parts of [2, 5, 10]) {
      expect(holderTierFromPpb(whole / parts)).toBeLessThan(MAX_HOLDER_LEVEL);
    }
  });

  it("битый или выходящий за диапазон уровень трактуется как «буста нет»", () => {
    expect(clampHolderLevel(-3)).toBe(0);
    expect(clampHolderLevel(NaN)).toBe(0);
    expect(clampHolderLevel("5" as unknown)).toBe(0);
    expect(clampHolderLevel(undefined)).toBe(0);
    expect(clampHolderLevel(999)).toBe(MAX_HOLDER_LEVEL);
    // и по долям тоже: мусор не должен превращаться в множитель
    expect(holderTierFromPpb(NaN)).toBe(0);
    expect(holderTierFromPpb(-1)).toBe(0);
  });

  it("ppb переводится в проценты эмиссии", () => {
    expect(sharePctFromPpb(10_000)).toBeCloseTo(0.001); // 0.001% эмиссии
    expect(sharePctFromPpb(5_000_000)).toBeCloseTo(0.5);
    expect(sharePctFromPpb(1e9)).toBeCloseTo(100);
  });

  it("на вершине следующей ступени нет", () => {
    expect(nextHolderTier(0)?.level).toBe(1);
    expect(nextHolderTier(MAX_HOLDER_LEVEL)).toBeNull();
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

// Тир холда множит начисление, поэтому важно КОГДА он применяется.
describe("тир холда на кранке", () => {
  const TOP = { tier: MAX_HOLDER_LEVEL, ppb: HOLDER_TIERS[MAX_HOLDER_LEVEL].minPpb };
  const NONE = { tier: 0, ppb: 0 };
  const MID = { tier: 2, ppb: HOLDER_TIERS[2].minPpb };

  it("успешный кранк ставит свежий тир вместе с долей", () => {
    const r = crank(fresh(), T0, TOP);
    expect(r.state.boostTier).toBe(MAX_HOLDER_LEVEL);
    expect(r.state.boostPpb).toBe(TOP.ppb);
  });

  it("тир понижается, если игрок продал часть бэга", () => {
    const held = crank(fresh(), T0, TOP).state;
    const after = crank(held, T0 + GAME.WIND_MS + HOUR, MID);
    expect(after.state.boostTier).toBe(2);
  });

  it("снимает буст, если игрок больше не холдит", () => {
    const held = crank(fresh(), T0, TOP).state;
    const after = crank(held, T0 + GAME.WIND_MS + HOUR, NONE);
    expect(after.state.boostTier).toBe(0);
  });

  it("null (RPC не ответил) оставляет прежний тир, а не снимает его", () => {
    const held = crank(fresh(), T0, TOP).state;
    const after = crank(held, T0 + GAME.WIND_MS + HOUR, null);
    expect(after.state.boostTier).toBe(MAX_HOLDER_LEVEL);
  });

  it("undefined (не проверяли) тоже не трогает тир", () => {
    const held = crank(fresh(), T0, TOP).state;
    expect(crank(held, T0 + GAME.WIND_MS + HOUR).state.boostTier).toBe(MAX_HOLDER_LEVEL);
  });

  it("отклонённый кранк тир не меняет — ставка завода уже зафиксирована", () => {
    const held = crank(fresh(), T0, TOP).state;
    const rejected = crank(held, T0 + HOUR, NONE); // ещё winding
    expect(rejected.ok).toBe(false);
    expect(rejected.state.boostTier).toBe(MAX_HOLDER_LEVEL);
  });

  it("подсунутый уровень вне лестницы не даёт множителя больше вершины", () => {
    const r = crank(fresh(), T0, { tier: 42, ppb: 1e12 });
    expect(r.state.boostTier).toBe(MAX_HOLDER_LEVEL);
    expect(multiplier(r.state.streak, r.state.boostTier)).toBeCloseTo(1.2 * GAME.BOOST_MULT);
  });

  /**
   * Доля больше 100% эмиссии физически невозможна, но битый токен может отдать
   * `balanceOf > totalSupply`. Такое значение не должно уехать в стейт: колонка `Int`
   * его не вместит, и запись игрока упала бы целиком.
   */
  it("доля обрезается по 100% эмиссии", () => {
    expect(crank(fresh(), T0, { tier: 5, ppb: 1e12 }).state.boostPpb).toBe(MAX_SHARE_PPB);
    expect(crank(fresh(), T0, { tier: 1, ppb: -5 }).state.boostPpb).toBe(0);
    expect(crank(fresh(), T0, { tier: 1, ppb: NaN }).state.boostPpb).toBe(0);
    expect(hydrateState({ lastSettleAt: T0, boostTier: 5, boostPpb: 9e15 }, T0).boostPpb).toBe(
      MAX_SHARE_PPB,
    );
  });

  /**
   * Ключевой инвариант: тир задаёт ставку СЛЕДУЮЩЕГО завода. Если применить его до
   * settle, уже отработавший отрезок пересчитается по новому множителю задним числом —
   * игрок получил бы ×5 за сутки, которые стакал без токена (или наоборот потерял бы).
   */
  it("не пересчитывает задним числом уже начисленный отрезок", () => {
    const noBoost = crank(fresh(), T0, NONE).state;
    const readyAt = T0 + GAME.WIND_MS + HOUR; // полный завод без буста

    const withNewBoost = crank(noBoost, readyAt, TOP);
    const withoutBoost = crank(noBoost, readyAt, NONE);

    // Стек за прошедший завод одинаков: включение буста прошлое не трогает.
    expect(withNewBoost.state.stack).toBeCloseTo(withoutBoost.state.stack, 9);
    // А ставка на следующий завод уже разная.
    expect(withNewBoost.state.boostTier).toBe(MAX_HOLDER_LEVEL);
    expect(withoutBoost.state.boostTier).toBe(0);
  });

  it("чем выше тир, тем быстрее стек за тот же завод", () => {
    const stacks = HOLDER_TIERS.map((t) => {
      const s = crank(fresh(), T0, { tier: t.level, ppb: t.minPpb }).state;
      return settle(s, T0 + GAME.WIND_MS).state.stack;
    });
    for (let i = 1; i < stacks.length; i++) {
      expect(stacks[i]).toBeGreaterThan(stacks[i - 1]);
    }
  });
});

/**
 * Недельный борд: ранг считается по ПРИРОСТУ за неделю (`stack - weekStartStack`),
 * а личный стек и тиры не сбрасываются. Здесь проверяется, что база берётся ровно
 * на границе недели — от этого зависит, кто попадёт в топ-10 и получит реальные токены.
 */
describe("база недели", () => {
  const week = weekInfo(T0);

  it("у нового игрока неделя текущая, а весь стек засчитан в неё", () => {
    const s = crank(fresh(), T0).state;
    const after = settle(s, T0 + 60_000).state;
    expect(after.weekId).toBe(week.weekId);
    expect(after.weekStartStack).toBe(0);
    expect(toPublicView(after, T0 + 60_000).weekStack).toBeCloseTo(after.stack);
  });

  /**
   * Ключевой случай: машина заведена ДО субботы и продолжает капать после неё.
   * База должна быть стеком ровно на полуночь, иначе часть прошлой недели уехала бы
   * в зачёт новой (или наоборот пропала).
   */
  it("машина, работающая через границу, делит стек по полуночи", () => {
    const crankAt = week.startsAt - 12 * HOUR; // за 12ч до сброса
    const started = crank(initialState(crankAt), crankAt).state;

    const sixHoursIn = week.startsAt + 6 * HOUR;
    const after = settle(started, sixHoursIn).state;

    const rate = ratePerSec(1, 0);
    // до границы накапало ровно 12 часов
    expect(after.weekStartStack).toBeCloseTo(rate * 12 * 3600, 6);
    // после границы — ровно 6 часов
    expect(after.stack - after.weekStartStack).toBeCloseTo(rate * 6 * 3600, 6);
    expect(after.weekId).toBe(weekInfo(sixHoursIn).weekId);
  });

  it("личный стек и тиры сброс не трогает", () => {
    const crankAt = week.startsAt - 20 * HOUR;
    let s = crank(initialState(crankAt), crankAt).state;
    s = { ...s, stack: 5000 }; // как будто игрок давно копит
    const after = settle(s, week.startsAt + HOUR).state;
    expect(after.stack).toBeGreaterThanOrEqual(5000); // накопленное на месте
    expect(tierIndex(after.stack)).toBeGreaterThan(0); // тир не потерян
  });

  it("повторный settle не сдвигает базу (идемпотентность сохранена)", () => {
    const crankAt = week.startsAt - 3 * HOUR;
    const started = crank(initialState(crankAt), crankAt).state;
    const t = week.startsAt + 2 * HOUR;
    const once = settle(started, t).state;
    const twice = settle(once, t).state;
    expect(twice.weekStartStack).toBeCloseTo(once.weekStartStack, 9);
    expect(twice.stack).toBeCloseTo(once.stack, 9);
  });

  it("игрок, пропустивший несколько недель, стартует с базой текущей недели", () => {
    const crankAt = week.startsAt - 30 * 24 * HOUR; // месяц назад
    const started = crank(initialState(crankAt), crankAt).state;
    const after = settle(started, week.startsAt + HOUR).state;
    expect(after.weekId).toBe(week.weekId);
    // за этот месяц был рейд и машина заглохла — прирост за новую неделю нулевой
    expect(after.stack - after.weekStartStack).toBeCloseTo(0, 9);
  });

  it("рейд через границу применяется один раз", () => {
    const crankAt = week.startsAt - (GAME.WIND_MS + GAME.GRACE_MS) - HOUR;
    const started = crank(initialState(crankAt), crankAt).state;
    const r = settle(started, week.startsAt + HOUR);
    expect(r.raid).not.toBeNull();
    expect(r.state.machineOn).toBe(false);
    // второй settle того же момента рейд не повторяет
    expect(settle(r.state, week.startsAt + HOUR).raid).toBeNull();
  });
});

describe("стейт из хранилища (hydrateState)", () => {
  it("пустая/битая запись — свежий стейт", () => {
    expect(hydrateState(undefined, T0)).toEqual(initialState(T0));
    expect(hydrateState("нет", T0)).toEqual(initialState(T0));
    expect(hydrateState({ stack: "много" }, T0).stack).toBe(0);
  });

  it("сохраняет нормальные поля", () => {
    const s = crank(fresh(), T0, { tier: 3, ppb: 250_000 }).state;
    expect(hydrateState(JSON.parse(JSON.stringify(s)), T0)).toEqual(s);
  });

  /**
   * Старый формат (булев `boost`) поднимаем только до ПЕРВОЙ ступени: выдать по нему
   * ×5 значило бы раздать верхний множитель всем, у кого когда-то был минимальный холд.
   * Реальную долю всё равно перечитает следующий кранк.
   */
  it("легаси boost:true → первая ступень, а не вершина", () => {
    const legacy = { stack: 10, streak: 2, lastSettleAt: T0, boost: true };
    expect(hydrateState(legacy, T0).boostTier).toBe(1);
  });

  it("легаси boost:false → без буста", () => {
    expect(hydrateState({ lastSettleAt: T0, boost: false }, T0).boostTier).toBe(0);
  });

  it("явный boostTier важнее легаси-флага", () => {
    expect(hydrateState({ boost: true, boostTier: 4, lastSettleAt: T0 }, T0).boostTier).toBe(4);
  });
});

describe("публичный вид для UI", () => {
  it("отдаёт текущую и следующую ступень холда", () => {
    const s = crank(fresh(), T0, { tier: 1, ppb: 12_345 }).state;
    const v = toPublicView(s, T0);
    expect(v.boost).toBe(true);
    expect(v.holder.level).toBe(1);
    expect(v.holder.mult).toBe(HOLDER_TIERS[1].mult);
    expect(v.nextHolder?.level).toBe(2);
    expect(v.nextHolder?.sharePct).toBeCloseTo(sharePctFromPpb(HOLDER_TIERS[2].minPpb));
    expect(v.holderSharePct).toBeCloseTo(sharePctFromPpb(12_345));
  });

  it("на вершине следующей ступени не обещает", () => {
    const s = crank(fresh(), T0, { tier: MAX_HOLDER_LEVEL, ppb: 9_000_000 }).state;
    expect(toPublicView(s, T0).nextHolder).toBeNull();
  });

  it("без холда буст выключен и первая ступень показана как цель", () => {
    const v = toPublicView(fresh(), T0);
    expect(v.boost).toBe(false);
    expect(v.holder.mult).toBe(1);
    expect(v.nextHolder?.level).toBe(1);
  });

  /**
   * Читаемость петли: игрок должен видеть не только «сколько времени осталось», но и
   * «что конкретно теряется» при простое. `raidPreview` — чистое производное поле
   * (не меняет settle/advance), поэтому проверяем его отдельно от самого рейда.
   */
  it("raidPreview считает потенциальную потерю от текущего стека и GAME.SKIM", () => {
    const s = crank(fresh(), T0).state;
    const after = settle(s, T0 + GAME.WIND_MS).state; // весь стек уже начислен, ждём grace
    const v = toPublicView(after, T0 + GAME.WIND_MS);
    expect(v.raidPreview.pct).toBeCloseTo(GAME.SKIM * 100);
    expect(v.raidPreview.amount).toBeCloseTo(after.stack * GAME.SKIM);
  });

  it("на нулевом стеке потенциальная потеря тоже нулевая", () => {
    expect(toPublicView(fresh(), T0).raidPreview.amount).toBe(0);
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
    const expected = ratePerSec(1, 0) * 100;
    expect(r.accrued).toBeCloseTo(expected);
    expect(r.state.stack).toBeCloseTo(expected);
  });

  it("начисление не выходит за конец окна завода", () => {
    const s = crank(fresh(), T0).state;
    // settle далеко за WIND, но всё ещё в grace (не stall)
    const t = T0 + GAME.WIND_MS + HOUR;
    const r = settle(s, t);
    const expected = ratePerSec(1, 0) * (GAME.WIND_MS / 1000);
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

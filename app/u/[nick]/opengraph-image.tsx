/**
 * Карточка результата игрока — картинка, которая уходит в чаты и таймлайны.
 *
 * Ради неё вся фича и делается: у игры нулевая виральность, и единственное, что реально
 * ходит по рукам, — это картинка с цифрами и нашим доменом на ней. Стиль снят с
 * `app/opengraph-image.tsx` (та же палитра бренда, тот же приём «полоса-акцент слева»),
 * чтобы карточка игрока читалась как часть сайта, а не как чужой генератор.
 *
 * ЦИФРЫ БЕРУТСЯ ТОЛЬКО С СЕРВЕРА. В URL нет ничего, кроме ника: ни стека, ни стрика, ни
 * ранга (инвариант 1 — API не принимает от клиента цифры). Иначе карточка «ранг 1, стек
 * 999999» собиралась бы вручную любым желающим и обесценивала бы борд, который делит
 * реальные токены.
 *
 * АДРЕС КОШЕЛЬКА НА КАРТИНКУ НЕ ПОПАДАЕТ НИКОГДА — даже у игрока, который его не скрывал.
 * На странице адрес — это живая ссылка в эксплорер, её можно проверить одним кликом.
 * На картинке проверить нельзя ничего: подрисованный адрес в чужой «карточке Vaultler» —
 * это готовый фишинговый носитель, а мы бы своими руками ввели формат, в котором такое
 * выглядит нормально.
 *
 * КЭШИРОВАНИЕ. Сама картинка безлична (зависит только от ника в пути), но ответ,
 * уходящий с нашего origin, несёт `Set-Cookie` с сессией от proxy.ts — её получает любой
 * клиент без cookie, то есть каждый краулер. Осевший в общем кэше такой ответ отдал бы
 * одну сессию всем следующим — инвариант 7. Поэтому здесь честный `no-store`, а не
 * `s-maxage`: цифры всё равно живые (стек капает каждую секунду), а перегенерация на
 * нашем масштабе дешевле, чем разбор «почему у двух игроков одна сессия».
 */
import { ImageResponse } from "next/og";
import type { PublicProfile } from "@/lib/public-profile";
import { loadPublicProfile } from "@/lib/public-profile-server";

export const runtime = "nodejs";
// Как и у всех остальных маршрутов проекта: стейт игрока читается из стора на запрос,
// статическая генерация на билде запекла бы нули.
export const dynamic = "force-dynamic";

export const alt = "The Vaultler — stacker card";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

/** Домен на картинке. Единственная «подпись» под ней — по ней и приходят обратно. */
const SITE_HOST = (() => {
  try {
    return new URL(process.env.NEXT_PUBLIC_SITE_URL ?? "https://thevaultler.fun").host;
  } catch {
    return "thevaultler.fun";
  }
})();

/**
 * Цвета скина по рангу. Своя маленькая таблица, а не импорт палитр `SafeSprite`:
 * Satori умеет только flexbox-разметку, поэтому пиксельный SVG-спрайт здесь не
 * переиспользовать в принципе — сейф собран из десятка div-ов. Оттенки взяты из тех же
 * палитр (docs/design.md → скины по рангу): жесть → бронза → серебро → сталь с золотым
 * карнизом → золото → сияющее золото.
 */
const SKINS = [
  { dark: "#1b1712", body: "#9a9384", light: "#c6bfae", accent: "#c6bfae" },
  { dark: "#1a0f06", body: "#a5703c", light: "#d9a05c", accent: "#f0c489" },
  { dark: "#14161a", body: "#a8a8a2", light: "#dcdcd4", accent: "#ffffff" },
  { dark: "#0d1210", body: "#46504a", light: "#707d74", accent: "#f5b825" },
  { dark: "#2a1a04", body: "#caa23e", light: "#ffd95a", accent: "#fff0b8" },
  { dark: "#3a2405", body: "#f0bd35", light: "#ffe98a", accent: "#ffffff" },
] as const;

const BONE = "#f0e6d2";
const NEON = "#8cff5a";
const GOLD = "#ffd95a";
const SAND = "#d99a1f";
const MUTED = "#b3987a";
const WOOD = "#5c3520";

/**
 * Стек: пока он мал, показываем разряд после запятой — на прод-ставке (0.012/с) целая часть
 * не меняется 83 секунды, и карточка выглядела бы замершей. Ровный ноль при этом печатаем
 * как «0», а не «0.0»: у только что заведённой машины это самая частая карточка.
 */
function fmtStack(n: number): string {
  if (n <= 0) return "0";
  const digits = n < 100 ? 1 : 0;
  return n.toLocaleString("en-US", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

/** Каркас карточки: фон, неоновая полоса слева, шапка с брендом. */
function Frame({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        padding: "56px 70px",
        background: "linear-gradient(160deg, #241708 0%, #0f0a06 55%, #14100a 100%)",
        color: BONE,
        fontFamily: "monospace",
        position: "relative",
      }}
    >
      <div
        style={{
          position: "absolute",
          left: 0,
          top: 0,
          bottom: 0,
          width: 16,
          background: NEON,
          display: "flex",
        }}
      />
      {children}
    </div>
  );
}

/** Один ридаут — как в игре: подпись мелким пикселем, значение крупным. */
function Readout({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        border: `4px solid ${WOOD}`,
        background: "#0d0904",
        padding: "16px 26px",
        minWidth: 250,
      }}
    >
      <div style={{ fontSize: 22, color: MUTED, letterSpacing: 3 }}>{label}</div>
      <div style={{ fontSize: 62, fontWeight: 700, color, lineHeight: 1.1 }}>{value}</div>
    </div>
  );
}

/**
 * Сейф из div-ов. Пиксельный спрайт (`SafeSprite`) — это SVG, а Satori рисует только
 * flexbox, поэтому здесь его грубая «эмблема»: корпус, дверь, диск и — на верхних скинах —
 * золотой карниз и зубцы короны, то есть ровно та же логика «чем выше место, тем богаче
 * украшения», что и в спрайте.
 */
function SafeMark({ level }: { level: number }) {
  const s = SKINS[Math.max(0, Math.min(level, SKINS.length - 1))];
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
      {level >= 4 && (
        // Корона: три зубца — та же награда за топ-10 и первое место, что и в спрайте.
        <div style={{ display: "flex", gap: 8, marginBottom: 6 }}>
          {[0, 1, 2].map((i) => (
            <div key={i} style={{ width: 18, height: 18, background: s.accent, display: "flex" }} />
          ))}
        </div>
      )}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          width: 170,
          height: 170,
          background: s.body,
          border: `12px solid ${s.dark}`,
          boxShadow: level >= 3 ? `0 0 0 7px ${s.accent}` : `0 0 0 7px ${NEON}`,
        }}
      >
        {/* диск сейфа */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            width: 86,
            height: 86,
            background: s.light,
            border: `10px solid ${s.dark}`,
          }}
        >
          <div style={{ width: 20, height: 20, background: s.dark, display: "flex" }} />
        </div>
      </div>
      {level >= 3 && (
        // Золотой карниз — первый признак топ-100 и выше.
        <div style={{ width: 194, height: 14, background: s.accent, display: "flex" }} />
      )}
    </div>
  );
}

/** Карточка игрока. */
function PlayerCard({ p }: { p: PublicProfile }) {
  // Вне борда (кошелёк команды) места нет — прочерк, а не «#null» и не «#0».
  const rank = p.rank === null ? "—" : `#${p.rank}`;
  return (
    <Frame>
      <div style={{ display: "flex", flexDirection: "column" }}>
        <div style={{ fontSize: 24, color: NEON, letterSpacing: 4 }}>
          THE VAULTLER · DAILY STACKING GAME
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 36, marginTop: 22 }}>
          <SafeMark level={p.skinLevel} />
          <div style={{ display: "flex", flexDirection: "column" }}>
            <div
              style={{
                fontSize: p.nick.length > 10 ? 66 : 84,
                fontWeight: 700,
                color: GOLD,
                lineHeight: 1.05,
              }}
            >
              {p.nick}
            </div>
            {/* Строки склеиваем заранее: Satori требует `display: flex` у любого div с
                более чем одним дочерним узлом, а `{a} · {b}` — это три узла.
                Подпись базового скина («unranked») на карточке не показываем: рядом стоит
                номер места, и два разных ответа на один вопрос сбивают с толку. */}
            <div style={{ fontSize: 28, color: SAND, marginTop: 8 }}>
              {p.skinLevel > 0 ? `${p.skinLabel} · ${p.skinHint}` : p.skinLabel}
            </div>
            {p.moneyRank !== null && (
              // Приз — за МЕСТО в игре, поэтому и подпись про место, а не про доход
              // (docs/leaderboard-rewards.md, юр-рамка).
              <div
                style={{
                  display: "flex",
                  marginTop: 12,
                  border: `4px solid ${GOLD}`,
                  color: GOLD,
                  fontSize: 22,
                  padding: "8px 14px",
                  letterSpacing: 2,
                }}
              >
                {`PRIZE SEAT ${p.moneyRank} OF ${p.payoutSeats}`}
              </div>
            )}
          </div>
        </div>
      </div>

      <div style={{ display: "flex", gap: 18 }}>
        <Readout label="STACK" value={fmtStack(p.weekStack)} color={NEON} />
        <Readout label="STREAK" value={String(p.streak)} color="#e05a3a" />
        <Readout label="BOARD" value={rank} color={GOLD} />
      </div>

      <div style={{ display: "flex", flexDirection: "column" }}>
        <div style={{ fontSize: 30, color: BONE }}>
          Wind it once a day. It stacks while you sleep.
        </div>
        <div style={{ fontSize: 22, color: MUTED, marginTop: 8 }}>
          {`${SITE_HOST} · $STACK is a score inside the game, not a token`}
        </div>
      </div>
    </Frame>
  );
}

/**
 * Карточка на случай «такого ника нет».
 *
 * Не 404 картинкой: страница `/u/[nick]` неизвестный ник уже отдаёт как 404, и краулер до
 * картинки не доходит. Прямое обращение сюда — это чей-то старый линк на стёртый ник, и
 * битая картинка в чате выглядит как сломанный сайт. Отдаём брендовую заглушку без цифр.
 */
function FallbackCard() {
  return (
    <Frame>
      <div style={{ display: "flex", flexDirection: "column" }}>
        <div style={{ fontSize: 24, color: NEON, letterSpacing: 4 }}>
          DAILY STACKING GAME · ROBINHOOD CHAIN
        </div>
        <div style={{ fontSize: 84, fontWeight: 700, color: GOLD, lineHeight: 1.05 }}>
          THE VAULTLER
        </div>
      </div>
      {/* Три блока, как на карточке игрока: иначе `space-between` растягивает две строки
          по краям и в середине зияет пустота. */}
      <div style={{ display: "flex", fontSize: 40, color: NEON }}>
        No stacker goes by that name.
      </div>
      <div style={{ display: "flex", flexDirection: "column" }}>
        <div style={{ fontSize: 28, color: SAND }}>
          Crank the machine, pick a board name, get your own card.
        </div>
        <div style={{ fontSize: 22, color: MUTED, marginTop: 12 }}>{SITE_HOST}</div>
      </div>
    </Frame>
  );
}

export default async function Card({ params }: { params: Promise<{ nick: string }> }) {
  const { nick } = await params;
  const profile = await loadPublicProfile(nick, Date.now());

  return new ImageResponse(profile ? <PlayerCard p={profile} /> : <FallbackCard />, {
    ...size,
    headers: {
      // Осознанно не пускаем в общие кэши — см. блок про кэширование в шапке файла.
      "cache-control": "private, no-store, max-age=0, must-revalidate",
    },
  });
}

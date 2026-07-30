import React from "react";
import { AbsoluteFill } from "remotion";
import { Backdrop } from "../components/Backdrop";
import { C, GLOW, MONO, PIXEL, Reveal, Shell } from "../components/ui";
import { useLayout } from "../layout";
import { LIVE, NEVER, NEXT, PROOF } from "../copy";

/**
 * «Это не однодневка»: слева — что уже работает в проде, справа — что дальше.
 *
 * Дат нет намеренно, ровно как на сайте: обещанная и просроченная дата — долг, за
 * которым приходят в комментарии, и стоит он дороже самой фичи.
 */
export const Roadmap: React.FC = () => {
  const { u, vertical } = useLayout();

  const col = (
    title: string,
    color: string,
    items: string[],
    delay: number,
    dot: string,
  ) => (
    <div
      style={{
        flex: 1,
        border: `${0.35 * u}px solid ${C.woodDarker}`,
        background: "rgba(0,0,0,0.42)",
        padding: `${1.6 * u}px ${1.6 * u}px`,
        boxShadow: `inset 0 ${0.4 * u}px 0 0 ${color}`,
      }}
    >
      <Reveal delay={delay}>
        <div
          style={{
            fontFamily: PIXEL,
            fontSize: 1.7 * u,
            color,
            marginBottom: 1.3 * u,
            textShadow: color === C.goldHi ? GLOW.gold : GLOW.neon,
          }}
        >
          {title}
        </div>
      </Reveal>
      <div style={{ display: "grid", gap: 0.9 * u }}>
        {items.map((it, i) => (
          <Reveal
            key={it}
            delay={delay + 6 + i * 5}
            distance={1.5}
            style={{ display: "flex", gap: 1 * u, alignItems: "baseline" }}
          >
            <span
              style={{
                width: 0.9 * u,
                height: 0.9 * u,
                background: dot,
                flexShrink: 0,
                boxShadow: `0 0 ${0.9 * u}px ${dot}`,
                transform: `translateY(${-0.2 * u}px)`,
              }}
            />
            <span
              style={{
                fontFamily: MONO,
                fontSize: (vertical ? 2.7 : 2.5) * u,
                lineHeight: 1.1,
                color: C.bone,
              }}
            >
              {it}
            </span>
          </Reveal>
        ))}
      </div>
    </div>
  );

  return (
    <AbsoluteFill>
      <Backdrop />
      <AbsoluteFill style={{ justifyContent: "center" }}>
        <Shell style={{ gap: 1.8 * u }}>
          <Reveal delay={0}>
            <div
              style={{
                fontFamily: PIXEL,
                fontSize: 1.45 * u,
                letterSpacing: 0.16 * u,
                color: C.neon,
                textShadow: GLOW.neon,
              }}
            >
              NOT A ONE-WEEK MEME
            </div>
          </Reveal>

          <Reveal delay={4}>
            <h2
              style={{
                fontFamily: PIXEL,
                fontSize: (vertical ? 3.8 : 4.6) * u,
                lineHeight: 1.28,
                margin: 0,
                color: C.bone,
                textShadow: `${0.45 * u}px ${0.45 * u}px 0 ${C.woodDarker}`,
              }}
            >
              WHERE<br />THIS GOES
            </h2>
          </Reveal>

          <div
            style={{
              display: "flex",
              flexDirection: vertical ? "column" : "row",
              gap: 1.6 * u,
              marginTop: 0.8 * u,
            }}
          >
            {col("LIVE NOW", C.neon, LIVE, 12, C.neon)}
            {col("NEXT UP", C.goldHi, NEXT, 46, C.gold)}
          </div>

          <Reveal delay={70}>
            <p
              style={{
                fontFamily: MONO,
                fontSize: 2.5 * u,
                color: C.muted,
                margin: 0,
                lineHeight: 1.1,
              }}
            >
              No dates on anything we don&apos;t fully control. Every roadmap item is a debt
              someone comes to collect.
            </p>
          </Reveal>
        </Shell>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

/**
 * Вторая половина «долгосрока»: чем claim отличается от проверяемого факта и что мы
 * не построим никогда. Список «никогда» стоит рядом с планами не случайно — он и есть
 * граница проекта.
 */
export const Proof: React.FC = () => {
  const { u, vertical } = useLayout();

  return (
    <AbsoluteFill>
      <Backdrop tint="gold" />
      <AbsoluteFill style={{ justifyContent: "center" }}>
        <Shell style={{ gap: 1.8 * u }}>
          <Reveal delay={0}>
            <h2
              style={{
                fontFamily: PIXEL,
                fontSize: (vertical ? 3.4 : 4.2) * u,
                lineHeight: 1.28,
                margin: 0,
                color: C.goldHi,
                textShadow: `${0.45 * u}px ${0.45 * u}px 0 ${C.woodDarker}, ${GLOW.gold}`,
              }}
            >
              {PROOF.head}
            </h2>
          </Reveal>

          <Reveal delay={6}>
            <p
              style={{
                fontFamily: MONO,
                fontSize: 2.7 * u,
                color: C.muted,
                margin: 0,
                lineHeight: 1.1,
              }}
            >
              A claim you cannot check is worth nothing. So here is how each week gets
              checked instead of trusted:
            </p>
          </Reveal>

          <div style={{ display: "grid", gap: 1.1 * u, marginTop: 0.6 * u }}>
            {PROOF.items.map((it, i) => (
              <Reveal
                key={it}
                delay={14 + i * 10}
                style={{
                  display: "flex",
                  gap: 1.2 * u,
                  alignItems: "center",
                  border: `${0.3 * u}px solid ${C.woodDark}`,
                  background: "rgba(0,0,0,0.4)",
                  padding: `${1.1 * u}px ${1.4 * u}px`,
                }}
              >
                <span
                  style={{
                    fontFamily: PIXEL,
                    fontSize: 1.8 * u,
                    color: C.goldHi,
                    width: 3 * u,
                  }}
                >
                  0{i + 1}
                </span>
                <span
                  style={{
                    fontFamily: MONO,
                    fontSize: (vertical ? 2.7 : 2.5) * u,
                    color: C.bone,
                    lineHeight: 1.1,
                  }}
                >
                  {it}
                </span>
              </Reveal>
            ))}
          </div>

          <Reveal delay={52} style={{ marginTop: 1 * u }}>
            <div
              style={{
                border: `${0.35 * u}px solid ${C.rust}`,
                background: "rgba(60,12,6,0.35)",
                padding: `${1.3 * u}px ${1.5 * u}px`,
              }}
            >
              <div
                style={{
                  fontFamily: PIXEL,
                  fontSize: 1.6 * u,
                  color: C.rustHi,
                  marginBottom: 1 * u,
                  textShadow: GLOW.rust,
                }}
              >
                WHAT WE WILL NEVER BUILD
              </div>
              <div
                style={{
                  display: "flex",
                  flexWrap: "wrap",
                  gap: `${0.8 * u}px ${1.6 * u}px`,
                }}
              >
                {NEVER.map((n) => (
                  <span
                    key={n}
                    style={{
                      fontFamily: MONO,
                      fontSize: 2.5 * u,
                      color: C.bone,
                    }}
                  >
                    <span style={{ color: C.rustHi }}>✕</span> {n}
                  </span>
                ))}
              </div>
            </div>
          </Reveal>
        </Shell>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

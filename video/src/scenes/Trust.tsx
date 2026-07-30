import React from "react";
import { AbsoluteFill } from "remotion";
import { Backdrop } from "../components/Backdrop";
import { C, GLOW, MONO, PIXEL, Reveal, Shell } from "../components/ui";
import { useLayout } from "../layout";
import { TRUST } from "../copy";

/**
 * Секция доверия. Здесь важнее всего НЕ приукрасить: формулировки взяты с сайта
 * дословно, потому что каждая из них — обещание, за которое проект отвечает
 * («если это перестало быть правдой — это баг»).
 */
export const Trust: React.FC = () => {
  const { u, vertical } = useLayout();

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
              CRYPTO IS FULL OF THINGS THAT QUIETLY TAKE YOUR MONEY
            </div>
          </Reveal>

          <Reveal delay={5}>
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
              THIS ONE<br />DOES NOT
            </h2>
          </Reveal>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: vertical ? "1fr" : "1fr 1fr",
              gap: 1.4 * u,
              marginTop: 0.8 * u,
            }}
          >
            {TRUST.map((t, i) => (
              <Reveal
                key={t.h}
                delay={14 + i * 10}
                style={{
                  border: `${0.35 * u}px solid ${C.woodDarker}`,
                  background: "rgba(0,0,0,0.42)",
                  padding: `${1.4 * u}px ${1.5 * u}px`,
                  display: "flex",
                  gap: 1.2 * u,
                  alignItems: "flex-start",
                }}
              >
                {/* галочка вместо иконки: пиксельный «чек» из двух прямоугольников */}
                <div
                  style={{
                    flexShrink: 0,
                    width: 2.4 * u,
                    height: 2.4 * u,
                    display: "grid",
                    placeItems: "center",
                    border: `${0.3 * u}px solid ${C.neon}`,
                    color: C.neon,
                    fontFamily: PIXEL,
                    fontSize: 1.2 * u,
                    boxShadow: GLOW.neon,
                  }}
                >
                  ✓
                </div>
                <div>
                  <div
                    style={{
                      fontFamily: PIXEL,
                      fontSize: (vertical ? 1.6 : 1.55) * u,
                      lineHeight: 1.45,
                      color: C.neonHi,
                      marginBottom: 0.8 * u,
                    }}
                  >
                    {t.h}
                  </div>
                  <div
                    style={{
                      fontFamily: MONO,
                      fontSize: (vertical ? 2.6 : 2.35) * u,
                      lineHeight: 1.12,
                      color: C.bone,
                    }}
                  >
                    {t.d}
                  </div>
                </div>
              </Reveal>
            ))}
          </div>
        </Shell>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

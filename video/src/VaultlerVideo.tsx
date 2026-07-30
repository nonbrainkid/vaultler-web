import React from "react";
import { AbsoluteFill } from "remotion";
import { linearTiming, TransitionSeries } from "@remotion/transitions";
import { fade } from "@remotion/transitions/fade";
import { wipe } from "@remotion/transitions/wipe";
import { Hero } from "./scenes/Hero";
import { Vibe } from "./scenes/Vibe";
import { Step } from "./scenes/Step";
import { Ladder } from "./scenes/Ladder";
import { Pool } from "./scenes/Pool";
import { Trust } from "./scenes/Trust";
import { Proof, Roadmap } from "./scenes/Roadmap";
import { Outro } from "./scenes/Outro";
import { C } from "./theme";

/**
 * Порядок сцен = порядок вопросов, которые задаёт незнакомый человек:
 * что это → зачем → как играть → зачем токен → что я получу → можно ли доверять →
 * это надолго? → куда идти.
 *
 * Длительности подобраны под скорость чтения: примерно 2.5 слова в секунду для
 * абзаца в кадре плюс полсекунды на «вход» анимации.
 */
const TRANSITION = 15;

interface SceneDef {
  key: string;
  el: React.ReactNode;
  frames: number;
  /** Вытеснение вместо затухания — на смене «главы», чтобы монтаж не был монотонным. */
  wipeIn?: boolean;
}

export const SCENES: SceneDef[] = [
  { key: "hero", el: <Hero />, frames: 150 },
  { key: "vibe", el: <Vibe />, frames: 120, wipeIn: true },
  { key: "step-0", el: <Step index={0} />, frames: 110, wipeIn: true },
  { key: "step-1", el: <Step index={1} />, frames: 110 },
  { key: "step-2", el: <Step index={2} />, frames: 115 },
  { key: "step-3", el: <Step index={3} />, frames: 115 },
  { key: "ladder", el: <Ladder />, frames: 180, wipeIn: true },
  { key: "pool", el: <Pool />, frames: 210 },
  { key: "trust", el: <Trust />, frames: 190, wipeIn: true },
  { key: "roadmap", el: <Roadmap />, frames: 200 },
  { key: "proof", el: <Proof />, frames: 180 },
  { key: "outro", el: <Outro />, frames: 165, wipeIn: true },
];

/**
 * Итоговая длина. В `TransitionSeries` соседние сцены накладываются, поэтому каждый
 * переход СЪЕДАЕТ свою длительность из суммы — считаем это здесь, чтобы `Composition`
 * и монтаж не разъезжались (иначе в хвосте появляется чёрный кадр).
 */
export const TOTAL_FRAMES =
  SCENES.reduce((acc, s) => acc + s.frames, 0) - (SCENES.length - 1) * TRANSITION;

export const VaultlerVideo: React.FC = () => (
  <AbsoluteFill style={{ backgroundColor: C.void }}>
    <TransitionSeries>
      {SCENES.map((s, i) => (
        <React.Fragment key={s.key}>
          {/* Две отдельные ветки, а не тернарник в пропсе: presentation типизирован
              своим набором пропсов, и объединение wipe|fade не выводится. */}
          {i > 0 &&
            (s.wipeIn ? (
              <TransitionSeries.Transition
                presentation={wipe({ direction: "from-right" })}
                timing={linearTiming({ durationInFrames: TRANSITION })}
              />
            ) : (
              <TransitionSeries.Transition
                presentation={fade()}
                timing={linearTiming({ durationInFrames: TRANSITION })}
              />
            ))}
          <TransitionSeries.Sequence durationInFrames={s.frames}>
            {s.el}
          </TransitionSeries.Sequence>
        </React.Fragment>
      ))}
    </TransitionSeries>
  </AbsoluteFill>
);

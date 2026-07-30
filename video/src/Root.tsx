import React from "react";
import { Composition } from "remotion";
import { TOTAL_FRAMES, VaultlerVideo } from "./VaultlerVideo";

const FPS = 30;

/**
 * Три формата одной и той же нарезки: X/YouTube (16:9), Shorts/TikTok/Stories (9:16)
 * и лента (1:1). Вёрстка адаптируется сама (см. `layout.ts`), поэтому дублируется
 * только размер кадра — не сцены.
 */
export const RemotionRoot: React.FC = () => (
  <>
    <Composition
      id="VaultlerLandscape"
      component={VaultlerVideo}
      durationInFrames={TOTAL_FRAMES}
      fps={FPS}
      width={1920}
      height={1080}
    />
    <Composition
      id="VaultlerVertical"
      component={VaultlerVideo}
      durationInFrames={TOTAL_FRAMES}
      fps={FPS}
      width={1080}
      height={1920}
    />
    <Composition
      id="VaultlerSquare"
      component={VaultlerVideo}
      durationInFrames={TOTAL_FRAMES}
      fps={FPS}
      width={1080}
      height={1080}
    />
  </>
);

"use client";

import { useState } from "react";
import Vault from "../Vault";
import Leaderboard from "../Leaderboard";

/**
 * Обёртка игры и лидерборда: держит общий сигнал обновления, чтобы после кранка
 * борд перечитался. Это две разные секции страницы, но состояние у них общее.
 */
export default function GameSection() {
  const [lbKey, setLbKey] = useState(0);

  return (
    <>
      <section className="section" id="game">
        <div className="shell">
          <h2 className="section-title">THE MACHINE</h2>
          <p className="section-lead">
            Server-authoritative: your stack, streak and timers live on our server, not in
            your browser. No, you cannot edit them in DevTools.
          </p>
          <Vault onStackChanged={() => setLbKey((k) => k + 1)} />
        </div>
      </section>

      <section className="section alt" id="board">
        <div className="shell">
          <h2 className="section-title">WEEKLY BOARD</h2>
          <p className="section-lead">
            Everyone stacking feeds the community vault. Top of the board splits the weekly
            pot from creator fees.
          </p>
          <Leaderboard refreshKey={lbKey} />
        </div>
      </section>
    </>
  );
}

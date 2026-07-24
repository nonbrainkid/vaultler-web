"use client";

import { useCallback, useState } from "react";
import Vault from "../Vault";
import Leaderboard from "../Leaderboard";

/**
 * Обёртка игры и лидерборда: держит общий сигнал обновления, чтобы после кранка
 * борд перечитался. Это две разные секции страницы, но состояние у них общее.
 */
export default function GameSection() {
  const [lbKey, setLbKey] = useState(0);
  // Ранг считает сервер (в /api/leaderboard). Держим его здесь и отдаём в игру —
  // от него зависит скин сейфа, так не нужен тяжёлый пересчёт на каждый опрос.
  const [rank, setRank] = useState<number | null>(null);
  const [players, setPlayers] = useState(0);
  const handleRank = useCallback((r: number | null, p: number) => {
    setRank(r);
    setPlayers(p);
  }, []);

  return (
    <>
      <section className="section" id="game">
        <div className="shell">
          <h2 className="section-title">THE MACHINE</h2>
          <p className="section-lead">
            Server-authoritative: your stack, streak and timers live on our server, not in
            your browser. No, you cannot edit them in DevTools.
          </p>
          <Vault
            rank={rank}
            players={players}
            onStackChanged={() => setLbKey((k) => k + 1)}
          />
        </div>
      </section>

      <section className="section alt" id="board">
        <div className="shell">
          <h2 className="section-title">WEEKLY BOARD</h2>
          <p className="section-lead">
            Everyone stacking feeds the community vault. The <b>top 10</b> split the weekly
            pool — half of the token&apos;s trading fees, paid in real tokens.
          </p>
          <Leaderboard refreshKey={lbKey} onRank={handleRank} />
        </div>
      </section>
    </>
  );
}

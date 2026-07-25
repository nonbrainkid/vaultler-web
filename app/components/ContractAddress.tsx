"use client";

import { useRef, useState } from "react";
import { VLTR_ADDRESS, robinhoodChain } from "@/lib/chain";

/**
 * Адрес контракта $VLTR с кнопкой копирования.
 *
 * Адрес берётся из `lib/chain.ts` — ровно того же значения, по которому сервер читает
 * баланс для холдерского буста. Двух источников быть не должно: страница, рекламирующая
 * один контракт, пока приложение считает по другому, — это способ увести людей покупать
 * не тот токен.
 *
 * Полный адрес выводим целиком, без сокращения: сокращённый вид (`0x4CAe…7613`) невозможно
 * сверить с тем, что вставилось в кошелёк, — а именно так работает подмена буфера обмена.
 */
export default function ContractAddress() {
  const [state, setState] = useState<"idle" | "ok" | "fail">("idle");
  const addrRef = useRef<HTMLElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Адрес не сконфигурирован (или в env лежит мусор) — лучше не показать ничего,
  // чем показать неверное. См. комментарий к VLTR_ADDRESS.
  if (!VLTR_ADDRESS) return null;

  const explorer = robinhoodChain.blockExplorers?.default.url;

  const flash = (next: "ok" | "fail") => {
    setState(next);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setState("idle"), 1600);
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(VLTR_ADDRESS);
      flash("ok");
    } catch {
      // Буфер может быть недоступен (нет разрешения, http, встроенный браузер кошелька).
      // Тогда выделяем адрес — Ctrl+C работает всегда.
      const node = addrRef.current;
      if (node) {
        const range = document.createRange();
        range.selectNodeContents(node);
        const sel = window.getSelection();
        sel?.removeAllRanges();
        sel?.addRange(range);
      }
      flash("fail");
    }
  };

  return (
    <div className="ca">
      <div className="ca-head">
        <span className="ca-label">$VLTR CONTRACT</span>
        <span className="ca-chain">{robinhoodChain.name}</span>
      </div>

      <div className="ca-row">
        <code className="ca-addr" ref={addrRef}>
          {VLTR_ADDRESS}
        </code>
        <button
          className="btn btn-neon sm ca-copy"
          onClick={copy}
          aria-label="Copy the $VLTR contract address"
        >
          {state === "ok" ? "COPIED" : state === "fail" ? "SELECTED" : "COPY"}
        </button>
        {explorer && (
          <a
            className="btn btn-ghost sm"
            href={`${explorer}/address/${VLTR_ADDRESS}`}
            target="_blank"
            rel="noopener noreferrer"
          >
            EXPLORER
          </a>
        )}
      </div>

      <p className="ca-note" role={state === "fail" ? "status" : undefined}>
        {state === "fail"
          ? "Clipboard blocked by your browser — the address is selected, press Ctrl+C."
          : "Always verify the address before you buy. Compare it character by character with this page or our X — a copied address can be swapped by malware."}
      </p>
    </div>
  );
}

"use client";

import { useEffect, useState } from "react";

const ERRORS: Record<string, string> = {
  too_short: "at least 3 characters",
  too_long: "16 characters max",
  bad_chars: "letters, numbers and _ only",
  reserved: "that name is reserved",
  nickname_taken: "already taken",
  rate_limited: "slow down a moment",
  wallet_required: "connect a wallet first",
};

export default function ProfileEditor({
  nickname,
  hideWallet,
  onSaved,
}: {
  nickname: string | null;
  hideWallet: boolean;
  onSaved: () => void;
}) {
  const [value, setValue] = useState(nickname ?? "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState(false);

  // подхватываем ник, пришедший с сервера (после первого рендера/логина)
  useEffect(() => {
    setValue(nickname ?? "");
  }, [nickname]);

  async function post(body: Record<string, unknown>): Promise<boolean> {
    setBusy(true);
    setErr(null);
    setOk(false);
    try {
      const r = await fetch("/api/profile", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        setErr(ERRORS[d.error] ?? "could not save");
        return false;
      }
      onSaved();
      return true;
    } catch {
      setErr("network error");
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function saveNick() {
    if (value.trim() === (nickname ?? "")) return;
    const done = await post({ nickname: value.trim() });
    if (done) {
      setOk(true);
      setTimeout(() => setOk(false), 1500);
    }
  }

  async function toggleHide() {
    await post({ hideWallet: !hideWallet });
  }

  return (
    <div className="card profile">
      <h3 className="card-h neon">YOUR BOARD NAME</h3>

      <div className="nick-row">
        <input
          className="nick-input"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && saveNick()}
          maxLength={16}
          placeholder="pick a nickname"
          aria-label="nickname"
          spellCheck={false}
        />
        <button
          className="btn btn-neon"
          disabled={busy || value.trim() === (nickname ?? "")}
          onClick={saveNick}
        >
          {busy ? "…" : ok ? "✓" : "SAVE"}
        </button>
      </div>
      {err && <p className="nick-err">{err}</p>}

      <label className="hide-toggle">
        <input type="checkbox" checked={!hideWallet} disabled={busy} onChange={toggleHide} />
        <span>
          Show my wallet address on the board
          <em>
            {hideWallet
              ? "hidden — others can’t see or verify your address"
              : "public — anyone can inspect your on-chain history"}
          </em>
        </span>
      </label>
    </div>
  );
}

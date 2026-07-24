/**
 * Аудит безопасности перед пушем: проверяет, что наружу не уедет ничего лишнего.
 *
 * Смотрит и рабочее дерево, и ВСЮ историю — при пуше уходят все коммиты, а не только
 * текущее состояние, и секрет, удалённый в следующем коммите, всё равно останется в git.
 *
 *   npm run check:secrets
 *
 * Ненулевой код выхода = пушить нельзя.
 */
import { execFileSync } from "node:child_process";

const git = (...args) =>
  execFileSync("git", args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });

let failed = 0;
const fail = (msg) => {
  console.error(`  ✗ ${msg}`);
  failed++;
};
const ok = (msg) => console.log(`  ✓ ${msg}`);

// ── 1. Файлы, которых не должно быть в репозитории ни в одном коммите ──
const FORBIDDEN =
  /(^|\/)\.env($|\.(?!example))|(^|\/)\.data\/|node_modules\/|lib\/generated\/prisma\/|\.pem$|\.key$|(^|\/)id_rsa|\.pfx$|(^|\/)credentials(\.|$)/;

console.log("\n[1/4] Файлы в истории");
const everFiles = new Set(
  git("log", "--all", "--pretty=format:", "--name-only", "--diff-filter=A")
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean),
);
const badFiles = [...everFiles].filter((f) => FORBIDDEN.test(f));
badFiles.length
  ? badFiles.forEach((f) => fail(`в историю попал запретный файл: ${f}`))
  : ok(`проверено файлов: ${everFiles.size}, запретных нет`);

// ── 2. Секреты в содержимом всей истории ──
console.log("\n[2/4] Секреты в содержимом истории");
const SECRET_PATTERNS = [
  ["приватный ключ", /BEGIN [A-Z ]*PRIVATE KEY/],
  ["GitHub token", /gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}/],
  ["OpenAI/Anthropic key", /\b(sk|sk-ant)-[A-Za-z0-9_-]{20,}/],
  ["AWS key", /\bAKIA[0-9A-Z]{16}\b/],
  ["Slack token", /\bxox[baprs]-[A-Za-z0-9-]{10,}/],
  ["строка подключения с паролем", /\b(postgres(ql)?|mysql|mongodb(\+srv)?):\/\/[^\s"'/]+:[^\s"'@]+@/],
  ["приватный ключ EVM (0x + 64 hex)", /\b0x[a-fA-F0-9]{64}\b/],
  ["WalletConnect projectId", /projectId\s*[:=]\s*["'][a-f0-9]{32}["']/],
];

const commits = git("rev-list", "--all").split("\n").filter(Boolean);
const hits = [];
for (const c of commits) {
  let blob;
  try {
    blob = git("grep", "-InE", SECRET_PATTERNS.map(([, r]) => r.source).join("|"), c);
  } catch {
    continue; // git grep выходит с 1, когда совпадений нет
  }
  for (const line of blob.split("\n")) {
    if (!line.trim()) continue;
    if (/placeholder|example|dev-insecure|EXAMPLE/i.test(line)) continue;
    const label = SECRET_PATTERNS.find(([, r]) => r.test(line))?.[0] ?? "секрет";
    hits.push(`${label}: ${line.slice(0, 140)}`);
  }
}
hits.length
  ? [...new Set(hits)].forEach((h) => fail(h))
  : ok(`просмотрено коммитов: ${commits.length}, секретов нет`);

// ── 3. Незакоммиченные/неотслеживаемые файлы, которые могли бы утечь ──
console.log("\n[3/4] Рабочее дерево");
const untracked = git("status", "--porcelain", "--untracked-files=all")
  .split("\n")
  .filter((l) => l.startsWith("??"))
  .map((l) => l.slice(3).trim());
const riskyUntracked = untracked.filter((f) => FORBIDDEN.test(f));
riskyUntracked.length
  ? riskyUntracked.forEach((f) =>
      fail(`не игнорируется и не отслеживается — проверь .gitignore: ${f}`),
    )
  : ok("чувствительных неотслеживаемых файлов нет");

// ── 4. .gitignore покрывает обязательное ──
console.log("\n[4/4] Покрытие .gitignore");
for (const p of [".env.local", ".data/players.json", "node_modules/x", "lib/generated/prisma/index.js"]) {
  try {
    git("check-ignore", "-q", p);
    ok(`игнорируется: ${p}`);
  } catch {
    fail(`НЕ игнорируется: ${p}`);
  }
}

console.log(
  failed === 0
    ? "\n✅ Аудит пройден — пушить безопасно.\n"
    : `\n❌ Аудит провален (${failed}). Пушить НЕЛЬЗЯ, пока не исправлено.\n`,
);
process.exit(failed === 0 ? 0 : 1);

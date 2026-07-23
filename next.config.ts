import type { NextConfig } from "next";

// Базовые security-заголовки. CSP пока не жёсткий (не ломаем инъектированный кошелёк
// и RPC-соединения); строгий CSP с allowlist RPC/WalletConnect — в бэклоге (NOTES.md).
const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains; preload",
  },
];

const nextConfig: NextConfig = {
  // Prisma-клиент не бандлим в серверные функции — грузим как внешний пакет
  // (иначе Next тащит нативный движок в бандл; важно и для Vercel serverless).
  serverExternalPackages: ["@prisma/client", ".prisma/client"],
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;

import type { NextConfig } from "next";

// Базовые security-заголовки. Сам CSP живёт НЕ здесь, а в proxy.ts: он строгий и
// требует per-request nonce, который статический конфиг выдать не может (docs/security.md).
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

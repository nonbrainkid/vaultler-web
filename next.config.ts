import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Prisma-клиент не бандлим в серверные функции — грузим как внешний пакет
  // (иначе Next тащит нативный движок в бандл; важно и для Vercel serverless).
  serverExternalPackages: ["@prisma/client", ".prisma/client"],
};

export default nextConfig;

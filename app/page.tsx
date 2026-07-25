import SiteHeader from "./components/SiteHeader";
import Hero from "./components/Hero";
import HowItWorks from "./components/HowItWorks";
import GameSection from "./components/GameSection";
import TokenSection from "./components/TokenSection";
import TrustSection from "./components/TrustSection";
import Faq from "./components/Faq";
import SiteFooter from "./components/SiteFooter";
import { holderLadder } from "@/lib/game";

// Динамический рендер: нужен для per-request nonce в строгом CSP (статический HTML
// собирается один раз и nonce получить не может). Страница лёгкая, стоимость мала.
export const dynamic = "force-dynamic";

export default function Home() {
  return (
    <>
      <SiteHeader />
      <main id="main">
        <Hero />
        <HowItWorks />
        {/* Лестница холда статична — отдаём её пропсом с сервера, чтобы клиент не тянул
            игровой модуль в бандл и не получал её заново с каждым поллингом. */}
        <GameSection ladder={holderLadder()} />
        <TokenSection />
        <TrustSection />
        <Faq />
      </main>
      <SiteFooter />
    </>
  );
}

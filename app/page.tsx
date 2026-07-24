import SiteHeader from "./components/SiteHeader";
import Hero from "./components/Hero";
import HowItWorks from "./components/HowItWorks";
import GameSection from "./components/GameSection";
import TokenSection from "./components/TokenSection";
import TrustSection from "./components/TrustSection";
import Faq from "./components/Faq";
import SiteFooter from "./components/SiteFooter";

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
        <GameSection />
        <TokenSection />
        <TrustSection />
        <Faq />
      </main>
      <SiteFooter />
    </>
  );
}

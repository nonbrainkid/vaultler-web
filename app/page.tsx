import SiteHeader from "./components/SiteHeader";
import Hero from "./components/Hero";
import HowItWorks from "./components/HowItWorks";
import GameSection from "./components/GameSection";
import TokenSection from "./components/TokenSection";
import TrustSection from "./components/TrustSection";
import Faq from "./components/Faq";
import SiteFooter from "./components/SiteFooter";

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

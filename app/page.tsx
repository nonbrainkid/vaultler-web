import SiteHeader from "./components/SiteHeader";
import Hero from "./components/Hero";
import HowItWorks from "./components/HowItWorks";
import GameSection from "./components/GameSection";
import TokenSection from "./components/TokenSection";
import SiteFooter from "./components/SiteFooter";

export default function Home() {
  return (
    <>
      <SiteHeader />
      <main>
        <Hero />
        <HowItWorks />
        <GameSection />
        <TokenSection />
      </main>
      <SiteFooter />
    </>
  );
}

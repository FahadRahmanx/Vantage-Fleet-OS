import Nav from "./Nav";
import Hero from "./Hero";
import ProblemSection from "./ProblemSection";
import WorkflowSection from "./WorkflowSection";
import AuditSection from "./AuditSection";
import RolesSection from "./RolesSection";
import CTASection from "./CTASection";
import Footer from "./Footer";

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-white font-sans text-ink">
      <Nav />
      <Hero />
      <ProblemSection />
      <WorkflowSection />
      <AuditSection />
      <RolesSection />
      <CTASection />
      <Footer />
    </div>
  );
}

export default function Hero() {
  return (
    <section className="border-b border-rule overflow-hidden">
      <div className="max-w-[1440px] mx-auto grid grid-cols-1 lg:grid-cols-[1fr_480px] xl:grid-cols-[1fr_560px]">

        {/* Copy */}
        <div className="bg-white px-5 sm:px-8 lg:px-12 xl:px-16 py-14 lg:py-24 flex flex-col justify-center">
          <div className="flex items-center gap-2.5 mb-6 lg:mb-8">
            <div className="w-8 h-px bg-accent" />
            <span className="font-sans text-[10px] uppercase tracking-[0.2em] text-accent">Fleet Operations Platform</span>
          </div>

          <h1 className="font-display text-[clamp(2rem,5vw,3.6rem)] leading-[1.07] text-ink mb-5 lg:mb-6 font-normal max-w-[500px]">
            Your dispatch workflow isn't fixed code. It's configurable data.
          </h1>

          <p className="font-sans text-base lg:text-lg text-muted leading-relaxed mb-8 lg:mb-10 max-w-[420px]">
            Define every status, every allowed transition, and every required field in the admin panel. When your SOPs change, your workflow changes in minutes.
          </p>

          <div className="flex flex-col sm:flex-row items-stretch sm:items-start gap-3">
            <a href="#" className="font-sans text-sm px-6 py-3 bg-accent text-white hover:bg-accent-deep transition-colors text-center sm:text-left" style={{ borderRadius: '2px' }}>
              Schedule a product walkthrough
            </a>
            <a href="#" className="font-sans text-sm px-6 py-3 border border-panel-border text-ink hover:border-muted transition-colors text-center sm:text-left" style={{ borderRadius: '2px' }}>
              How the audit trail works
            </a>
          </div>
        </div>

        {/* Photo */}
        <div className="relative bg-ink overflow-hidden h-64 sm:h-80 lg:h-auto" style={{ minHeight: '0' }}>
          <img
            src="https://images.unsplash.com/photo-1565891741441-64926e441838?w=700&h=760&fit=crop&auto=format"
            alt="Aerial view of a fleet vehicle yard"
            className="absolute inset-0 w-full h-full object-cover"
          />
          <div className="absolute inset-0" style={{ background: 'linear-gradient(to right, rgba(255,255,255,0.06) 0%, transparent 60%)' }} />
        </div>

      </div>
    </section>
  )
}

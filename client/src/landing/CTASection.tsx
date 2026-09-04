import { Link } from 'react-router-dom'

export default function CTASection() {
  return (
    <section className="relative overflow-hidden bg-ink py-16 lg:py-28">
      <img
        src="https://images.unsplash.com/photo-1592838064575-70ed626d3a0e?w=1440&h=600&fit=crop&auto=format"
        alt="Truck on open road"
        className="absolute inset-0 w-full h-full object-cover"
        style={{ opacity: 0.18 }}
      />
      <div className="absolute inset-0" style={{ background: 'linear-gradient(to right, #1f2430 60%, transparent 100%)' }} />
      <div className="relative max-w-[1440px] mx-auto px-5 sm:px-8 lg:px-12 xl:px-16">
        <div className="max-w-[620px]">
          <h2 className="font-display text-[clamp(1.75rem,4vw,3rem)] leading-[1.1] text-white mb-5 font-normal">
            Your operation runs on real workflow states.{' '}
            <span style={{ color: '#9aa3b0' }}>Your software should too.</span>
          </h2>
          <p className="font-sans text-base mb-8 leading-relaxed" style={{ color: '#9aa3b0' }}>
            Talk to someone who has dispatched trucks, not a sales deck.
          </p>
          <div className="flex flex-col sm:flex-row items-stretch sm:items-start gap-3">
            <Link to="/login" className="font-sans text-sm font-medium px-6 py-3 bg-white text-ink hover:bg-surface transition-colors text-center sm:text-left" style={{ borderRadius: '2px' }}>
              Sign in to the live demo
            </Link>
            <a href="#workflow" className="font-sans text-sm px-6 py-3 border text-muted-inverse hover:text-white hover:border-muted transition-colors text-center sm:text-left" style={{ borderColor: '#3a4255', borderRadius: '2px' }}>
              See the workflow engine
            </a>
          </div>
        </div>
      </div>
    </section>
  )
}

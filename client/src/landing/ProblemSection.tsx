export default function ProblemSection() {
  return (
    <section className="border-b border-rule">
      <div className="max-w-[1440px] mx-auto grid grid-cols-1 lg:grid-cols-2">

        <div className="bg-ink px-5 sm:px-8 lg:px-10 xl:px-16 py-14 lg:py-20 flex flex-col justify-center">
          <div className="flex items-center gap-2.5 mb-6 lg:mb-8">
            <div className="w-5 h-px bg-rust" />
            <span className="font-sans text-[10px] uppercase tracking-[0.2em] text-rust">The problem</span>
          </div>
          <h2 className="font-display text-[clamp(1.6rem,3vw,2.5rem)] leading-[1.15] text-white font-normal mb-5">
            A status change nobody can explain is a compliance liability.
          </h2>
          <p className="font-sans text-sm leading-relaxed mb-4" style={{ color: '#9aa3b0' }}>
            Without a real audit trail, every disputed delivery and every status revert lives in someone's memory. At audit time, memory isn't a document.
          </p>
          <p className="font-sans text-sm leading-relaxed" style={{ color: '#5b6270' }}>
            Most TMS software hardcodes its workflow. When your SOPs change, you wait for a vendor sprint that may never ship.
          </p>
        </div>

        <div className="relative bg-ink overflow-hidden h-56 sm:h-72 lg:h-auto" style={{ minHeight: '0' }}>
          <img
            src="https://images.unsplash.com/photo-1592805144716-feeccccef5ac?w=800&h=700&fit=crop&auto=format"
            alt="Semi truck on highway at dusk"
            className="absolute inset-0 w-full h-full object-cover"
            style={{ opacity: 0.65 }}
          />
          <div className="absolute inset-0 hidden lg:block" style={{ background: 'linear-gradient(to right, #071a24 0%, transparent 50%)' }} />
        </div>
      </div>
    </section>
  )
}

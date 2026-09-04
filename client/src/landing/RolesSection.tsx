export default function RolesSection() {
  return (
    <section className="bg-white py-14 lg:py-20 border-b border-rule">
      <div className="max-w-[1440px] mx-auto px-5 sm:px-8 lg:px-12 xl:px-16">

        <div className="mb-8 lg:mb-10">
          <div className="flex items-center gap-2.5 mb-4">
            <div className="w-8 h-px bg-ink" />
            <span className="font-sans text-[10px] uppercase tracking-[0.2em] text-muted">Role access</span>
          </div>
          <h2 className="font-display text-[clamp(1.6rem,3vw,2.4rem)] font-normal text-ink">
            Six roles. One source of truth.
          </h2>
        </div>

        {/* The full role set, matching the UserRole enum and the
            platform-admin flag layered on top of it. */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-px bg-rule border border-rule mb-4">
          {[
            ['Driver', 'Own loads, DVIR, hours'],
            ['Dispatcher', 'Loads, assignment, board'],
            ['Maintenance', 'Flagged and in-repair'],
            ['Compliance', 'Route review, finalize'],
            ['Fleet Admin', 'All of the above, config'],
            ['Platform Admin', 'Flag, not a role'],
          ].map(([role, scope]) => (
            <div key={role} className="bg-white px-3 py-3">
              <div className="font-sans text-[11px] font-semibold text-ink mb-0.5">{role}</div>
              <div className="font-sans text-[10px] text-muted leading-snug">{scope}</div>
            </div>
          ))}
        </div>

        {/* Mobile: stacked cards. Desktop: mosaic */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">

          {/* Dispatcher */}
          <div className="relative overflow-hidden bg-ink" style={{ minHeight: '320px' }}>
            <img
              src="https://images.unsplash.com/photo-1586528116022-aeda1613c63d?w=760&h=620&fit=crop&auto=format"
              alt="Warehouse operations team"
              className="absolute inset-0 w-full h-full object-cover"
              style={{ opacity: 0.6 }}
            />
            <div className="absolute inset-0" style={{ background: 'linear-gradient(to top, #1f2430 30%, rgba(31,36,48,0.3) 70%, transparent 100%)' }} />
            <div className="absolute bottom-0 left-0 right-0 p-6 lg:p-8">
              <div className="font-mono text-[9px] text-accent uppercase tracking-[0.18em] mb-2">Dispatcher</div>
              <h3 className="font-display text-xl lg:text-2xl text-white font-normal mb-2">
                See every load's position. Act without a phone call.
              </h3>
              <p className="font-sans text-sm leading-relaxed" style={{ color: '#9aa3b0' }}>
                Advance a load, assign a carrier, flag a hold. Every action logs itself with your name and timestamp.
              </p>
            </div>
          </div>

          {/* Fleet Admin + Owner-Operator */}
          <div className="flex flex-col gap-4">
            <div className="relative overflow-hidden bg-ink" style={{ minHeight: '220px' }}>
              <img
                src="https://images.unsplash.com/photo-1778016193071-c841d6a2fc6a?w=760&h=320&fit=crop&auto=format"
                alt="Fleet truck yard"
                className="absolute inset-0 w-full h-full object-cover"
                style={{ opacity: 0.55 }}
              />
              <div className="absolute inset-0" style={{ background: 'linear-gradient(to top, #1f2430 35%, rgba(31,36,48,0.25) 70%, transparent 100%)' }} />
              <div className="absolute bottom-0 left-0 right-0 p-5 lg:p-6">
                <div className="font-mono text-[9px] text-muted-inverse uppercase tracking-[0.18em] mb-2">Fleet Admin</div>
                <h3 className="font-display text-lg lg:text-xl text-white font-normal mb-1.5">
                  Configure the workflow. Set the rules.
                </h3>
                <p className="font-sans text-sm leading-relaxed" style={{ color: '#9aa3b0' }}>
                  Add states, require written reasons on reversals, lock moves to admin-only.
                </p>
              </div>
            </div>

            <div className="relative overflow-hidden bg-ink" style={{ minHeight: '220px' }}>
              <img
                src="https://images.unsplash.com/photo-1574757974346-45bae947d89a?w=760&h=320&fit=crop&auto=format"
                alt="Owner-operator driver with truck"
                className="absolute inset-0 w-full h-full object-cover"
                style={{ opacity: 0.55 }}
              />
              <div className="absolute inset-0" style={{ background: 'linear-gradient(to top, #1f2430 35%, rgba(31,36,48,0.25) 70%, transparent 100%)' }} />
              <div className="absolute bottom-0 left-0 right-0 p-5 lg:p-6">
                <div className="font-mono text-[9px] text-accent uppercase tracking-[0.18em] mb-2">Owner-Operator</div>
                <h3 className="font-display text-lg lg:text-xl text-white font-normal mb-1.5">
                  Your loads. Nothing else visible.
                </h3>
                <p className="font-sans text-sm leading-relaxed" style={{ color: '#9aa3b0' }}>
                  Company-scoped access enforced at the data layer, not just the UI.
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}

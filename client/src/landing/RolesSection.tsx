export default function RolesSection() {
  return (
    <section id="roles" className="bg-white py-14 lg:py-20 border-b border-rule">
      <div className="max-w-[1440px] mx-auto px-5 sm:px-8 lg:px-12 xl:px-16">

        <div className="mb-8 lg:mb-10">
          <div className="flex items-center gap-2.5 mb-4">
            <div className="w-8 h-px bg-ink" />
            <span className="font-sans text-[10px] uppercase tracking-[0.2em] text-muted">Role access</span>
          </div>
          <h2 className="font-display text-[clamp(1.6rem,3vw,2.4rem)] font-normal text-ink">
            Six roles. One source of truth.
          </h2>
          <p className="font-sans text-base text-muted leading-relaxed max-w-[560px] mt-4">
            Five roles plus a platform-admin flag that layers on top of any of them.
            Scoping is enforced in the query layer, so what a role cannot reach is
            not merely hidden from its screens.
          </p>
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
            <div className="absolute inset-0" style={{ background: 'linear-gradient(to top, #071a24 30%, rgba(7,26,36,0.3) 70%, transparent 100%)' }} />
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
              <div className="absolute inset-0" style={{ background: 'linear-gradient(to top, #071a24 35%, rgba(7,26,36,0.25) 70%, transparent 100%)' }} />
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
              <div className="absolute inset-0" style={{ background: 'linear-gradient(to top, #071a24 35%, rgba(7,26,36,0.25) 70%, transparent 100%)' }} />
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

        {/* The three roles the mosaic does not picture, in the same dark
            treatment so they read as part of the composition. */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mt-4">
          {[
            ['Maintenance Technician', 'Triages flagged vehicles, claims repairs, signs them off. No dispatch board.'],
            ['Compliance Officer', 'Reviews finished routes against inspections and hours. Blocked from dispatch writes.'],
            ['Platform Admin', 'A flag layered on any role, not a sixth role. Bypasses role gating, never company scoping.'],
          ].map(([role, desc]) => (
            <div key={role} className="bg-ink p-5 lg:p-6 flex flex-col justify-end" style={{ minHeight: '150px' }}>
              <div className="font-mono text-[9px] text-muted-inverse uppercase tracking-[0.18em] mb-2">{role}</div>
              <p className="font-sans text-sm leading-relaxed" style={{ color: '#9aa3b0' }}>{desc}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

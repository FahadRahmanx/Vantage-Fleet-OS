import { useState } from 'react'

// ─── Status system ────────────────────────────────────────────────────────────

type Status = 'PENDING' | 'ASSIGNED' | 'DISPATCHED' | 'IN TRANSIT' | 'DELIVERED' | 'INVOICED'

const STATUS_STYLE: Record<Status, { bg: string; text: string; border: string }> = {
  PENDING:      { bg: '#f5f7fa', text: '#5b6270', border: '#c8cdd4' },
  ASSIGNED:     { bg: '#e8f0f8', text: '#2b5d8c', border: '#92aeca' },
  DISPATCHED:   { bg: '#d8e8f4', text: '#1e4266', border: '#2b5d8c' },
  'IN TRANSIT': { bg: '#1f2430', text: '#ffffff', border: '#1f2430' },
  DELIVERED:    { bg: '#eaf2ea', text: '#1f5c1f', border: '#5a9e5a' },
  INVOICED:     { bg: '#f5f7fa', text: '#5b6270', border: '#b0b7c2' },
}

const TRANSITIONS: Record<Status, Status[]> = {
  PENDING:      ['ASSIGNED'],
  ASSIGNED:     ['DISPATCHED', 'PENDING'],
  DISPATCHED:   ['IN TRANSIT', 'ASSIGNED'],
  'IN TRANSIT': ['DELIVERED', 'DISPATCHED'],
  DELIVERED:    ['INVOICED'],
  INVOICED:     [],
}

const TRANSITION_RULES: Partial<Record<string, string>> = {
  'DISPATCHED→IN TRANSIT': 'Driver · reason required',
  'IN TRANSIT→DISPATCHED': 'Admin only · reason required',
  'IN TRANSIT→DELIVERED':  'Driver or dispatcher',
  'ASSIGNED→PENDING':      'Any dispatcher',
  'DELIVERED→INVOICED':    'Fleet admin',
}

function Badge({ status, size = 'sm' }: { status: Status; size?: 'xs' | 'sm' }) {
  const s = STATUS_STYLE[status]
  return (
    <span
      className={`font-mono border ${size === 'xs' ? 'text-[9px] px-1.5 py-0.5' : 'text-[10px] px-2 py-1'}`}
      style={{ backgroundColor: s.bg, color: s.text, borderColor: s.border }}
    >
      {status}
    </span>
  )
}

// ─── Nav ──────────────────────────────────────────────────────────────────────

function Nav() {
  const [open, setOpen] = useState(false)
  const links = ['Workflow', 'Compliance', 'Dispatch', 'Partners']

  return (
    <nav className="sticky top-0 z-50 bg-white border-b border-rule">
      <div className="max-w-[1440px] mx-auto px-5 lg:px-12 xl:px-16 flex items-center justify-between h-14">
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 bg-accent flex items-center justify-center" style={{ borderRadius: '2px' }}>
            <span className="text-white text-sm font-bold font-display leading-none">V</span>
          </div>
          <span className="font-sans text-sm font-semibold text-ink tracking-tight">Vantage Fleet OS</span>
        </div>

        {/* Desktop links */}
        <div className="hidden md:flex items-center gap-8">
          {links.map((item) => (
            <a key={item} href="#" className="font-sans text-sm text-muted hover:text-ink transition-colors">{item}</a>
          ))}
        </div>

        <div className="flex items-center gap-3">
          <a href="#" className="hidden md:block font-sans text-sm text-muted hover:text-ink transition-colors">Sign in</a>
          <a href="#" className="font-sans text-sm px-4 py-2 bg-accent text-white hover:bg-accent-deep transition-colors" style={{ borderRadius: '2px' }}>
            Request demo
          </a>
          {/* Hamburger */}
          <button
            onClick={() => setOpen((v) => !v)}
            className="md:hidden flex flex-col justify-center items-center w-8 h-8 gap-1.5"
            aria-label="Toggle menu"
          >
            <span className={`block w-5 h-px bg-ink transition-all duration-200 ${open ? 'rotate-45 translate-y-[5px]' : ''}`} />
            <span className={`block w-5 h-px bg-ink transition-all duration-200 ${open ? 'opacity-0' : ''}`} />
            <span className={`block w-5 h-px bg-ink transition-all duration-200 ${open ? '-rotate-45 -translate-y-[5px]' : ''}`} />
          </button>
        </div>
      </div>

      {/* Mobile menu */}
      {open && (
        <div className="md:hidden bg-white border-t border-rule px-5 py-4 flex flex-col gap-1">
          {links.map((item) => (
            <a key={item} href="#" onClick={() => setOpen(false)}
              className="font-sans text-sm text-ink py-2.5 border-b border-rule-light last:border-0">
              {item}
            </a>
          ))}
          <a href="#" className="font-sans text-sm text-muted pt-3">Sign in</a>
        </div>
      )}
    </nav>
  )
}

// ─── 1. Hero ──────────────────────────────────────────────────────────────────

function Hero() {
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

// ─── 2. Problem ───────────────────────────────────────────────────────────────

function ProblemSection() {
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
          <div className="absolute inset-0 hidden lg:block" style={{ background: 'linear-gradient(to right, #1f2430 0%, transparent 50%)' }} />
        </div>
      </div>
    </section>
  )
}

// ─── 3. Workflow engine ───────────────────────────────────────────────────────

function WorkflowSection() {
  const allStates: Status[] = ['PENDING', 'ASSIGNED', 'DISPATCHED', 'IN TRANSIT', 'DELIVERED', 'INVOICED']
  const [selected, setSelected] = useState<Status | null>('DISPATCHED')

  return (
    <section className="bg-white py-14 lg:py-20 border-b border-rule">
      <div className="max-w-[1440px] mx-auto px-5 sm:px-8 lg:px-12 xl:px-16">

        <div className="grid grid-cols-1 lg:grid-cols-[1fr_380px] gap-8 lg:gap-16 mb-10 lg:mb-12">
          <div>
            <div className="flex items-center gap-2.5 mb-5 lg:mb-6">
              <div className="w-8 h-px bg-ink" />
              <span className="font-sans text-[10px] uppercase tracking-[0.2em] text-muted">Workflow engine</span>
            </div>
            <h2 className="font-display text-[clamp(1.6rem,3vw,2.8rem)] leading-[1.1] text-ink mb-4 lg:mb-5 font-normal max-w-[500px]">
              Statuses and transitions are records in a table, not logic buried in code.
            </h2>
            <p className="font-sans text-base text-muted leading-relaxed max-w-[460px]">
              Add a new load state in the admin panel. Require a written reason on specific transitions. Restrict reversals to admin-only. No deployment needed.
            </p>
          </div>

          <div className="lg:flex lg:items-end">
            <div className="w-full border border-rule bg-surface" style={{ borderRadius: '2px' }}>
              <div className="flex items-center justify-between px-4 py-2.5 border-b border-rule bg-white">
                <span className="font-sans text-[10px] uppercase tracking-[0.14em] text-muted">Admin · Transition rules</span>
                <span className="font-mono text-[9px] text-muted">v3.1</span>
              </div>
              <div className="divide-y divide-rule-light">
                {Object.entries(TRANSITION_RULES).map(([key, rule]) => (
                  <div key={key} className="flex items-center justify-between px-4 py-2.5 gap-4">
                    <span className="font-mono text-[10px] text-ink shrink-0">{key}</span>
                    <span className="font-sans text-[10px] text-right" style={{ color: rule?.includes('Admin') ? '#2b5d8c' : '#5b6270' }}>{rule}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        <div className="border border-panel-border" style={{ borderRadius: '2px' }}>
          <div className="flex items-center justify-between px-4 lg:px-5 py-3 bg-surface border-b border-rule">
            <span className="font-sans text-xs text-muted">Workflow: Standard Dispatch v3.1</span>
            <span className="font-mono text-[9px] text-muted hidden sm:block">Click a state to inspect</span>
          </div>

          <div className="p-4 lg:p-6 overflow-x-auto">
            <div className="flex items-center gap-0 min-w-max mb-6">
              {allStates.map((state, i) => {
                const isSelected = selected === state
                const isReachable = selected ? TRANSITIONS[selected].includes(state) : false
                const ss = STATUS_STYLE[state]
                return (
                  <div key={state} className="flex items-center">
                    <button
                      onClick={() => setSelected(isSelected ? null : state)}
                      className="font-mono text-[10px] px-2.5 lg:px-3 py-2 border transition-all duration-150"
                      style={{
                        backgroundColor: isSelected ? ss.bg : isReachable ? ss.bg + '80' : '#fff',
                        color: isSelected ? ss.text : isReachable ? ss.text : '#5b6270',
                        borderColor: isSelected ? ss.border : isReachable ? ss.border + '80' : '#d0d5dd',
                        outline: isSelected ? `2px solid ${ss.border}` : 'none',
                        outlineOffset: '2px',
                      }}>
                      {state}
                    </button>
                    {i < allStates.length - 1 && (
                      <div className="flex items-center mx-1 lg:mx-1.5">
                        <div className="w-4 lg:w-6 h-px bg-panel-border" />
                        <svg width="5" height="8" viewBox="0 0 5 8"><path d="M0 0L5 4L0 8Z" fill="#c8cdd4" /></svg>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>

            {selected ? (
              <div className="border-t border-rule pt-5 grid grid-cols-1 sm:grid-cols-3 gap-4 lg:gap-6">
                <div>
                  <div className="font-sans text-[9px] uppercase tracking-[0.16em] text-muted mb-2">State</div>
                  <Badge status={selected} />
                </div>
                <div>
                  <div className="font-sans text-[9px] uppercase tracking-[0.16em] text-muted mb-2">Transitions out</div>
                  {TRANSITIONS[selected].length > 0 ? (
                    <div className="flex flex-wrap gap-2">
                      {TRANSITIONS[selected].map((t) => (
                        <div key={t} className="flex items-center gap-1.5">
                          <Badge status={t} size="xs" />
                          {TRANSITION_RULES[`${selected}→${t}`] && (
                            <span className="font-sans text-[9px] text-muted hidden sm:inline">{TRANSITION_RULES[`${selected}→${t}`]}</span>
                          )}
                        </div>
                      ))}
                    </div>
                  ) : (
                    <span className="font-sans text-xs text-muted italic">Terminal state</span>
                  )}
                </div>
                <div>
                  <div className="font-sans text-[9px] uppercase tracking-[0.16em] text-muted mb-2">Who can trigger</div>
                  <span className="font-sans text-xs text-muted">
                    {selected === 'IN TRANSIT' ? 'Dispatcher or driver. Reversals: admin only.'
                      : selected === 'INVOICED' ? 'Terminal — no outbound.'
                      : 'Any authorized dispatcher or driver.'}
                  </span>
                </div>
              </div>
            ) : (
              <div className="border-t border-rule pt-4">
                <span className="font-sans text-xs text-muted italic">Select a state above to inspect transition rules.</span>
              </div>
            )}
          </div>
        </div>
      </div>
    </section>
  )
}

// ─── 4. Audit trail ───────────────────────────────────────────────────────────

const AUDIT_ENTRIES = [
  { ts: '2026-08-30 14:22', actor: 'R. Hollis',   role: 'Driver',      action: 'ADVANCE_STATUS',   entity: 'TK-4821',    from: 'DISPATCHED',  to: 'IN TRANSIT',              reason: 'Departed terminal, GPS confirmed.' },
  { ts: '2026-08-30 14:18', actor: 'S. Patel',    role: 'Fleet Admin', action: 'REVERT_STATUS',    entity: 'TK-4821',    from: 'IN TRANSIT',  to: 'DISPATCHED',              reason: 'Wrong manifest — reverted pending re-check.' },
  { ts: '2026-08-30 11:02', actor: 'M. Castillo', role: 'Dispatcher',  action: 'ASSIGN_CARRIER',   entity: 'TK-4819',    from: 'Unassigned',  to: 'Hollis Transport LLC',    reason: '' },
  { ts: '2026-08-30 09:55', actor: 'D. Nguyen',   role: 'Dispatcher',  action: 'CREATE_LOAD',      entity: 'TK-4820',    from: '',            to: 'PENDING',                 reason: '' },
  { ts: '2026-08-29 16:41', actor: 'S. Patel',    role: 'Fleet Admin', action: 'CONFIG_TRANSITION',entity: 'Workflow v3', from: '',           to: 'Added: DELIVERED → DISPUTED', reason: 'New SOP for contested deliveries.' },
]

const ACTION_COLOR: Record<string, string> = {
  ADVANCE_STATUS:   '#2b5d8c',
  REVERT_STATUS:    '#7a3b2e',
  ASSIGN_CARRIER:   '#1f2430',
  CREATE_LOAD:      '#1f5c1f',
  CONFIG_TRANSITION:'#4a3d8c',
}

function AuditSection() {
  return (
    <section className="bg-surface border-b border-rule py-14 lg:py-20">
      <div className="max-w-[1440px] mx-auto px-5 sm:px-8 lg:px-12 xl:px-16">

        <div className="grid grid-cols-1 lg:grid-cols-[340px_1fr] gap-8 lg:gap-16 mb-8 lg:mb-10">
          <div>
            <div className="flex items-center gap-2.5 mb-5 lg:mb-6">
              <div className="w-8 h-px bg-ink" />
              <span className="font-sans text-[10px] uppercase tracking-[0.2em] text-muted">Audit trail</span>
            </div>
            <h2 className="font-display text-[clamp(1.5rem,2.5vw,2.3rem)] leading-[1.15] text-ink mb-4 font-normal">
              Every action has an author, a timestamp, and a reason.
            </h2>
            <p className="font-sans text-sm text-muted leading-relaxed">
              The audit trail is the operating record. Immutable, append-only, and exportable for FMCSA review on demand.
            </p>
          </div>
          <div className="lg:flex lg:items-end">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-5 lg:gap-6 w-full">
              {[
                ['Immutable', 'No record can be edited after write.'],
                ['Actor-attributed', 'Every action tied to a named user.'],
                ['FMCSA-exportable', 'CSV and JSON, filtered by date or entity.'],
              ].map(([title, desc]) => (
                <div key={title} className="border-t border-ink pt-4">
                  <div className="font-sans text-xs font-semibold text-ink mb-1">{title}</div>
                  <div className="font-sans text-xs text-muted leading-snug">{desc}</div>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="overflow-x-auto border border-panel-border bg-white">
          <table className="w-full text-xs min-w-[640px]">
            <thead>
              <tr className="bg-surface border-b border-panel-border">
                {['Timestamp', 'Actor', 'Action', 'Entity', 'Change', 'Reason'].map((col) => (
                  <th key={col} className="text-left px-3 lg:px-4 py-3 font-mono text-[9px] text-muted uppercase tracking-[0.14em] font-normal whitespace-nowrap">
                    {col}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {AUDIT_ENTRIES.map((e, i) => (
                <tr key={i} className="border-b border-rule-light last:border-0 hover:bg-surface transition-colors">
                  <td className="px-3 lg:px-4 py-3 font-mono text-[10px] text-muted whitespace-nowrap">{e.ts}</td>
                  <td className="px-3 lg:px-4 py-3">
                    <div className="font-sans font-medium text-ink text-[11px]">{e.actor}</div>
                    <div className="font-sans text-[10px] text-muted">{e.role}</div>
                  </td>
                  <td className="px-3 lg:px-4 py-3 font-mono text-[10px] font-medium whitespace-nowrap" style={{ color: ACTION_COLOR[e.action] || '#1f2430' }}>
                    {e.action}
                  </td>
                  <td className="px-3 lg:px-4 py-3 font-mono text-[10px] text-ink whitespace-nowrap">{e.entity}</td>
                  <td className="px-3 lg:px-4 py-3 font-sans text-[11px] text-ink whitespace-nowrap">
                    {e.from
                      ? <><span className="text-muted">{e.from}</span><span className="text-muted mx-1">→</span><span className="font-medium">{e.to}</span></>
                      : <span className="font-medium">{e.to}</span>}
                  </td>
                  <td className="px-3 lg:px-4 py-3 font-sans text-[10px] text-muted max-w-[180px]">
                    <span className="line-clamp-1">{e.reason || '—'}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-2.5 font-sans text-[10px] text-muted">5 of 2,841 records · last 48 h</p>
      </div>
    </section>
  )
}

// ─── 5. Roles ─────────────────────────────────────────────────────────────────

function RolesSection() {
  return (
    <section className="bg-white py-14 lg:py-20 border-b border-rule">
      <div className="max-w-[1440px] mx-auto px-5 sm:px-8 lg:px-12 xl:px-16">

        <div className="mb-8 lg:mb-10">
          <div className="flex items-center gap-2.5 mb-4">
            <div className="w-8 h-px bg-ink" />
            <span className="font-sans text-[10px] uppercase tracking-[0.2em] text-muted">Role access</span>
          </div>
          <h2 className="font-display text-[clamp(1.6rem,3vw,2.4rem)] font-normal text-ink">
            Three roles. One source of truth.
          </h2>
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

// ─── 6. CTA ───────────────────────────────────────────────────────────────────

function CTASection() {
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
            <a href="#" className="font-sans text-sm font-medium px-6 py-3 bg-white text-ink hover:bg-surface transition-colors text-center sm:text-left" style={{ borderRadius: '2px' }}>
              Talk to a fleet implementation specialist
            </a>
            <a href="#" className="font-sans text-sm px-6 py-3 border text-muted-inverse hover:text-white hover:border-muted transition-colors text-center sm:text-left" style={{ borderColor: '#3a4255', borderRadius: '2px' }}>
              Read the compliance docs
            </a>
          </div>
        </div>
      </div>
    </section>
  )
}

// ─── Footer ───────────────────────────────────────────────────────────────────

function Footer() {
  return (
    <footer className="bg-ink border-t py-8" style={{ borderColor: '#2d3547' }}>
      <div className="max-w-[1440px] mx-auto px-5 sm:px-8 lg:px-12 xl:px-16 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div className="flex items-center gap-2.5">
          <div className="w-6 h-6 bg-accent flex items-center justify-center" style={{ borderRadius: '2px' }}>
            <span className="font-display text-white text-xs font-bold leading-none">V</span>
          </div>
          <span className="font-sans text-sm" style={{ color: '#9aa3b0' }}>Vantage Fleet OS</span>
        </div>
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
          {['Privacy', 'Terms', 'Security', 'FMCSA Compliance'].map((item) => (
            <a key={item} href="#" className="font-sans text-xs hover:text-muted-inverse transition-colors" style={{ color: '#5b6270' }}>{item}</a>
          ))}
        </div>
        <span className="font-sans text-xs" style={{ color: '#5b6270' }}>© 2026 Vantage Fleet OS</span>
      </div>
    </footer>
  )
}

// ─── Root ─────────────────────────────────────────────────────────────────────

export default function App() {
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
  )
}

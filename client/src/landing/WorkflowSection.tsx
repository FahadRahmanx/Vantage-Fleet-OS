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

export default function WorkflowSection() {
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

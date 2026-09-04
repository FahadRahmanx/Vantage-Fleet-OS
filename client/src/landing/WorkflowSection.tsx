import { useState } from 'react'

// ─── Status system ────────────────────────────────────────────────────────────
// Mirrors the seeded workflow exactly: same codes, same rank order, same
// colours and same role visibility the app serves from dispatch_statuses.
// If the workflow is reconfigured, update this to match.

type Status = 'Created' | 'Assigned' | 'In Transit' | 'Delivered' | 'Out of Service' | 'In Repair'

const STATUS_META: Record<Status, { color: string; position: number; roles: string[] }> = {
  'Created':        { color: '#666666', position: 0, roles: ['dispatcher', 'fleet_admin'] },
  'Assigned':       { color: '#856404', position: 1, roles: ['dispatcher', 'fleet_admin'] },
  'In Transit':     { color: '#004085', position: 2, roles: ['dispatcher', 'fleet_admin'] },
  'Delivered':      { color: '#00884b', position: 3, roles: ['dispatcher', 'fleet_admin', 'compliance_officer'] },
  'Out of Service': { color: '#ba1a1a', position: 1, roles: ['dispatcher', 'fleet_admin', 'maintenance_tech'] },
  'In Repair':      { color: '#a15c07', position: 1, roles: ['maintenance_tech', 'fleet_admin'] },
}

// Every configured edge, with the flags the engine actually reads.
const TRANSITIONS: Record<Status, { to: Status; note?: string }[]> = {
  'Created':        [{ to: 'Assigned', note: 'default target' }],
  'Assigned':       [{ to: 'In Transit', note: 'default · auto on DVIR pass' }, { to: 'Out of Service', note: 'auto on DVIR out-of-service' }],
  'In Transit':     [{ to: 'Delivered', note: 'default target' }, { to: 'Assigned', note: 'revert' }],
  'Delivered':      [{ to: 'Out of Service' }, { to: 'In Transit', note: 'revert' }],
  'Out of Service': [{ to: 'In Repair', note: 'default · claim for repair' }, { to: 'Created', note: 'revert' }],
  'In Repair':      [{ to: 'Created', note: 'default · repair complete' }],
}

const MAIN_LINE: Status[] = ['Created', 'Assigned', 'In Transit', 'Delivered']
const BRANCH: Status[] = ['Out of Service', 'In Repair']

function Badge({ status, size = 'sm' }: { status: Status; size?: 'xs' | 'sm' }) {
  const color = STATUS_META[status].color
  return (
    <span
      className={`font-mono border ${size === 'xs' ? 'text-[9px] px-1.5 py-0.5' : 'text-[10px] px-2 py-1'}`}
      style={{ backgroundColor: `${color}1f`, color, borderColor: `${color}66` }}
    >
      {status}
    </span>
  )
}

export default function WorkflowSection() {
  const [selected, setSelected] = useState<Status | null>('Assigned')

  const renderState = (state: Status) => {
    const isSelected = selected === state
    const isReachable = selected ? TRANSITIONS[selected].some((t) => t.to === state) : false
    const color = STATUS_META[state].color
    return (
      <button
        key={state}
        onClick={() => setSelected(isSelected ? null : state)}
        className="font-mono text-[10px] px-2.5 lg:px-3 py-2 border transition-all duration-150 whitespace-nowrap"
        style={{
          backgroundColor: isSelected ? `${color}1f` : isReachable ? `${color}12` : '#fff',
          color: isSelected || isReachable ? color : '#5b6270',
          borderColor: isSelected ? color : isReachable ? `${color}66` : '#d0d5dd',
          outline: isSelected ? `2px solid ${color}` : 'none',
          outlineOffset: '2px',
        }}>
        {state}
      </button>
    )
  }

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
              Add a load state in the admin panel. Choose which roles may move a load out of it. Point an inspection outcome at a branch. No deployment needed.
            </p>
          </div>

          <div className="lg:flex lg:items-end">
            <div className="w-full border border-rule bg-surface" style={{ borderRadius: '2px' }}>
              <div className="flex items-center justify-between px-4 py-2.5 border-b border-rule bg-white">
                <span className="font-sans text-[10px] uppercase tracking-[0.14em] text-muted">Admin · Outcome routing</span>
                <span className="font-mono text-[9px] text-muted">FR-28</span>
              </div>
              <div className="divide-y divide-rule-light">
                {[
                  ['pass', 'Assigned → In Transit'],
                  ['minor defect', 'configurable, no edge seeded'],
                  ['out of service', 'Assigned → Out of Service'],
                ].map(([outcome, target]) => (
                  <div key={outcome} className="flex items-center justify-between px-4 py-2.5 gap-4">
                    <span className="font-mono text-[10px] text-ink shrink-0">{outcome}</span>
                    <span className="font-sans text-[10px] text-right text-muted">{target}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        <div className="border border-panel-border" style={{ borderRadius: '2px' }}>
          <div className="flex items-center justify-between px-4 lg:px-5 py-3 bg-surface border-b border-rule">
            <span className="font-sans text-xs text-muted">Seeded workflow · 6 statuses, 10 transitions</span>
            <span className="font-mono text-[9px] text-muted hidden sm:block">Click a state to inspect</span>
          </div>

          <div className="p-4 lg:p-6 overflow-x-auto">
            <div className="flex items-center gap-0 min-w-max mb-3">
              {MAIN_LINE.map((state, i) => (
                <div key={state} className="flex items-center">
                  {renderState(state)}
                  {i < MAIN_LINE.length - 1 && (
                    <div className="flex items-center mx-1 lg:mx-1.5">
                      <div className="w-4 lg:w-6 h-px bg-panel-border" />
                      <svg width="5" height="8" viewBox="0 0 5 8"><path d="M0 0L5 4L0 8Z" fill="#c8cdd4" /></svg>
                    </div>
                  )}
                </div>
              ))}
            </div>

            <div className="flex items-center gap-2 min-w-max mb-6">
              <span className="font-sans text-[9px] uppercase tracking-[0.16em] text-muted mr-1">Maintenance branch</span>
              {BRANCH.map((state, i) => (
                <div key={state} className="flex items-center">
                  {renderState(state)}
                  {i < BRANCH.length - 1 && (
                    <div className="flex items-center mx-1 lg:mx-1.5">
                      <div className="w-4 lg:w-6 h-px bg-panel-border" />
                      <svg width="5" height="8" viewBox="0 0 5 8"><path d="M0 0L5 4L0 8Z" fill="#c8cdd4" /></svg>
                    </div>
                  )}
                </div>
              ))}
            </div>

            {selected ? (
              <div className="border-t border-rule pt-5 grid grid-cols-1 sm:grid-cols-3 gap-4 lg:gap-6">
                <div>
                  <div className="font-sans text-[9px] uppercase tracking-[0.16em] text-muted mb-2">State · rank {STATUS_META[selected].position}</div>
                  <Badge status={selected} />
                </div>
                <div>
                  <div className="font-sans text-[9px] uppercase tracking-[0.16em] text-muted mb-2">Transitions out</div>
                  <div className="flex flex-col gap-1.5">
                    {TRANSITIONS[selected].map(({ to, note }) => (
                      <div key={to} className="flex items-center gap-1.5">
                        <Badge status={to} size="xs" />
                        {note && <span className="font-sans text-[9px] text-muted">{note}</span>}
                      </div>
                    ))}
                  </div>
                </div>
                <div>
                  <div className="font-sans text-[9px] uppercase tracking-[0.16em] text-muted mb-2">Role visibility</div>
                  <span className="font-mono text-[10px] text-muted leading-relaxed">
                    {STATUS_META[selected].roles.join(', ')}
                  </span>
                  <div className="font-sans text-[9px] text-muted mt-1.5">Plus any platform admin.</div>
                </div>
              </div>
            ) : (
              <div className="border-t border-rule pt-4">
                <span className="font-sans text-xs text-muted italic">Select a state above to inspect its transitions and role visibility.</span>
              </div>
            )}
          </div>
        </div>
      </div>
    </section>
  )
}

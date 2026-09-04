import { useState, useEffect, useRef } from 'react'

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

// One full lifecycle, taking both branches, so the animation shows the
// engine deciding rather than a load walking a straight line.
const WALKTHROUGH: { status: Status; caption: string }[] = [
  { status: 'Created',        caption: 'Dispatcher creates VFO0000042. Editable only in this state.' },
  { status: 'Assigned',       caption: 'Driver and vehicle assigned. Eligibility gate runs server-side.' },
  { status: 'Out of Service', caption: 'Pre-trip inspection reports a brake failure. Routed automatically.' },
  { status: 'In Repair',      caption: 'Technician claims the vehicle from the maintenance board.' },
  { status: 'Created',        caption: 'Repair signed off. The load returns to the start of the flow.' },
  { status: 'Assigned',       caption: 'Reassigned. Eligibility and hours re-checked from the ledger.' },
  { status: 'In Transit',     caption: 'Pre-trip passes this time. Routed forward on the pass trigger.' },
  { status: 'Delivered',      caption: 'Post-trip captured. The route now queues for compliance review.' },
]

const STEP_MS = 2400

function Badge({ status, size = 'sm' }: { status: Status; size?: 'xs' | 'sm' }) {
  const color = STATUS_META[status].color
  return (
    <span
      className={`font-sans font-medium border ${size === 'xs' ? 'text-[11px] px-2 py-0.5' : 'text-[12px] px-2.5 py-1'}`}
      style={{ backgroundColor: `${color}1f`, color, borderColor: `${color}66` }}
    >
      {status}
    </span>
  )
}

export default function WorkflowSection() {
  const [step, setStep] = useState(0)
  const [playing, setPlaying] = useState(true)
  const [picked, setPicked] = useState<Status | null>(null)
  const timer = useRef<number | undefined>(undefined)

  // Autoplay, unless the visitor has taken over by clicking a state or has
  // asked for reduced motion.
  useEffect(() => {
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (!playing || reduced) return
    timer.current = window.setInterval(() => setStep((s) => (s + 1) % WALKTHROUGH.length), STEP_MS)
    return () => window.clearInterval(timer.current)
  }, [playing])

  const active = WALKTHROUGH[step]
  // The clicked state wins; otherwise the inspector follows the animation.
  const inspected: Status = picked ?? active.status

  const takeOver = (state: Status) => {
    setPlaying(false)
    setPicked((p) => (p === state ? null : state))
  }

  const resume = () => {
    setPicked(null)
    setPlaying(true)
  }

  const renderState = (state: Status) => {
    const isLive = !picked && state === active.status
    const isInspected = state === inspected
    const isReachable = TRANSITIONS[inspected].some((t) => t.to === state)
    const color = STATUS_META[state].color
    return (
      <button
        key={state}
        onClick={() => takeOver(state)}
        className="relative font-sans font-medium text-[12px] lg:text-[13px] px-3 lg:px-4 py-2.5 border transition-all duration-500 whitespace-nowrap"
        style={{
          backgroundColor: isInspected ? `${color}1f` : isReachable ? `${color}0f` : '#fff',
          color: isInspected || isReachable ? color : '#5b6270',
          borderColor: isInspected ? color : isReachable ? `${color}55` : '#d0d5dd',
          transform: isLive ? 'translateY(-2px)' : 'none',
          boxShadow: isLive ? `0 3px 0 -1px ${color}` : 'none',
        }}>
        {state}
      </button>
    )
  }

  const Connector = () => (
    <div className="flex items-center mx-1.5 lg:mx-2.5">
      <div className="w-5 lg:w-8 h-px bg-panel-border" />
      <svg width="5" height="8" viewBox="0 0 5 8"><path d="M0 0L5 4L0 8Z" fill="#c8cdd4" /></svg>
    </div>
  )

  return (
    <section className="landing-motion bg-white py-14 lg:py-20 border-b border-rule">
      <div className="max-w-[1440px] mx-auto px-5 sm:px-8 lg:px-12 xl:px-16">

        <div className="max-w-[620px] mb-10 lg:mb-12">
          <div className="flex items-center gap-2.5 mb-5 lg:mb-6">
            <div className="w-8 h-px bg-ink" />
            <span className="font-sans text-[10px] uppercase tracking-[0.2em] text-muted">Workflow engine</span>
          </div>
          <h2 className="font-display text-[clamp(1.6rem,3vw,2.8rem)] leading-[1.1] text-ink mb-4 lg:mb-5 font-normal">
            Statuses and transitions are records in a table, not logic buried in code.
          </h2>
          <p className="font-sans text-base text-muted leading-relaxed max-w-[500px]">
            Add a load state in the admin panel. Choose which roles may move a load out of it. Point an inspection outcome at a branch. No deployment needed.
          </p>
        </div>

        <div className="border border-panel-border" style={{ borderRadius: '2px' }}>
          <div className="flex items-center justify-between px-4 lg:px-6 py-3 bg-surface border-b border-rule">
            <span className="font-sans text-xs text-muted">Seeded workflow · 6 statuses, 10 transitions</span>
            <button
              onClick={playing ? () => setPlaying(false) : resume}
              className="font-sans text-[11px] text-muted hover:text-ink transition-colors">
              {playing && !picked ? '❙❙ pause' : '▶ play'}
            </button>
          </div>

          <div className="px-4 lg:px-8 py-6 lg:py-8 overflow-x-auto">
            {/* w-max plus mx-auto centres each row on its own width, which
                still scrolls rather than clipping on a narrow screen. */}
            <div className="flex items-center w-max mx-auto mb-4">
              {MAIN_LINE.map((state, i) => (
                <div key={state} className="flex items-center">
                  {renderState(state)}
                  {i < MAIN_LINE.length - 1 && <Connector />}
                </div>
              ))}
            </div>

            <div className="flex items-center gap-3 w-max mx-auto mb-7">
              <span className="font-sans text-[9px] uppercase tracking-[0.16em] text-muted">Maintenance branch</span>
              {BRANCH.map((state, i) => (
                <div key={state} className="flex items-center">
                  {renderState(state)}
                  {i < BRANCH.length - 1 && <Connector />}
                </div>
              ))}
            </div>

            {/* Narration for the current animation step. Fixed height so the
                layout does not jump as captions change length. */}
            <div className="border-t border-rule pt-5 mb-6 min-h-[52px]">
              {picked ? (
                <p className="font-sans text-sm text-muted italic text-center">
                  Inspecting {picked}. <button onClick={resume} className="text-ink underline underline-offset-2">Resume the walkthrough</button>
                </p>
              ) : (
                <div className="flex items-start justify-center gap-3">
                  <span className="font-sans text-[11px] text-muted pt-0.5 shrink-0 tabular-nums">{String(step + 1).padStart(2, '0')}/{WALKTHROUGH.length}</span>
                  <p key={step} className="font-sans text-sm lg:text-base text-ink leading-relaxed animate-[fadeIn_400ms_ease-out]">
                    {active.caption}
                  </p>
                </div>
              )}
            </div>

            <div className="border-t border-rule pt-5 grid grid-cols-1 sm:grid-cols-3 gap-5 lg:gap-8">
              <div>
                <div className="font-sans text-[9px] uppercase tracking-[0.16em] text-muted mb-2.5">State · rank {STATUS_META[inspected].position}</div>
                <Badge status={inspected} />
              </div>
              <div>
                <div className="font-sans text-[9px] uppercase tracking-[0.16em] text-muted mb-2.5">Transitions out</div>
                <div className="flex flex-col gap-2">
                  {TRANSITIONS[inspected].map(({ to, note }) => (
                    <div key={to} className="flex items-center gap-2 flex-wrap">
                      <Badge status={to} size="xs" />
                      {note && <span className="font-sans text-[10px] text-muted">{note}</span>}
                    </div>
                  ))}
                </div>
              </div>
              <div>
                <div className="font-sans text-[9px] uppercase tracking-[0.16em] text-muted mb-2.5">Role visibility</div>
                <span className="font-sans text-[13px] text-muted leading-relaxed">
                  {STATUS_META[inspected].roles.join(', ')}
                </span>
                <div className="font-sans text-[10px] text-muted mt-2">Plus any platform admin.</div>
              </div>
            </div>
          </div>

          {/* Outcome routing, full width rather than a cramped side panel. */}
          <div className="border-t border-rule bg-surface px-4 lg:px-8 py-5">
            <div className="flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-8">
              <span className="font-sans text-[9px] uppercase tracking-[0.16em] text-muted shrink-0">
                Inspection outcome routing
              </span>
              <div className="flex flex-wrap gap-x-8 gap-y-2">
                {[
                  ['pass', 'Assigned → In Transit'],
                  ['minor defect', 'configurable, no edge seeded'],
                  ['out of service', 'Assigned → Out of Service'],
                ].map(([outcome, target]) => (
                  <div key={outcome} className="flex items-center gap-2">
                    <span className="font-sans text-[12px] font-medium text-ink">{outcome}</span>
                    <span className="font-sans text-[11px] text-muted">{target}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}

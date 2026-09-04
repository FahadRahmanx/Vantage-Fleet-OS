// ─── Audit trail data ─────────────────────────────────────────────────────────
// Rows in the shape the app writes to load_status_logs: real load references,
// the seeded statuses and users, and the captured eligibility or DVIR data
// stored alongside each transition.

const STATUS_COLOR: Record<string, string> = {
  'Created':        '#666666',
  'Assigned':       '#856404',
  'In Transit':     '#004085',
  'Delivered':      '#00884b',
  'Out of Service': '#ba1a1a',
  'In Repair':      '#a15c07',
}

const AUDIT_ENTRIES = [
  { ts: '2026-09-03 14:22', actor: 'Mo Maintenance',  role: 'maintenance_tech', reverted: false, entity: 'VFO0000004', from: 'Out of Service', to: 'In Repair',      captured: 'Claimed for repair from the maintenance board' },
  { ts: '2026-09-03 13:58', actor: 'Alice Eligible',  role: 'driver',           reverted: false, entity: 'VFO0000003', from: 'Assigned',       to: 'Out of Service', captured: 'DVIR outcome out-of-service · Brake Failure' },
  { ts: '2026-09-03 11:02', actor: 'Jane Dispatcher', role: 'dispatcher',       reverted: false, entity: 'VFO0000002', from: 'Assigned',       to: 'In Transit',     captured: 'DVIR outcome pass · eligibility ELIGIBLE' },
  { ts: '2026-09-03 10:47', actor: 'Jane Dispatcher', role: 'dispatcher',       reverted: true,  entity: 'VFO0000002', from: 'In Transit',     to: 'Assigned',       captured: 'Wrong trailer, reverted for re-check' },
  { ts: '2026-09-03 09:55', actor: 'Jane Dispatcher', role: 'dispatcher',       reverted: false, entity: 'VFO0000001', from: 'Created',        to: 'Assigned',       captured: 'Eligibility ELIGIBLE before and after assignment' },
]

function StatusChip({ label }: { label: string }) {
  const color = STATUS_COLOR[label] ?? '#5b6270'
  return (
    <span
      className="font-sans text-[12px] font-medium px-2.5 py-1 border whitespace-nowrap"
      style={{ backgroundColor: `${color}1f`, color, borderColor: `${color}66` }}
    >
      {label}
    </span>
  )
}

export default function AuditSection() {
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
              The audit trail is the operating record. Append-only, attributed, and carrying the data the system relied on at the moment it acted.
            </p>
          </div>
          <div className="lg:flex lg:items-end">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-5 lg:gap-6 w-full">
              {[
                ['Immutable', 'Append-only. No row is updated or deleted after write.'],
                ['Actor-attributed', 'Every transition tied to a named user and timestamp.'],
                ['Snapshot-carrying', 'Eligibility before and after, and the DVIR outcome that routed it.'],
              ].map(([title, desc]) => (
                <div key={title} className="border-t border-ink pt-4">
                  <div className="font-sans text-xs font-semibold text-ink mb-1">{title}</div>
                  <div className="font-sans text-xs text-muted leading-snug">{desc}</div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* An event feed rather than a grid: the same records, at the scale the
            rest of the page reads at. Four columns spread across the full
            width so the row fills the page instead of trailing off into
            empty space on the right. */}
        <div className="border-t border-ink">
          {AUDIT_ENTRIES.map((e, i) => (
            <div
              key={i}
              className="grid grid-cols-1 lg:grid-cols-[160px_1fr_1fr_1.3fr] gap-3 lg:gap-6 py-5 border-b border-rule items-center"
            >
              <div>
                <div className="font-sans text-[13px] font-semibold text-ink tabular-nums">{e.entity}</div>
                <div className="font-sans text-[11px] text-muted mt-0.5 tabular-nums">{e.ts}</div>
              </div>

              <div className="flex items-center justify-start lg:justify-center gap-2 flex-wrap">
                <StatusChip label={e.from} />
                <span className="font-sans text-muted text-sm">{e.reverted ? '←' : '→'}</span>
                <StatusChip label={e.to} />
                {e.reverted && (
                  <span className="font-sans text-[10px] font-medium uppercase tracking-[0.1em] text-rust border border-rust px-1.5 py-0.5">
                    reverted
                  </span>
                )}
              </div>

              <div className="font-sans text-[13px] lg:text-center">
                <div className="text-ink font-medium">{e.actor}</div>
                <div className="text-muted text-[11px] mt-0.5">{e.role.replace(/_/g, ' ')}</div>
              </div>

              <div className="font-sans text-[13px] text-muted leading-snug lg:border-l lg:border-rule lg:pl-6">
                {e.captured}
              </div>
            </div>
          ))}
        </div>

        <p className="mt-4 font-sans text-[11px] text-muted">
          Five most recent transitions. The Audit History screen shows the full company log, row-scoped so a driver sees only their own.
        </p>
      </div>
    </section>
  )
}

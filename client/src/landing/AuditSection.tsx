// ─── Audit trail data ─────────────────────────────────────────────────────────

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

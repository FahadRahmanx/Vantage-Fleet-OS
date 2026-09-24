import { useState } from 'react'
import { Link } from 'react-router-dom'

export default function Nav() {
  const [open, setOpen] = useState(false)
  // Every item points at a section that exists on this page. Labels that
  // had no matching section were renamed rather than left as dead links.
  const links = [
    { label: 'Workflow', href: '#workflow' },
    { label: 'Audit trail', href: '#audit' },
    { label: 'Roles', href: '#roles' },
  ]

  return (
    <nav className="sticky top-0 z-50 bg-white border-b border-rule">
      <div className="max-w-[1440px] mx-auto px-5 lg:px-12 xl:px-16 flex items-center justify-between h-14">
        <div className="flex items-center gap-2.5">
          <img src="/logo.svg" alt="Vantage Fleet OS" className="w-7 h-7" />
          <span className="font-sans text-sm font-semibold text-ink tracking-tight">Vantage Fleet OS</span>
        </div>

        {/* Desktop links */}
        <div className="hidden md:flex items-center gap-8">
          {links.map((item) => (
            <a key={item.label} href={item.href} className="font-sans text-sm text-muted hover:text-ink transition-colors">{item.label}</a>
          ))}
        </div>

        <div className="flex items-center gap-3">
          <Link to="/login" className="hidden md:block font-sans text-sm text-muted hover:text-ink transition-colors">Sign in</Link>
          <Link to="/login" className="font-sans text-sm px-4 py-2 bg-accent text-white hover:bg-accent-deep transition-colors" style={{ borderRadius: '2px' }}>
            Open the demo
          </Link>
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
            <a key={item.label} href={item.href} onClick={() => setOpen(false)}
              className="font-sans text-sm text-ink py-2.5 border-b border-rule-light last:border-0">
              {item.label}
            </a>
          ))}
          <Link to="/login" className="font-sans text-sm text-muted pt-3">Sign in</Link>
        </div>
      )}
    </nav>
  )
}

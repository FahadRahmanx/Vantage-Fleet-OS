import { Link } from 'react-router-dom'

export default function Footer() {
  return (
    <footer className="bg-ink border-t py-8" style={{ borderColor: '#10262f' }}>
      <div className="max-w-[1440px] mx-auto px-5 sm:px-8 lg:px-12 xl:px-16 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <Link to="/" className="flex items-center gap-2.5">
          <img src="/logo.svg" alt="Vantage Fleet OS" className="w-6 h-6" style={{ filter: "brightness(0) invert(1)" }} />
          <span className="font-sans text-sm" style={{ color: '#9aa3b0' }}>Vantage Fleet OS</span>
        </Link>
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
          {[
            { label: 'Workflow', href: '#workflow' },
            { label: 'Audit trail', href: '#audit' },
            { label: 'Roles', href: '#roles' },
          ].map((item) => (
            <a key={item.label} href={item.href} className="font-sans text-xs hover:text-muted-inverse transition-colors" style={{ color: '#5b6270' }}>{item.label}</a>
          ))}
          <Link to="/login" className="font-sans text-xs hover:text-muted-inverse transition-colors" style={{ color: '#5b6270' }}>Sign in</Link>
        </div>
        <span className="font-sans text-xs" style={{ color: '#5b6270' }}>© 2026 Vantage Fleet OS</span>
      </div>
    </footer>
  )
}

// GreenWise's own icon set: bold 24px line icons, drawn for this app.
import type { ReactNode } from 'react'

export type IconName = 'home' | 'transactions' | 'plan' | 'decisions' | 'debts' | 'insights' | 'settings' | 'plus'

const PATHS: Record<IconName, ReactNode> = {
  home: (
    <>
      <path d="M3.5 10.5 12 3.5l8.5 7" />
      <path d="M5.5 9v10.5a1 1 0 0 0 1 1h11a1 1 0 0 0 1-1V9" />
      <path d="M10 20.5v-5.5h4v5.5" />
    </>
  ),
  transactions: (
    <>
      <path d="M7 3.5v15" />
      <path d="m3.5 15 3.5 3.5 3.5-3.5" />
      <path d="M17 20.5v-15" />
      <path d="m13.5 9 3.5-3.5L20.5 9" />
    </>
  ),
  plan: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <circle cx="12" cy="12" r="4.5" />
      <circle cx="12" cy="12" r="1" fill="currentColor" />
    </>
  ),
  decisions: (
    <>
      <path d="M12 3.5v17" />
      <path d="M8 20.5h8" />
      <path d="M4.5 7h15" />
      <path d="M4.5 7 2 13a2.8 2.8 0 0 0 5 0Z" />
      <path d="M19.5 7 17 13a2.8 2.8 0 0 0 5 0Z" />
    </>
  ),
  debts: (
    <>
      <rect x="2.5" y="5" width="19" height="14" rx="2.5" />
      <path d="M2.5 9.5h19" />
      <path d="M6.5 15h4" />
    </>
  ),
  insights: (
    <>
      <path d="M3.5 20.5h17" />
      <path d="m4.5 15.5 5-5 3.5 3.5 6.5-6.5" />
      <path d="M15 7.5h4.5V12" />
    </>
  ),
  settings: (
    <>
      <path d="M4 6.5h9M18 6.5h2M4 12h3M12 12h8M4 17.5h11M19.5 17.5H20" />
      <circle cx="15.5" cy="6.5" r="2.2" />
      <circle cx="9.5" cy="12" r="2.2" />
      <circle cx="17.5" cy="17.5" r="2.2" />
    </>
  ),
  plus: <path d="M12 5v14M5 12h14" />,
}

export function Icon({ name, size = 22, stroke = 2.4 }: { name: IconName; size?: number; stroke?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={stroke}
      strokeLinecap="round" strokeLinejoin="round" aria-hidden focusable="false">
      {PATHS[name]}
    </svg>
  )
}

/** Feature icon in its coloured tile. */
export function FeatureIcon({ name, size = 'md' }: { name: IconName; size?: 'sm' | 'md' | 'lg' }) {
  const px = size === 'lg' ? 26 : size === 'sm' ? 18 : 20
  return <span className={`ficon ficon-${name} ficon-${size}`}><Icon name={name} size={px} /></span>
}

export function PageTitle({ icon, children, action }: { icon: IconName; children: ReactNode; action?: ReactNode }) {
  return (
    <div className="page-head">
      <h1 className="page-title"><FeatureIcon name={icon} size="lg" />{children}</h1>
      {action}
    </div>
  )
}

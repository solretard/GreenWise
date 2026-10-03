import { createContext, useCallback, useContext, useState } from 'react'
import { NavLink, Outlet } from 'react-router-dom'
import { TransactionSheet } from './TransactionSheet'
import { FeatureIcon, Icon, type IconName } from './Icon'
import { useData } from '../data/DataProvider'
import type { Transaction, TxInput } from '../lib/types'

const tabs: { to: string; label: string; icon: IconName; short?: string }[] = [
  { to: '/', label: 'Home', icon: 'home' },
  { to: '/transactions', label: 'Transactions', icon: 'transactions', short: 'Activity' },
  { to: '/plan', label: 'Plan', icon: 'plan' },
  { to: '/decisions', label: 'Decisions', icon: 'decisions', short: 'Decide' },
  { to: '/debts', label: 'Debts', icon: 'debts' },
  { to: '/insights', label: 'Insights', icon: 'insights' },
  { to: '/settings', label: 'Settings', icon: 'settings', short: 'Profile' },
]

type SheetCtx = { openTransaction: (tx?: Transaction | null, preset?: Partial<TxInput>) => void }
const SheetContext = createContext<SheetCtx>({ openTransaction: () => {} })
export const useTransactionSheet = () => useContext(SheetContext)

export function AppShell() {
  const { loading, error, reload } = useData()
  // undefined = closed, null = new transaction, Transaction = editing
  const [sheet, setSheet] = useState<Transaction | null | undefined>(undefined)
  const [preset, setPreset] = useState<Partial<TxInput> | undefined>(undefined)
  const openTransaction = useCallback((tx?: Transaction | null, p?: Partial<TxInput>) => { setPreset(tx ? undefined : p); setSheet(tx ?? null) }, [])
  const close = useCallback(() => { setSheet(undefined); setPreset(undefined) }, [])

  return (
    <SheetContext.Provider value={{ openTransaction }}>
      <div className="shell">
        <nav className="sidebar" aria-label="Main">
          <div className="brand"><img src="/icon.svg" alt="" width={30} height={30} /> <span>Green<span className="gw-gold">Wise</span></span></div>
          <button className="btn primary add-btn-side" onClick={() => openTransaction()}><Icon name="plus" size={18} stroke={2.8} /> Add transaction</button>
          {tabs.map(t => (
            <NavLink key={t.to} to={t.to} end={t.to === '/'} className="nav-item">
              <FeatureIcon name={t.icon} size="sm" /><span className="nav-label"><span className="full">{t.label}</span><span className="short">{t.short ?? t.label}</span></span>
            </NavLink>
          ))}
        </nav>
        <main className="content">
          {loading ? <div className="center muted">Loading your data…</div>
            : error ? (
              <div className="card">
                <p className="error">Couldn’t load your data. Check your connection.</p>
                <button className="btn" onClick={reload} style={{ marginTop: '.75rem' }}>Try again</button>
              </div>
            ) : <Outlet />}
        </main>
        <button className="fab" aria-label="Add transaction" onClick={() => openTransaction()}><Icon name="plus" size={28} stroke={2.8} /></button>
      </div>
      {sheet !== undefined && <TransactionSheet key={sheet?.id ?? 'new'} existing={sheet} preset={preset} onClose={close} />}
    </SheetContext.Provider>
  )
}

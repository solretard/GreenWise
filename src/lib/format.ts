export function formatMoney(amount: number, currency = 'NGN'): string {
  try {
    return new Intl.NumberFormat('en-NG', { style: 'currency', currency, maximumFractionDigits: 0 }).format(amount)
  } catch {
    return `${currency} ${Math.round(amount).toLocaleString()}`
  }
}

export function currencySymbol(currency = 'NGN'): string {
  try {
    const part = new Intl.NumberFormat('en-NG', { style: 'currency', currency }).formatToParts(0).find(p => p.type === 'currency')
    return part?.value ?? currency
  } catch {
    return currency
  }
}

/** Today's date in the user's own timezone, as YYYY-MM-DD. */
export function localToday(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

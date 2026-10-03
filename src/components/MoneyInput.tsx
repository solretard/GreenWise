import { useEffect, useState } from 'react'
import { currencySymbol } from '../lib/format'

type Props = {
  value: number | null
  onChange: (v: number | null) => void
  currency?: string
  placeholder?: string
  id?: string
}

function group(digits: string) {
  const [whole, dec] = digits.split('.')
  const w = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  return dec !== undefined ? `${w}.${dec}` : w
}

/** Amount field that shows 250,000 while storing 250000. */
export function MoneyInput({ value, onChange, currency = 'NGN', placeholder = '0', id }: Props) {
  const [text, setText] = useState(value == null ? '' : group(String(value)))

  useEffect(() => {
    const current = text.replace(/,/g, '')
    if ((value == null && current !== '') || (value != null && Number(current) !== value)) {
      setText(value == null ? '' : group(String(value)))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value])

  return (
    <div className="money-input">
      <span className="money-symbol" aria-hidden>{currencySymbol(currency)}</span>
      <input
        id={id}
        inputMode="decimal"
        placeholder={placeholder}
        value={text}
        onChange={e => {
          let raw = e.target.value.replace(/[^\d.]/g, '')
          const firstDot = raw.indexOf('.')
          if (firstDot !== -1) raw = raw.slice(0, firstDot + 1) + raw.slice(firstDot + 1).replace(/\./g, '').slice(0, 2)
          setText(group(raw))
          onChange(raw === '' || raw === '.' ? null : Number(raw))
        }}
      />
    </div>
  )
}

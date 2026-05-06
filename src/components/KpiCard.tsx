import type { ReactNode } from 'react'

type Props = {
  label: string
  value: ReactNode
  unit?: string
  hint?: string
  icon?: ReactNode
  emphasize?: boolean
  deviation?: boolean
}

export function KpiCard({ label, value, unit, hint, icon, emphasize, deviation }: Props) {
  return (
    <div className={`kpi-card ${emphasize ? 'is-emphasized' : ''} ${deviation ? 'is-deviation' : ''}`}>
      <div className="kpi-head">
        <span className="kpi-label">{label}</span>
        {icon ? <span className="kpi-icon">{icon}</span> : null}
      </div>
      <div className="kpi-value-row">
        <span className="kpi-value">{value}</span>
        {unit ? <span className="kpi-unit">{unit}</span> : null}
      </div>
      {hint ? <div className="kpi-hint">{hint}</div> : null}
    </div>
  )
}

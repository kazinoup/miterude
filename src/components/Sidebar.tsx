import {
  LayoutDashboard,
  Cpu,
  Router,
  FileBarChart2,
  Plus,
  Settings,
  ClipboardCheck,
  AlertTriangle,
} from 'lucide-react'
import type {
  Dashboard,
  DashboardStore,
  UserSession,
  ViewKey,
} from '../types'
import { UserMenu } from './UserMenu'
import { canEdit } from '../lib/permissions'

type Props = {
  current: ViewKey
  onNavigate: (view: ViewKey) => void
  sensorCount: number
  dashboards: DashboardStore
  activeDashboardId: string | null
  onSelectDashboard: (id: string) => void
  onCreateDashboard: () => void
  session: UserSession
  /** Phase A-2: コンテキスト選択画面を開く */
  onSwitchContext: () => void
}

type NavItem = {
  key: ViewKey
  label: string
  icon: React.ComponentType<{ size?: number; strokeWidth?: number }>
  alsoActiveFor?: ViewKey[]
  /** Phase A-3: true ならマスタ編集権限のあるロールにのみ表示。
   *  dashboard_confirmer は閲覧専用なので、デバイス管理 / 設定からは除外する。 */
  editorOnly?: boolean
}

const NAV: NavItem[] = [
  { key: 'dashboard', label: 'ダッシュボード', icon: LayoutDashboard },
  {
    key: 'sensors',
    label: 'センサー',
    icon: Cpu,
    alsoActiveFor: ['sensor-detail'],
    editorOnly: true,
  },
  {
    key: 'gateways',
    label: 'ゲートウェイ',
    icon: Router,
    alsoActiveFor: ['gateway-detail'],
    editorOnly: true,
  },
  { key: 'report', label: 'レポート', icon: FileBarChart2 },
  { key: 'records', label: '記録履歴', icon: ClipboardCheck },
  { key: 'alerts', label: 'アラート', icon: AlertTriangle },
  { key: 'settings', label: '設定', icon: Settings, editorOnly: true },
]

function dashTime(v: Dashboard['createdAt']): number {
  if (v instanceof Date) return v.getTime()
  if (typeof v === 'string' || typeof v === 'number') {
    const t = new Date(v).getTime()
    return Number.isNaN(t) ? 0 : t
  }
  return 0
}

function sortedDashboards(store: DashboardStore): Dashboard[] {
  return Object.values(store).sort((a, b) => {
    return dashTime(a.createdAt) - dashTime(b.createdAt)
  })
}

export function Sidebar({
  current,
  onNavigate,
  sensorCount,
  dashboards,
  activeDashboardId,
  onSelectDashboard,
  onCreateDashboard,
  session,
  onSwitchContext,
}: Props) {
  const dashList = sortedDashboards(dashboards)
  const allowEdit = canEdit(session.effectiveRole)
  const visibleNav = NAV.filter((n) => !n.editorOnly || allowEdit)

  return (
    <aside className="sidebar">
      <div className="sidebar-brand">
        <span className="brand-name">ミテルデ</span>
      </div>

      <nav className="sidebar-nav">
        {visibleNav.map(({ key, label, icon: Icon, alsoActiveFor }) => {
          const active =
            current === key || (alsoActiveFor?.includes(current) ?? false)
          const isDashboard = key === 'dashboard'

          return (
            <div key={key} className="nav-block">
              <button
                type="button"
                className={`nav-item ${active ? 'is-active' : ''}`}
                onClick={() => onNavigate(key)}
              >
                <Icon size={18} strokeWidth={2} />
                <span>{label}</span>
              </button>

              {isDashboard && (
                <div className="sub-nav">
                  {dashList.map((d) => {
                    const isActive =
                      current === 'dashboard' && activeDashboardId === d.id
                    return (
                      <button
                        key={d.id}
                        type="button"
                        className={`sub-nav-item ${isActive ? 'is-active' : ''}`}
                        onClick={() => onSelectDashboard(d.id)}
                        title={d.name}
                      >
                        <span className="sub-bullet" aria-hidden="true" />
                        <span className="sub-nav-label">{d.name}</span>
                      </button>
                    )
                  })}
                  {allowEdit && (
                    <button
                      type="button"
                      className="sub-nav-item sub-nav-new"
                      onClick={onCreateDashboard}
                    >
                      <Plus size={13} strokeWidth={2.4} />
                      <span>新しいダッシュボード</span>
                    </button>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </nav>

      <div className="sidebar-foot">
        <div className="device-counter">
          <span className="counter-label">登録センサー</span>
          <span className="counter-value">{sensorCount}</span>
        </div>
        <small className="sidebar-note">
          データはブラウザ内のみで保持され、サーバーに送信されません。
        </small>
        <UserMenu session={session} onSwitchContext={onSwitchContext} />
      </div>
    </aside>
  )
}

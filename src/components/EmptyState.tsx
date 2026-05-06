import { Database } from 'lucide-react'
import { CsvImportButton } from './CsvImportButton'
import type { DeviceStore } from '../types'

type Props = {
  devices: DeviceStore
  onDevicesChange: (next: DeviceStore) => void
}

export function EmptyState({ devices, onDevicesChange }: Props) {
  return (
    <div className="empty-state">
      <div className="empty-illust">
        <Database size={56} strokeWidth={1.5} />
      </div>
      <h2 className="empty-title">デバイスデータをインポートしてください</h2>
      <p className="empty-desc">
        IoT 温湿度センサーの CSV ファイルを取り込むと、ここにデバイス一覧が表示されます。
        <br />
        ファイル名（拡張子を除く）がそのままデバイス名として登録されます。
      </p>
      <div className="empty-actions">
        <CsvImportButton devices={devices} onDevicesChange={onDevicesChange} size="md" />
      </div>
      <ul className="empty-spec">
        <li>必要列: <code>時間</code> / <code>温度</code> / <code>湿度</code>（バッテリーは任意）</li>
        <li>複数ファイルを一度に選択できます</li>
        <li>3〜4 ヶ月分など、長期間のデータも 1 ファイルで OK</li>
      </ul>
    </div>
  )
}

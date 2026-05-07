/**
 * 初期状態（センサー 0 件）の案内 — Phase E-1 で 2 段構成にリニューアル。
 *
 * 1 段目: まず「設定 → 連携設定」でメーカー連携を有効化してもらう
 * 2 段目: その後、現在表示している CSV ファイル取り込みでデータを読み込む
 *
 * 連携設定は将来 Webhook 受信などの "本番運用" を想定している。CSV 取り込みは
 * デモ／オフラインデータ取り込み用の補助手段。両方を並べることで「正しい順番」で
 * セットアップできるようにする。
 */
import { ArrowRight, Database, Plug } from 'lucide-react'
import { CsvImportButton } from './CsvImportButton'
import type { DeviceStore } from '../types'

type Props = {
  devices: DeviceStore
  onDevicesChange: (next: DeviceStore) => void
  onGoSettings: () => void
}

export function EmptyState({ devices, onDevicesChange, onGoSettings }: Props) {
  return (
    <div className="empty-state empty-state-stack">
      {/* 1 段目: 連携設定への誘導 */}
      <section className="empty-step">
        <div className="empty-step-num" aria-hidden="true">
          1
        </div>
        <div className="empty-step-body">
          <h2 className="empty-step-title">
            <Plug size={18} className="empty-step-icon" />
            まず「設定」→「連携設定」でデバイス連携を有効化してください
          </h2>
          <p className="empty-step-desc">
            ミテルデは Milesight・IoT Mobile などのメーカーごとの Webhook を受け取って
            計測データを取り込みます。利用するメーカー側の連携を ON にしてから
            データを流し込みます。
          </p>
          <div className="empty-step-actions">
            <button
              type="button"
              className="btn btn-primary"
              onClick={onGoSettings}
            >
              <Plug size={15} />
              <span>連携設定へ</span>
              <ArrowRight size={14} />
            </button>
          </div>
        </div>
      </section>

      {/* 2 段目: CSV 取り込み */}
      <section className="empty-step">
        <div className="empty-step-num" aria-hidden="true">
          2
        </div>
        <div className="empty-step-body">
          <h2 className="empty-step-title">
            <Database size={18} className="empty-step-icon" />
            続けて、デバイスの CSV データを取り込んでください
          </h2>
          <p className="empty-step-desc">
            お試し用の計測データは CSV ファイル（時間 / 温度 / 湿度、バッテリーは任意）で
            読み込めます。ファイル名（拡張子を除く）がそのままデバイス名として登録されます。
          </p>
          <div className="empty-step-actions">
            <CsvImportButton
              devices={devices}
              onDevicesChange={onDevicesChange}
              size="md"
            />
          </div>
          <ul className="empty-spec">
            <li>
              必要列: <code>時間</code> / <code>温度</code> / <code>湿度</code>（バッテリーは任意）
            </li>
            <li>複数ファイルを一度に選択できます</li>
            <li>3〜4 ヶ月分など、長期間のデータも 1 ファイルで OK</li>
          </ul>
        </div>
      </section>
    </div>
  )
}

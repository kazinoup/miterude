/**
 * Supabase Realtime 購読 hook — Phase G (Block C)
 *
 * webhook 経由で書き込まれた sensor_readings / devices / sensor_props の
 * 行イベントを購読し、App の React state に逐次反映する。
 *
 * 配信フィルタは RLS（migration 0012 のポリシー）で行うため、ここでは
 * organization_id を明示しない。
 *
 * 設計方針:
 * - 1 チャネル / 1 サブスクライブ。表示中に一度だけ接続して保持。
 * - 不明な sensor_id（まだ devices に登録されていない）が来た場合は
 *   無視する（次のハイドレーション or 手動リロードで取り込む）。
 */
import { useEffect, useRef, useState } from 'react'
import type {
  RealtimeChannel,
  RealtimePostgresChangesPayload,
} from '@supabase/supabase-js'
import { supabase, isSupabaseConfigured } from './supabase'
import type {
  DeviceStore,
  SensorReading,
  SensorStore,
} from '../types'

type ConnectionStatus = 'idle' | 'connecting' | 'subscribed' | 'closed' | 'error'

type SensorReadingsRow = {
  sensor_id: string
  measured_at: string
  temperature: number | null
  humidity: number | null
  battery: number | null
}

type DevicesRow = {
  id: string
  online: boolean
  last_seen_at: string | null
  device_type: string
}

type SensorPropsRow = {
  device_id: string
  battery: number | null
  gateway_id: string | null
}

export function useSupabaseRealtime(opts: {
  setDevices: (updater: (prev: DeviceStore) => DeviceStore) => void
  setSensors: (updater: (prev: SensorStore) => SensorStore) => void
}): { status: ConnectionStatus } {
  const [status, setStatus] = useState<ConnectionStatus>('idle')
  const setDevicesRef = useRef(opts.setDevices)
  const setSensorsRef = useRef(opts.setSensors)
  setDevicesRef.current = opts.setDevices
  setSensorsRef.current = opts.setSensors

  useEffect(() => {
    if (!isSupabaseConfigured()) return
    setStatus('connecting')

    let channel: RealtimeChannel | null = null
    let mounted = true

    channel = supabase
      .channel('miterude-live')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'sensor_readings' },
        (payload: RealtimePostgresChangesPayload<SensorReadingsRow>) => {
          const row = payload.new as SensorReadingsRow
          if (!row?.sensor_id || !row.measured_at) return
          if (row.temperature == null && row.humidity == null) return
          const reading: SensorReading = {
            deviceId: row.sensor_id,
            measuredAt: new Date(row.measured_at),
            temperature: row.temperature ?? NaN,
            humidity: row.humidity ?? NaN,
            battery: row.battery ?? undefined,
          }
          setDevicesRef.current((prev) => {
            const existing = prev[row.sensor_id] ?? []
            // measured_at の昇順を維持するため、末尾追加で OK のことが多いが
            // 念のため後ろから挿入位置を探す。
            const next = [...existing]
            let i = next.length - 1
            while (i >= 0 && next[i].measuredAt > reading.measuredAt) i--
            next.splice(i + 1, 0, reading)
            return { ...prev, [row.sensor_id]: next }
          })
        },
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'devices' },
        (payload: RealtimePostgresChangesPayload<DevicesRow>) => {
          const row = payload.new as DevicesRow
          if (!row?.id || row.device_type !== 'sensor') return
          setSensorsRef.current((prev) => {
            const cur = prev[row.id]
            if (!cur) return prev
            return {
              ...prev,
              [row.id]: {
                ...cur,
                online: row.online,
                lastSeenAt: row.last_seen_at
                  ? new Date(row.last_seen_at)
                  : cur.lastSeenAt,
              },
            }
          })
        },
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'sensor_props' },
        (payload: RealtimePostgresChangesPayload<SensorPropsRow>) => {
          const row = payload.new as SensorPropsRow
          if (!row?.device_id) return
          setSensorsRef.current((prev) => {
            const cur = prev[row.device_id]
            if (!cur) return prev
            return {
              ...prev,
              [row.device_id]: {
                ...cur,
                battery: row.battery ?? cur.battery,
                gatewayId: row.gateway_id ?? cur.gatewayId,
              },
            }
          })
        },
      )
      .subscribe((s) => {
        if (!mounted) return
        if (s === 'SUBSCRIBED') setStatus('subscribed')
        else if (s === 'CLOSED') setStatus('closed')
        else if (s === 'CHANNEL_ERROR' || s === 'TIMED_OUT') setStatus('error')
      })

    return () => {
      mounted = false
      if (channel) supabase.removeChannel(channel)
    }
  }, [])

  return { status }
}

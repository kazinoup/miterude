/**
 * センサーの表示ラベルを統一的に作るヘルパ。
 *
 * 原則「name - deviceNumber」形式。
 * 片方欠けていれば残った方単独、両方欠けていれば serialNumber / id にフォールバック。
 *
 * UI 上で sensor.id（UUID）を直接見せない方針なので、表示用ラベルが必要な
 * 場面では必ずこのヘルパを通すこと。
 */
import type { Sensor } from '../types'

export function formatSensorLabel(sensor: Sensor): string {
  const name = (sensor.name ?? '').trim()
  const num = (sensor.deviceNumber ?? '').trim()
  if (name && num) return `${name} - ${num}`
  if (name) return name
  if (num) return num
  return sensor.serialNumber || sensor.id
}

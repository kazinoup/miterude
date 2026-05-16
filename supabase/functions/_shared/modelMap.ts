// model → device_type / role のマッピング（webhook-milesight / parse-inbox 共通）
//
// src/lib/supportedDevices.ts と同期させること。
// 機種追加時はここ 1 箇所だけ直せばよい（旧: 2 Edge Function に重複していた）。

export type DeviceTypeRole = { device_type: 'sensor' | 'gateway'; role: string }

export const MODEL_MAP: Record<string, DeviceTypeRole> = {
  'EM320-TH':        { device_type: 'sensor', role: 'temperature-humidity' },
  'EM320-TH-MAGNET': { device_type: 'sensor', role: 'temperature-humidity' },
  'AM102':           { device_type: 'sensor', role: 'temperature-humidity' },
  'EM300-TH':        { device_type: 'sensor', role: 'temperature-humidity' },
  'UG65':            { device_type: 'gateway', role: 'master' },
  'UG63':            { device_type: 'gateway', role: 'relay' },
}

export function mapModel(model: string): DeviceTypeRole | null {
  if (!model) return null
  if (MODEL_MAP[model]) return MODEL_MAP[model]
  const lower = model.toLowerCase()
  for (const [k, v] of Object.entries(MODEL_MAP)) {
    if (lower.startsWith(k.toLowerCase() + '-')) return v
  }
  return null
}

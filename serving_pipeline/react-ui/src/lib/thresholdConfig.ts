export const THRESHOLD_PRESETS = {
  LOW: { max: 0.45, value: 0.4 },
  BALANCED: { min: 0.45, max: 0.6, value: 0.525 },
  HIGH: { min: 0.6, value: 0.65 },
} as const

export const ANIMATION_DURATION_MS = 1000
export const ANIMATION_STEPS = 30

export const STATS_REFRESH_INTERVAL_MS = 10_000
export const STATS_FETCH_TIMEOUT_MS = 5_000

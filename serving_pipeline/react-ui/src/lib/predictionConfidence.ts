import type { CartPrediction } from '@/types/api'

export const DEFAULT_DECISION_THRESHOLD = 0.5
export const HIGH_CONFIDENCE_MARGIN = 0.15
export const UNCERTAINTY_MARGIN = 0.05

export const clampThreshold = (threshold?: number) => {
  if (threshold === undefined || threshold === null || Number.isNaN(threshold)) {
    return DEFAULT_DECISION_THRESHOLD
  }

  return Math.min(1, Math.max(0, threshold))
}

export const getDecisionThreshold = (item: CartPrediction) =>
  clampThreshold(item.decision_threshold)

export const getThresholdGap = (item: CartPrediction) => {
  if (item.probability === null) return null
  return item.probability - getDecisionThreshold(item)
}

export const isHighConfidence = (item: CartPrediction) => {
  const thresholdGap = getThresholdGap(item)
  if (thresholdGap === null) return false
  return Math.abs(thresholdGap) >= HIGH_CONFIDENCE_MARGIN
}

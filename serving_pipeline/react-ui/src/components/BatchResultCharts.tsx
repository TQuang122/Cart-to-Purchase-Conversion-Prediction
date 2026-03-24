import { memo, useCallback, useEffect, useMemo, useState, type CSSProperties } from 'react'
import { Download, Search } from 'lucide-react'
import JSZip from 'jszip'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'

import type { CartPrediction, FeatureContribution } from '@/types/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  HIGH_CONFIDENCE_MARGIN,
  UNCERTAINTY_MARGIN,
  getDecisionThreshold,
} from '@/lib/predictionConfidence'
import { CHART_TOOLTIP_CONTENT_STYLE } from '@/lib/chartDefaults'

interface BatchResultChartsProps {
  results: CartPrediction[]
  cohortRows?: CohortMetadataRow[]
  simulatorThreshold: number | null
  onChartFilterChange: (filter: { rowIndexes: number[]; label: string } | null) => void
}

interface CohortMetadataRow {
  brand: string
  category_code_level1: string
  event_weekday: string
}

interface ChartAnalyzeEventPayload {
  chart_type: string
  chart_title?: string
  question: string
  series: Array<Record<string, unknown>>
  context?: Record<string, unknown>
  user_message?: string
  suggested_questions?: string[]
}

interface AxisTickPayload {
  value: string
}

interface AxisTickProps {
  x?: number | string
  y?: number | string
  payload?: AxisTickPayload
}

type LocalWaterfallLimit = 5 | 10 | 'all'
type CohortField = 'brand' | 'category_code_level1' | 'event_weekday'

const CHART_CONTAINER_DEBOUNCE_MS = 120
const WEEKDAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'] as const

const CHART_COLORS = {
  actual: '#16A34A',
  expected: '#2563EB',
  uncertain: '#D97706',
  error: '#DC2626',
  info: '#64748B',
} as const

const CALIBRATION_COLORS = {
  actual: '#16A34A',
  expected: '#2563EB',
} as const

const hexToRgba = (hex: string, alpha: number) => {
  const sanitized = hex.replace('#', '')
  const value =
    sanitized.length === 3
      ? sanitized
          .split('')
          .map((char) => char + char)
          .join('')
      : sanitized

  const bigint = Number.parseInt(value, 16)
  const r = (bigint >> 16) & 255
  const g = (bigint >> 8) & 255
  const b = bigint & 255
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

const CHART_TOOLTIP_LABEL_STYLE: CSSProperties = {
  color: 'hsl(var(--foreground) / 0.95)',
  fontSize: '12px',
  fontWeight: 600,
}

const CHART_TOOLTIP_ITEM_STYLE: CSSProperties = {
  color: 'hsl(var(--foreground) / 0.92)',
  fontSize: '12px',
  padding: 0,
}

const formatPct = (value: number) => `${value.toFixed(1)}%`

const getHeatCellStyle = (tone: 'success' | 'warning' | 'error' | 'info', strength: number) => {
  const clamped = Math.min(0.75, Math.max(0.18, strength))
  const baseColor =
    tone === 'success'
      ? CHART_COLORS.actual
      : tone === 'warning'
      ? CHART_COLORS.uncertain
      : tone === 'error'
      ? CHART_COLORS.error
      : CHART_COLORS.info

  return {
    backgroundColor: hexToRgba(baseColor, clamped),
    borderColor: hexToRgba(baseColor, Math.min(0.92, clamped + 0.2)),
  }
}

const formatFeatureLabel = (feature: string) =>
  feature
    .split('_')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ')

const getRowContributions = (item: CartPrediction): FeatureContribution[] => {
  if (item.feature_contributions && item.feature_contributions.length > 0) {
    return item.feature_contributions
  }

  if (item.explainability?.top_signals && item.explainability.top_signals.length > 0) {
    return item.explainability.top_signals
  }

  return []
}

const buildCsvText = (headers: string[], rows: Array<Array<string | number>>) => {
  return [
    headers.join(','),
    ...rows.map((row) => row.map((cell) => `"${String(cell).replaceAll('"', '""')}"`).join(',')),
  ].join('\n')
}

const exportCsvFile = (filename: string, headers: string[], rows: Array<Array<string | number>>) => {
  const blob = new Blob([buildCsvText(headers, rows)], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)
}

export const BatchResultCharts = memo(({ results, cohortRows, simulatorThreshold, onChartFilterChange }: BatchResultChartsProps) => {
  const [cohortField, setCohortField] = useState<CohortField>('brand')
  const [selectedShapRowIndex, setSelectedShapRowIndex] = useState(0)
  const [localWaterfallLimit, setLocalWaterfallLimit] = useState<LocalWaterfallLimit>(10)
  const [globalShapSearch, setGlobalShapSearch] = useState('')
  const [debouncedGlobalShapSearch, setDebouncedGlobalShapSearch] = useState('')
  const [pinnedShapRowIndex, setPinnedShapRowIndex] = useState<number | null>(null)
  const [bandLabelHint, setBandLabelHint] = useState<string | null>(null)
  const [featureLabelHint, setFeatureLabelHint] = useState<string | null>(null)
  const [isMobile, setIsMobile] = useState(() =>
    typeof window !== 'undefined' ? window.matchMedia('(max-width: 640px)').matches : false
  )

  useEffect(() => {
    if (typeof window === 'undefined') return

    const mediaQuery = window.matchMedia('(max-width: 640px)')
    const onChange = (event: MediaQueryListEvent) => setIsMobile(event.matches)

    mediaQuery.addEventListener('change', onChange)

    return () => {
      mediaQuery.removeEventListener('change', onChange)
    }
  }, [])

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebouncedGlobalShapSearch(globalShapSearch)
    }, 130)

    return () => {
      window.clearTimeout(timer)
    }
  }, [globalShapSearch])

  const axisTickFontSize = isMobile ? 10 : 11
  const yAxisLabelWidth = isMobile ? 92 : 132
  const compactBandLabel = (label: string) => {
    if (!isMobile) return label

    if (label === 'High-conf negative') return 'High- neg'
    if (label === 'Moderate confidence') return 'Moderate'
    if (label === 'High-conf positive') return 'High+ pos'
    return 'Near thr.'
  }

  const compactFeatureLabel = (label: string) => {
    if (!isMobile || label.length <= 14) return label
    return `${label.slice(0, 14)}...`
  }

  const compactCohortLabel = (label: string) => {
    if (!isMobile || label.length <= 12) return label
    return `${label.slice(0, 12)}...`
  }

  const normalizeWeekdayLabel = (rawValue: string, useZeroBased: boolean) => {
    const trimmed = rawValue.trim()
    const parsed = Number(trimmed)
    if (!Number.isInteger(parsed)) return rawValue

    const index = useZeroBased ? parsed : parsed - 1
    if (index < 0 || index > 6) return rawValue

    return WEEKDAY_NAMES[index]
  }

  const effectiveThresholdFor = useCallback(
    (item: CartPrediction) => simulatorThreshold ?? getDecisionThreshold(item),
    [simulatorThreshold]
  )

  const effectivePredictionFor = useCallback(
    (item: CartPrediction) => {
      if (item.probability === null) return item.is_purchased
      return item.probability >= effectiveThresholdFor(item) ? 1 : 0
    },
    [effectiveThresholdFor]
  )

  const renderBandAxisTick = ({ x = 0, y = 0, payload }: AxisTickProps) => {
    const axisX = Number(x)
    const axisY = Number(y)
    const fullLabel = payload?.value ?? ''
    const shortLabel = compactBandLabel(fullLabel)
    const isShortened = shortLabel !== fullLabel

    return (
      <g transform={`translate(${axisX},${axisY})`}>
        <text
          x={0}
          y={0}
          dy={4}
          textAnchor="end"
          fill="hsl(var(--muted-foreground))"
          fontSize={axisTickFontSize}
          className={isShortened ? 'cursor-help' : undefined}
          onClick={isShortened ? () => setBandLabelHint(fullLabel) : undefined}
        >
          <title>{fullLabel}</title>
          {shortLabel}
        </text>
      </g>
    )
  }

  const renderFeatureAxisTick = ({ x = 0, y = 0, payload }: AxisTickProps) => {
    const axisX = Number(x)
    const axisY = Number(y)
    const fullLabel = payload?.value ?? ''
    const shortLabel = compactFeatureLabel(fullLabel)
    const isShortened = shortLabel !== fullLabel

    return (
      <g transform={`translate(${axisX},${axisY})`}>
        <text
          x={0}
          y={0}
          dy={4}
          textAnchor="end"
          fill="hsl(var(--muted-foreground))"
          fontSize={axisTickFontSize}
          className={isShortened ? 'cursor-help' : undefined}
          onClick={isShortened ? () => setFeatureLabelHint(fullLabel) : undefined}
        >
          <title>{fullLabel}</title>
          {shortLabel}
        </text>
      </g>
    )
  }

  const probabilityHistogram = useMemo(() => {
    const bins = Array.from({ length: 10 }, (_, index) => ({
      label: `${index * 10}-${(index + 1) * 10}%`,
      axisLabel: `${index * 10}-${(index + 1) * 10}`,
      count: 0,
      rowIndexes: [] as number[],
    }))

    for (const [index, item] of results.entries()) {
      if (item.probability === null) continue
      const binIndex = Math.min(9, Math.floor(item.probability * 10))
      bins[binIndex].count += 1
      bins[binIndex].rowIndexes.push(index)
    }

    return bins
  }, [results])

  const thresholdBands = useMemo(() => {
    const bands = [
      { name: 'High-conf negative', count: 0, color: CHART_COLORS.error, rowIndexes: [] as number[] },
      { name: 'Near threshold', count: 0, color: CHART_COLORS.uncertain, rowIndexes: [] as number[] },
      { name: 'Moderate confidence', count: 0, color: CHART_COLORS.info, rowIndexes: [] as number[] },
      { name: 'High-conf positive', count: 0, color: CHART_COLORS.actual, rowIndexes: [] as number[] },
    ]

    for (const [index, item] of results.entries()) {
      if (item.probability === null) continue
      const thresholdGap = item.probability - effectiveThresholdFor(item)

      if (thresholdGap <= -HIGH_CONFIDENCE_MARGIN) {
        bands[0].count += 1
        bands[0].rowIndexes.push(index)
      } else if (Math.abs(thresholdGap) < UNCERTAINTY_MARGIN) {
        bands[1].count += 1
        bands[1].rowIndexes.push(index)
      } else if (thresholdGap >= HIGH_CONFIDENCE_MARGIN) {
        bands[3].count += 1
        bands[3].rowIndexes.push(index)
      } else {
        bands[2].count += 1
        bands[2].rowIndexes.push(index)
      }
    }

    return bands
  }, [effectiveThresholdFor, results])

  const decilePerformance = useMemo(() => {
    const valid = results
      .map((item, rowIndex) => ({ item, rowIndex }))
      .filter((entry): entry is { item: CartPrediction & { probability: number }; rowIndex: number } => entry.item.probability !== null)
      .sort((a, b) => b.item.probability - a.item.probability)

    if (valid.length === 0) return []

    const bucketSize = Math.max(1, Math.ceil(valid.length / 10))

    return Array.from({ length: 10 }, (_, index) => {
      const start = index * bucketSize
      const end = Math.min(valid.length, start + bucketSize)
      const rows = valid.slice(start, end)

      if (rows.length === 0) {
        return null
      }

      const purchased = rows.filter((entry) => effectivePredictionFor(entry.item) === 1).length
      const purchaseRate = (purchased / rows.length) * 100

      return {
        decile: `D${index + 1}`,
        purchaseRate,
        rowIndexes: rows.map((entry) => entry.rowIndex),
      }
    }).filter((entry): entry is { decile: string; purchaseRate: number; rowIndexes: number[] } => entry !== null)
  }, [effectivePredictionFor, results])

  const decileWithVisuals = useMemo(() => {
    return decilePerformance.map((entry, index) => {
      const alpha = Math.max(0.35, 0.95 - index * 0.06)
      return {
        ...entry,
        fill: hexToRgba(CHART_COLORS.actual, Number(alpha.toFixed(2))),
      }
    })
  }, [decilePerformance])

  const labeledResults = useMemo(
    () =>
      results.filter(
        (item): item is CartPrediction & { probability: number; actual_label: number } =>
          item.probability !== null && (item.actual_label === 0 || item.actual_label === 1)
      ),
    [results]
  )

  const calibrationData = useMemo(() => {
    const bins = Array.from({ length: 10 }, (_, index) => ({
      label: `${index * 10}-${(index + 1) * 10}%`,
      total: 0,
      positive: 0,
    }))

    for (const item of labeledResults) {
      const binIndex = Math.min(9, Math.floor(item.probability * 10))
      bins[binIndex].total += 1
      bins[binIndex].positive += item.actual_label
    }

    return bins.map((bin, index) => ({
      bin: `B${index + 1}`,
      predictedRate: (index * 10 + 5),
      actualRate: bin.total > 0 ? (bin.positive / bin.total) * 100 : 0,
      count: bin.total,
    }))
  }, [labeledResults])

  const confusionSummary = useMemo(() => {
    let tp = 0
    let fp = 0
    let tn = 0
    let fn = 0

    for (const item of labeledResults) {
      const predictedPositive = item.probability >= effectiveThresholdFor(item)

      if (predictedPositive && item.actual_label === 1) tp += 1
      if (predictedPositive && item.actual_label === 0) fp += 1
      if (!predictedPositive && item.actual_label === 0) tn += 1
      if (!predictedPositive && item.actual_label === 1) fn += 1
    }

    const precision = tp + fp > 0 ? tp / (tp + fp) : 0
    const recall = tp + fn > 0 ? tp / (tp + fn) : 0

    return { tp, fp, tn, fn, precision, recall }
  }, [effectiveThresholdFor, labeledResults])

  const confusionHeatmap = useMemo(() => {
    const cells = [
      { title: 'True Positive', short: 'TP', count: confusionSummary.tp, tone: 'success' as const },
      { title: 'False Positive', short: 'FP', count: confusionSummary.fp, tone: 'warning' as const },
      { title: 'False Negative', short: 'FN', count: confusionSummary.fn, tone: 'error' as const },
      { title: 'True Negative', short: 'TN', count: confusionSummary.tn, tone: 'info' as const },
    ]

    const maxCount = Math.max(1, ...cells.map((cell) => cell.count))
    return cells.map((cell) => ({
      ...cell,
      intensity: cell.count / maxCount,
    }))
  }, [confusionSummary])

  const shapReadyRows = useMemo(
    () =>
      results
        .map((item, rowIndex) => ({ rowIndex, item }))
        .filter(({ item }) => getRowContributions(item).length > 0),
    [results]
  )

  const globalShapData = useMemo(() => {
    const totals = new Map<string, { sumAbs: number; samples: number; displayName: string }>()

    for (const row of shapReadyRows) {
      const contributions = getRowContributions(row.item)
      contributions.forEach((contribution) => {
        const current = totals.get(contribution.feature)
        const displayName = contribution.display_name ?? formatFeatureLabel(contribution.feature)

        if (current) {
          current.sumAbs += Math.abs(contribution.contribution)
          current.samples += 1
          return
        }

        totals.set(contribution.feature, {
          sumAbs: Math.abs(contribution.contribution),
          samples: 1,
          displayName,
        })
      })
    }

    return Array.from(totals.entries())
      .map(([feature, value]) => ({
        feature,
        label: value.displayName,
        meanAbsShap: value.sumAbs / value.samples,
      }))
      .sort((a, b) => b.meanAbsShap - a.meanAbsShap)
      .slice(0, 10)
  }, [shapReadyRows])

  const filteredGlobalShapData = useMemo(() => {
    const query = debouncedGlobalShapSearch.trim().toLowerCase()
    if (!query) return globalShapData
    return globalShapData.filter(
      (item) => item.label.toLowerCase().includes(query) || item.feature.toLowerCase().includes(query)
    )
  }, [debouncedGlobalShapSearch, globalShapData])

  const safeSelectedShapIndex = Math.min(selectedShapRowIndex, Math.max(0, shapReadyRows.length - 1))
  const selectedShapRow = shapReadyRows[safeSelectedShapIndex]

  const localWaterfallData = useMemo(() => {
    if (!selectedShapRow) return []

    const maxItems = localWaterfallLimit === 'all' ? Number.MAX_SAFE_INTEGER : localWaterfallLimit
    const contributions = getRowContributions(selectedShapRow.item)
    if (contributions.length === 0) return []

    return [...contributions]
      .sort((a, b) => Math.abs(b.contribution) - Math.abs(a.contribution))
      .slice(0, maxItems)
      .map((contribution) => ({
        feature: contribution.feature,
        label: contribution.display_name ?? formatFeatureLabel(contribution.feature),
        shap: contribution.contribution,
      }))
  }, [localWaterfallLimit, selectedShapRow])

  const localWaterfallMax = Math.max(0.01, ...localWaterfallData.map((item) => Math.abs(item.shap)))
  const selectedShapProbability = selectedShapRow?.item.probability
  const selectedShapBaseline = selectedShapRow?.item.explainability?.baseline_score ?? 0
  const pinnedShapRow = pinnedShapRowIndex !== null ? shapReadyRows[pinnedShapRowIndex] : undefined

  const localComparisonData = useMemo(() => {
    if (!selectedShapRow || !pinnedShapRow || selectedShapRow === pinnedShapRow) return []

    const selectedMap = new Map(
      getRowContributions(selectedShapRow.item).map((item) => [item.feature, item])
    )
    const pinnedMap = new Map(
      getRowContributions(pinnedShapRow.item).map((item) => [item.feature, item])
    )
    const keys = new Set([...selectedMap.keys(), ...pinnedMap.keys()])

    return Array.from(keys)
      .map((feature) => {
        const selected = selectedMap.get(feature)
        const pinned = pinnedMap.get(feature)
        return {
          feature,
          label: selected?.display_name ?? pinned?.display_name ?? formatFeatureLabel(feature),
          selected: selected?.contribution ?? 0,
          pinned: pinned?.contribution ?? 0,
          delta: Math.abs((selected?.contribution ?? 0) - (pinned?.contribution ?? 0)),
        }
      })
      .sort((a, b) => b.delta - a.delta)
      .slice(0, 8)
  }, [pinnedShapRow, selectedShapRow])

  const shapCoverage = useMemo(() => {
    const rowsWithFull = results.filter((item) => item.feature_contributions && item.feature_contributions.length > 3).length
    const rowsWithFallbackTop = results.filter(
      (item) =>
        (!item.feature_contributions || item.feature_contributions.length <= 3) &&
        Boolean(item.explainability?.top_signals?.length)
    ).length
    const coveragePct = results.length > 0 ? (shapReadyRows.length / results.length) * 100 : 0
    const fallbackPct = results.length > 0 ? (rowsWithFallbackTop / results.length) * 100 : 0

    return {
      rowsWithFull,
      rowsWithFallbackTop,
      coveragePct,
      fallbackPct,
    }
  }, [results, shapReadyRows.length])

  const overallPredictedRate = useMemo(() => {
    const valid = results.filter((item): item is CartPrediction & { probability: number } => item.probability !== null)
    if (valid.length === 0) return 0
    const predictedPositive = valid.filter((item) => effectivePredictionFor(item) === 1).length
    return (predictedPositive / valid.length) * 100
  }, [effectivePredictionFor, results])

  const confidenceInsights = useMemo(() => {
    const total = thresholdBands.reduce((sum, item) => sum + item.count, 0)
    if (total === 0) return { nearThresholdPct: 0, highPositivePct: 0 }
    return {
      nearThresholdPct: (thresholdBands[1].count / total) * 100,
      highPositivePct: (thresholdBands[3].count / total) * 100,
    }
  }, [thresholdBands])

  const cohortBreakdownData = useMemo(() => {
    if (!cohortRows || cohortRows.length === 0) return []

    const totals = new Map<
      string,
      { count: number; purchased: number; probabilitySum: number; probabilityCount: number; rowIndexes: number[] }
    >()
    const normalizedField = cohortField

    results.forEach((item, index) => {
      const cohort = cohortRows[index]
      const raw = cohort?.[normalizedField]
      const key = raw && raw.trim().length > 0 ? raw : 'Unknown'
      const current = totals.get(key) ?? { count: 0, purchased: 0, probabilitySum: 0, probabilityCount: 0, rowIndexes: [] as number[] }
      current.count += 1
      current.purchased += effectivePredictionFor(item) === 1 ? 1 : 0
      current.rowIndexes.push(index)
      if (item.probability !== null) {
        current.probabilitySum += item.probability
        current.probabilityCount += 1
      }
      totals.set(key, current)
    })

    const useZeroBasedWeekday =
      cohortField === 'event_weekday' && Array.from(totals.keys()).some((key) => key.trim() === '0')

    const sorted = Array.from(totals.entries())
      .map(([cohort, value]) => {
        const normalizedCohort =
          cohortField === 'event_weekday' ? normalizeWeekdayLabel(cohort, useZeroBasedWeekday) : cohort
        const parsedWeekday = Number(cohort.trim())
        const weekdayOrder =
          cohortField === 'event_weekday' && Number.isInteger(parsedWeekday)
            ? (useZeroBasedWeekday ? parsedWeekday : parsedWeekday - 1)
            : Number.POSITIVE_INFINITY

        return {
          cohort: normalizedCohort,
          count: value.count,
          predictedRate: value.count > 0 ? (value.purchased / value.count) * 100 : 0,
          avgProbability: value.probabilityCount > 0 ? (value.probabilitySum / value.probabilityCount) * 100 : 0,
          rowIndexes: value.rowIndexes,
          weekdayOrder,
        }
      })
      .sort((a, b) => {
        if (cohortField === 'event_weekday') {
          if (a.weekdayOrder !== b.weekdayOrder) return a.weekdayOrder - b.weekdayOrder
          return b.count - a.count
        }
        return b.count - a.count
      })

    if (sorted.length <= 8) {
      return sorted.map((entry) => ({
        cohort: entry.cohort,
        count: entry.count,
        predictedRate: entry.predictedRate,
        avgProbability: entry.avgProbability,
        rowIndexes: entry.rowIndexes,
      }))
    }

    const top = sorted.slice(0, 7).map((entry) => ({
      cohort: entry.cohort,
      count: entry.count,
      predictedRate: entry.predictedRate,
      avgProbability: entry.avgProbability,
      rowIndexes: entry.rowIndexes,
    }))
    const rest = sorted.slice(7)
    const others = rest.reduce(
      (acc, entry) => {
        acc.count += entry.count
        acc.predictedNumerator += (entry.predictedRate * entry.count) / 100
        acc.probabilityNumerator += (entry.avgProbability * entry.count) / 100
        acc.rowIndexes.push(...entry.rowIndexes)
        return acc
      },
      { count: 0, predictedNumerator: 0, probabilityNumerator: 0, rowIndexes: [] as number[] }
    )

    top.push({
      cohort: 'Others',
      count: others.count,
      predictedRate: others.count > 0 ? (others.predictedNumerator / others.count) * 100 : 0,
      avgProbability: others.count > 0 ? (others.probabilityNumerator / others.count) * 100 : 0,
      rowIndexes: others.rowIndexes,
    })

    return top
  }, [cohortField, cohortRows, effectivePredictionFor, results])

  const decileTopRate = decileWithVisuals[0]?.purchaseRate ?? 0

  const pushChartFilter = useCallback(
    (rowIndexes: number[], label: string) => {
      if (rowIndexes.length === 0) {
        onChartFilterChange(null)
        return
      }
      onChartFilterChange({ rowIndexes, label })
    },
    [onChartFilterChange]
  )

  const sendChartToAssistant = useCallback((payload: ChartAnalyzeEventPayload) => {
    window.dispatchEvent(new CustomEvent<ChartAnalyzeEventPayload>('chatbot:analyze-chart', { detail: payload }))
  }, [])

  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
      <div className="rounded-xl border border-border/70 bg-card/45 p-3.5">
        <div className="mb-3 flex items-start justify-between gap-3">
          <div>
            <p className="type-kicker mb-1">Score distribution</p>
            <p className="type-caption text-muted-foreground">Probability spread across all rows</p>
          </div>
          <span className="type-caption state-badge-info inline-flex items-center rounded-full px-2.5 py-1 font-semibold">
            Avg predicted buy: {formatPct(overallPredictedRate)}
          </span>
        </div>
        <div className="h-60">
          <ResponsiveContainer width="100%" height="100%" minWidth={0} debounce={CHART_CONTAINER_DEBOUNCE_MS}>
            <BarChart data={probabilityHistogram} margin={{ top: 8, right: 8, left: -20, bottom: 8 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border) / 0.42)" />
              <XAxis
                dataKey="axisLabel"
                tick={{ fontSize: axisTickFontSize }}
                angle={isMobile ? -34 : 0}
                textAnchor={isMobile ? 'end' : 'middle'}
                height={isMobile ? 52 : 30}
                minTickGap={14}
                interval="preserveStartEnd"
              />
              <YAxis allowDecimals={false} tick={{ fontSize: axisTickFontSize }} />
              <Tooltip
                formatter={(value) => [`${Number(value ?? 0)} rows`, 'Count']}
                isAnimationActive={false}
                contentStyle={CHART_TOOLTIP_CONTENT_STYLE}
                labelStyle={CHART_TOOLTIP_LABEL_STYLE}
                itemStyle={CHART_TOOLTIP_ITEM_STYLE}
                labelFormatter={(label, payload) => {
                  const range = payload?.[0]?.payload?.label
                  return typeof range === 'string' ? range : String(label)
                }}
              />
              <Bar dataKey="count" fill={CHART_COLORS.info} radius={[6, 6, 0, 0]} isAnimationActive={false}>
                {probabilityHistogram.map((entry) => (
                  <Cell
                    key={entry.label}
                    fill={CHART_COLORS.info}
                    style={{ cursor: entry.count > 0 ? 'pointer' : 'default' }}
                    onClick={() => pushChartFilter(entry.rowIndexes, `Score bin ${entry.label}`)}
                  />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
        <div className="mt-2 flex justify-start">
          <Button
            variant="outline"
            size="sm"
            className="h-8 border-border/70 px-2.5"
            onClick={() =>
              sendChartToAssistant({
                chart_type: 'score_distribution',
                chart_title: 'Score distribution',
                question: 'Analyze score distribution and identify the key concentration and action implications.',
                series: probabilityHistogram.map((entry) => ({
                  bin: entry.label,
                  count: entry.count,
                })),
                context: {
                  overall_predicted_rate_pct: Number((overallPredictedRate * 100).toFixed(2)),
                  total_rows: results.length,
                  simulator_threshold: simulatorThreshold,
                },
                user_message: 'Analyze chart: Score distribution',
                suggested_questions: [
                  'Which score bins should we prioritize for retention budget?',
                  'Where should we add manual review to reduce false actions?',
                ],
              })
            }
          >
            Analyze with AI
          </Button>
        </div>
      </div>

      <div className="rounded-xl border border-border/70 bg-card/45 p-3.5">
        <div className="mb-3 flex items-start justify-between gap-3">
          <div>
            <p className="type-kicker mb-1">Global SHAP importance</p>
            <p className="type-caption text-muted-foreground">Mean absolute contribution across batch rows</p>
          </div>
          <span className="type-caption state-badge-info inline-flex items-center rounded-full px-2.5 py-1 font-semibold">
            Coverage: {shapCoverage.coveragePct.toFixed(1)}% ({shapReadyRows.length}/{results.length})
          </span>
        </div>
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <div className="relative min-w-[220px] flex-1">
            <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={globalShapSearch}
              onChange={(event) => setGlobalShapSearch(event.target.value)}
              placeholder="Search feature in SHAP..."
              className="h-8 border-border/70 bg-background/70 pl-8 text-xs"
            />
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              exportCsvFile(
                'shap_global_importance.csv',
                ['feature', 'display_name', 'mean_abs_shap'],
                globalShapData.map((item) => [item.feature, item.label, item.meanAbsShap])
              )
            }}
            className="h-8 border-border/70 px-3"
            disabled={globalShapData.length === 0}
          >
            <Download className="mr-1.5 h-3.5 w-3.5" />
            Download SHAP CSV
          </Button>

          <Button
            variant="outline"
            size="sm"
            onClick={async () => {
              const zip = new JSZip()
              zip.file(
                'shap_global_importance.csv',
                buildCsvText(
                  ['feature', 'display_name', 'mean_abs_shap'],
                  globalShapData.map((item) => [item.feature, item.label, item.meanAbsShap])
                )
              )

              if (selectedShapRow && localWaterfallData.length > 0) {
                zip.file(
                  `shap_local_row_${selectedShapRow.rowIndex + 1}.csv`,
                  buildCsvText(
                    ['feature', 'display_name', 'shap_contribution'],
                    localWaterfallData.map((item) => [item.feature, item.label, item.shap])
                  )
                )
              }

              if (pinnedShapRow && pinnedShapRow !== selectedShapRow && localComparisonData.length > 0 && selectedShapRow) {
                zip.file(
                  `shap_compare_row_${selectedShapRow.rowIndex + 1}_vs_${pinnedShapRow.rowIndex + 1}.csv`,
                  buildCsvText(
                    ['feature', 'display_name', 'selected_row', 'pinned_row', 'delta_abs'],
                    localComparisonData.map((item) => [item.feature, item.label, item.selected, item.pinned, item.delta])
                  )
                )
              }

              zip.file(
                'shap_summary.csv',
                buildCsvText(
                  ['metric', 'value'],
                  [
                    ['total_rows', results.length],
                    ['rows_with_any_shap', shapReadyRows.length],
                    ['rows_with_full_feature_contributions', shapCoverage.rowsWithFull],
                    ['rows_with_top_signals_fallback', shapCoverage.rowsWithFallbackTop],
                    ['coverage_percent', shapCoverage.coveragePct.toFixed(2)],
                    ['fallback_percent', shapCoverage.fallbackPct.toFixed(2)],
                  ]
                )
              )

              const blob = await zip.generateAsync({ type: 'blob' })
              const url = URL.createObjectURL(blob)
              const link = document.createElement('a')
              link.href = url
              link.download = 'shap_bundle.zip'
              document.body.appendChild(link)
              link.click()
              document.body.removeChild(link)
              URL.revokeObjectURL(url)
            }}
            className="h-8 border-border/70 px-3"
            disabled={globalShapData.length === 0}
          >
            <Download className="mr-1.5 h-3.5 w-3.5" />
            Export SHAP bundle
          </Button>
        </div>
        {shapCoverage.rowsWithFallbackTop > 0 ? (
          <div className="mb-3 rounded-md border border-[hsl(var(--warning)/0.48)] bg-[hsl(var(--warning)/0.12)] px-2.5 py-2">
            <p className="type-caption text-xs font-semibold text-foreground/90">
              {shapCoverage.fallbackPct.toFixed(1)}% rows are fallback explainability (top signals only).
            </p>
            <p className="type-caption text-xs text-muted-foreground">
              Switch to `Explain Full` for richer SHAP analysis when backend returns full feature contributions.
            </p>
          </div>
        ) : null}
        {filteredGlobalShapData.length > 0 ? (
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%" minWidth={0} debounce={CHART_CONTAINER_DEBOUNCE_MS}>
              <BarChart data={filteredGlobalShapData} layout="vertical" margin={{ top: 8, right: 16, left: 20, bottom: 8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border) / 0.42)" />
                <XAxis type="number" tick={{ fontSize: axisTickFontSize }} />
                <YAxis
                  dataKey="label"
                  type="category"
                  width={yAxisLabelWidth}
                  tick={isMobile ? renderFeatureAxisTick : { fontSize: axisTickFontSize }}
                  tickFormatter={isMobile ? undefined : compactFeatureLabel}
                />
                <Tooltip
                  formatter={(value) => [Number(value ?? 0).toFixed(4), 'Mean |SHAP|']}
                  isAnimationActive={false}
                  contentStyle={CHART_TOOLTIP_CONTENT_STYLE}
                  labelStyle={CHART_TOOLTIP_LABEL_STYLE}
                  itemStyle={CHART_TOOLTIP_ITEM_STYLE}
                />
                <Bar dataKey="meanAbsShap" name="Mean |SHAP|" fill={CHART_COLORS.info} radius={[0, 6, 6, 0]} isAnimationActive={false} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <div className="type-body flex h-64 items-center justify-center rounded-lg border border-dashed border-border/65 bg-muted/20 p-3 text-sm text-muted-foreground">
            SHAP-compatible feature contribution data is not available for this batch.
          </div>
        )}
        <div className="mt-2 flex justify-start">
          <Button
            variant="outline"
            size="sm"
            className="h-8 border-border/70 px-2.5"
            onClick={() =>
              sendChartToAssistant({
                chart_type: 'global_shap_importance',
                chart_title: 'Global SHAP importance',
                question: 'Analyze global feature importance and recommend actionable optimization focus.',
                series: filteredGlobalShapData.map((item) => ({
                  feature: item.feature,
                  display_name: item.label,
                  mean_abs_shap: Number(item.meanAbsShap.toFixed(6)),
                })),
                context: {
                  feature_count: filteredGlobalShapData.length,
                  shap_coverage_pct: Number(shapCoverage.coveragePct.toFixed(2)),
                  fallback_rows_pct: Number(shapCoverage.fallbackPct.toFixed(2)),
                  simulator_threshold: simulatorThreshold,
                },
                user_message: 'Analyze chart: Global SHAP importance',
                suggested_questions: [
                  'Which top features should we optimize first for conversion lift?',
                  'What operational actions are implied by these strongest SHAP drivers?',
                ],
              })
            }
            disabled={filteredGlobalShapData.length === 0}
          >
            Analyze with AI
          </Button>
        </div>
      </div>

      <div className="rounded-xl border border-border/70 bg-card/45 p-3.5">
        <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="type-kicker mb-1">Cohort breakdown</p>
            <p className="type-caption text-muted-foreground">Predicted purchase rate by cohort segment</p>
          </div>
          <div className="flex items-center gap-2">
            <div className="inline-flex h-8 items-center rounded-md border border-border/70 bg-background/65 p-0.5">
              {([
                { value: 'brand', label: 'Brand' },
                { value: 'category_code_level1', label: 'Category L1' },
                { value: 'event_weekday', label: 'Weekday' },
              ] as const).map((option) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => setCohortField(option.value)}
                  className={
                    cohortField === option.value
                      ? 'type-caption rounded px-2 py-1 text-xs font-semibold text-foreground state-badge-info'
                      : 'type-caption rounded px-2 py-1 text-xs text-muted-foreground hover:text-foreground'
                  }
                  aria-pressed={cohortField === option.value}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>
        </div>
        {!cohortRows || cohortRows.length === 0 ? (
          <div className="type-body flex h-72 items-center justify-center rounded-lg border border-dashed border-border/65 bg-muted/20 p-3 text-sm text-muted-foreground">
            Cohort metadata is not available in this upload (brand/category_code_level1/event_weekday).
          </div>
        ) : cohortBreakdownData.length > 0 ? (
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%" minWidth={0} debounce={CHART_CONTAINER_DEBOUNCE_MS}>
              <BarChart data={cohortBreakdownData} layout="vertical" margin={{ top: 8, right: 14, left: 8, bottom: 8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border) / 0.42)" />
                <XAxis type="number" tick={{ fontSize: axisTickFontSize }} unit="%" domain={[0, 100]} />
                <YAxis
                  dataKey="cohort"
                  type="category"
                  width={isMobile ? 96 : 140}
                  tick={{ fontSize: axisTickFontSize }}
                  tickFormatter={compactCohortLabel}
                />
                <Tooltip
                  formatter={(value, name, item) => {
                    if (name === 'predictedRate') {
                      const count = typeof item.payload?.count === 'number' ? item.payload.count : 0
                      return [`${Number(value ?? 0).toFixed(1)}% (n=${count})`, 'Predicted rate']
                    }
                    return [`${Number(value ?? 0).toFixed(1)}%`, 'Avg probability']
                  }}
                  labelFormatter={(label) => String(label)}
                  isAnimationActive={false}
                  contentStyle={CHART_TOOLTIP_CONTENT_STYLE}
                  labelStyle={CHART_TOOLTIP_LABEL_STYLE}
                  itemStyle={CHART_TOOLTIP_ITEM_STYLE}
                />
                <Legend />
                <Bar
                  dataKey="predictedRate"
                  name="Predicted rate"
                  fill={CHART_COLORS.actual}
                  radius={[0, 6, 6, 0]}
                  isAnimationActive={false}
                  onClick={(entry) => pushChartFilter(entry.payload?.rowIndexes ?? [], `Cohort ${entry.payload?.cohort ?? ''}`)}
                />
                <Bar
                  dataKey="avgProbability"
                  name="Avg probability"
                  fill={CHART_COLORS.expected}
                  radius={[0, 6, 6, 0]}
                  isAnimationActive={false}
                  onClick={(entry) => pushChartFilter(entry.payload?.rowIndexes ?? [], `Cohort ${entry.payload?.cohort ?? ''}`)}
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <div className="type-body flex h-72 items-center justify-center rounded-lg border border-dashed border-border/65 bg-muted/20 p-3 text-sm text-muted-foreground">
            No cohort groups available for this selection.
          </div>
        )}
        <div className="mt-2 flex justify-start">
          <Button
            variant="outline"
            size="sm"
            className="h-8 border-border/70 px-2.5"
            onClick={() =>
              sendChartToAssistant({
                chart_type: 'cohort_breakdown',
                chart_title: 'Cohort breakdown',
                question: 'Analyze cohort performance and identify the highest-impact segments and actions.',
                series: cohortBreakdownData.map((entry) => ({
                  cohort: entry.cohort,
                  predicted_rate: Number(entry.predictedRate.toFixed(2)),
                  avg_probability: Number(entry.avgProbability.toFixed(2)),
                  sample_count: entry.count,
                })),
                context: {
                  cohort_field: cohortField,
                  cohort_count: cohortBreakdownData.length,
                  simulator_threshold: simulatorThreshold,
                },
                user_message: 'Analyze chart: Cohort breakdown',
                suggested_questions: [
                  'Which cohort should receive priority budget and why?',
                  'Which low-performing cohorts need different treatment strategy?',
                ],
              })
            }
            disabled={cohortBreakdownData.length === 0}
          >
            Analyze with AI
          </Button>
        </div>
      </div>

      <div className="rounded-xl border border-border/70 bg-card/45 p-3.5">
        <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="type-kicker mb-1">Local SHAP waterfall</p>
            <p className="type-caption text-muted-foreground">Top row-level contribution drivers (selected row)</p>
          </div>
          {shapReadyRows.length > 0 ? (
            <div className="flex flex-wrap items-center gap-2">
              <label className="type-caption inline-flex h-8 items-center gap-2 text-xs text-muted-foreground">
                Row
                <select
                  value={String(safeSelectedShapIndex)}
                  onChange={(event) => setSelectedShapRowIndex(Number(event.target.value))}
                  className="h-8 rounded-md border border-border/70 bg-background/70 px-2 text-xs text-foreground"
                  aria-label="Select row for local SHAP waterfall"
                >
                  {shapReadyRows.map((row, index) => (
                    <option key={`${row.rowIndex}-${index}`} value={index}>
                      #{row.rowIndex + 1}
                    </option>
                  ))}
                </select>
              </label>

              <div className="inline-flex h-8 items-center rounded-md border border-border/70 bg-background/65 p-0.5">
                {([5, 10, 'all'] as const).map((limit) => (
                  <button
                    key={String(limit)}
                    type="button"
                    onClick={() => setLocalWaterfallLimit(limit)}
                    className={
                      localWaterfallLimit === limit
                        ? 'type-caption rounded px-2 py-1 text-xs font-semibold text-foreground state-badge-info'
                        : 'type-caption rounded px-2 py-1 text-xs text-muted-foreground hover:text-foreground'
                    }
                    aria-pressed={localWaterfallLimit === limit}
                  >
                    {limit === 'all' ? 'All' : `Top ${limit}`}
                  </button>
                ))}
              </div>

              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  if (!selectedShapRow) return
                  exportCsvFile(
                    `shap_row_${selectedShapRow.rowIndex + 1}.csv`,
                    ['feature', 'display_name', 'shap_contribution'],
                    localWaterfallData.map((item) => [item.feature, item.label, item.shap])
                  )
                }}
                className="h-8 min-w-28 border-border/70 px-2.5"
                disabled={!selectedShapRow || localWaterfallData.length === 0}
              >
                <Download className="mr-1.5 h-3.5 w-3.5" />
                Row CSV
              </Button>

              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  if (safeSelectedShapIndex === pinnedShapRowIndex) {
                    setPinnedShapRowIndex(null)
                    return
                  }
                  setPinnedShapRowIndex(safeSelectedShapIndex)
                }}
                className="h-8 min-w-28 border-border/70 px-2.5"
                disabled={!selectedShapRow}
              >
                {safeSelectedShapIndex === pinnedShapRowIndex ? 'Unpin row' : 'Pin row'}
              </Button>

            </div>
          ) : null}
        </div>
        {selectedShapRow ? (
          <>
            <div className="mb-3 grid grid-cols-2 gap-2 text-[11px] sm:grid-cols-4">
              <div className="flex min-h-[96px] flex-col justify-between rounded-md border border-border/60 bg-background/45 px-2 py-1.5">
                <p className="type-caption min-h-[2.5rem] text-muted-foreground">Row</p>
                <p className="type-metric text-sm font-semibold leading-none">#{selectedShapRow.rowIndex + 1}</p>
              </div>
              <div className="flex min-h-[96px] flex-col justify-between rounded-md border border-border/60 bg-background/45 px-2 py-1.5">
                <p className="type-caption min-h-[2.5rem] text-muted-foreground">Predicted p</p>
                <p className="type-metric text-sm font-semibold leading-none">{selectedShapProbability !== null && selectedShapProbability !== undefined ? formatPct(selectedShapProbability * 100) : 'N/A'}</p>
              </div>
              <div className="flex min-h-[96px] flex-col justify-between rounded-md border border-border/60 bg-background/45 px-2 py-1.5">
                <p className="type-caption min-h-[2.5rem] text-muted-foreground">Baseline</p>
                <p className="type-metric text-sm font-semibold leading-none">{selectedShapBaseline.toFixed(4)}</p>
              </div>
              <div className="flex min-h-[96px] flex-col justify-between rounded-md border border-border/60 bg-background/45 px-2 py-1.5">
                <p className="type-caption min-h-[2.5rem] text-muted-foreground">Signals</p>
                <p className="type-metric text-sm font-semibold leading-none">{localWaterfallData.length}</p>
              </div>
            </div>

            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%" minWidth={0} debounce={CHART_CONTAINER_DEBOUNCE_MS}>
                <BarChart data={localWaterfallData} layout="vertical" margin={{ top: 8, right: 16, left: 20, bottom: 8 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border) / 0.42)" />
                  <XAxis type="number" tick={{ fontSize: axisTickFontSize }} domain={[-localWaterfallMax, localWaterfallMax]} />
                  <YAxis
                    dataKey="label"
                    type="category"
                    width={yAxisLabelWidth}
                    tick={isMobile ? renderFeatureAxisTick : { fontSize: axisTickFontSize }}
                    tickFormatter={isMobile ? undefined : compactFeatureLabel}
                  />
                  <Tooltip
                    formatter={(value) => [Number(value ?? 0).toFixed(4), 'SHAP contribution']}
                    isAnimationActive={false}
                    contentStyle={CHART_TOOLTIP_CONTENT_STYLE}
                    labelStyle={CHART_TOOLTIP_LABEL_STYLE}
                    itemStyle={CHART_TOOLTIP_ITEM_STYLE}
                  />
                  <ReferenceLine x={0} stroke={hexToRgba(CHART_COLORS.expected, 0.8)} />
                  <Bar dataKey="shap" name="SHAP contribution" radius={[0, 6, 6, 0]} isAnimationActive={false}>
                    {localWaterfallData.map((entry) => (
                      <Cell key={entry.feature} fill={entry.shap >= 0 ? CHART_COLORS.actual : CHART_COLORS.error} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>

            {pinnedShapRow && pinnedShapRow !== selectedShapRow && localComparisonData.length > 0 ? (
              <div className="mt-4 rounded-lg border border-border/65 bg-background/35 p-3">
                <p className="type-caption mb-2 text-xs font-semibold text-foreground/90">
                  Compare row #{selectedShapRow.rowIndex + 1} vs pinned #{pinnedShapRow.rowIndex + 1}
                </p>
                <div className="h-52">
                  <ResponsiveContainer width="100%" height="100%" minWidth={0} debounce={CHART_CONTAINER_DEBOUNCE_MS}>
                    <BarChart data={localComparisonData} margin={{ top: 6, right: 12, left: -8, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border) / 0.42)" />
                      <XAxis dataKey="label" tick={{ fontSize: 10 }} interval={0} angle={-20} textAnchor="end" height={54} />
                      <YAxis tick={{ fontSize: 10 }} />
                      <Tooltip
                        isAnimationActive={false}
                        contentStyle={CHART_TOOLTIP_CONTENT_STYLE}
                        labelStyle={CHART_TOOLTIP_LABEL_STYLE}
                        itemStyle={CHART_TOOLTIP_ITEM_STYLE}
                        formatter={(value) => [Number(value ?? 0).toFixed(4), 'SHAP']}
                      />
                      <Legend />
                      <Bar dataKey="selected" name={`Row #${selectedShapRow.rowIndex + 1}`} fill={CHART_COLORS.actual} radius={[4, 4, 0, 0]} isAnimationActive={false} />
                      <Bar dataKey="pinned" name={`Pinned #${pinnedShapRow.rowIndex + 1}`} fill={CHART_COLORS.expected} radius={[4, 4, 0, 0]} isAnimationActive={false} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
                <div className="mt-2 flex justify-start">
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 border-border/70 px-2 text-xs"
                    onClick={() =>
                      sendChartToAssistant({
                        chart_type: 'local_shap_comparison',
                        chart_title: `Local SHAP comparison row #${selectedShapRow.rowIndex + 1} vs #${pinnedShapRow.rowIndex + 1}`,
                        question: 'Analyze SHAP differences between selected and pinned rows to explain behavior gap.',
                        series: localComparisonData.map((item) => ({
                          feature: item.feature,
                          display_name: item.label,
                          selected_row_shap: Number(item.selected.toFixed(6)),
                          pinned_row_shap: Number(item.pinned.toFixed(6)),
                          delta_abs: Number(item.delta.toFixed(6)),
                        })),
                        context: {
                          selected_row: selectedShapRow.rowIndex + 1,
                          pinned_row: pinnedShapRow.rowIndex + 1,
                          compared_features: localComparisonData.length,
                          simulator_threshold: simulatorThreshold,
                        },
                        user_message: `Analyze chart: Local SHAP comparison row #${selectedShapRow.rowIndex + 1} vs #${pinnedShapRow.rowIndex + 1}`,
                        suggested_questions: [
                          'Which feature deltas most explain why these two rows differ?',
                          'What actionable change could make the selected row look like the better row?',
                        ],
                      })
                    }
                  >
                    Analyze with AI
                  </Button>
                </div>
              </div>
            ) : null}
          </>
        ) : (
          <div className="type-body flex h-64 items-center justify-center rounded-lg border border-dashed border-border/65 bg-muted/20 p-3 text-sm text-muted-foreground">
            Local SHAP waterfall will appear when feature contribution data is available.
          </div>
        )}
        <div className="mt-2 flex justify-start">
          <Button
            variant="outline"
            size="sm"
            className="h-8 min-w-32 border-border/70 px-2.5"
            onClick={() => {
              if (!selectedShapRow || localWaterfallData.length === 0) return

              sendChartToAssistant({
                chart_type: 'local_shap_waterfall',
                chart_title: `Local SHAP waterfall (row #${selectedShapRow.rowIndex + 1})`,
                question: 'Analyze local SHAP contributions for this row and suggest targeted action.',
                series: localWaterfallData.map((item) => ({
                  feature: item.feature,
                  display_name: item.label,
                  shap_contribution: Number(item.shap.toFixed(6)),
                })),
                context: {
                  row_index: selectedShapRow.rowIndex + 1,
                  predicted_probability_pct:
                    selectedShapProbability !== null && selectedShapProbability !== undefined
                      ? Number((selectedShapProbability * 100).toFixed(2))
                      : null,
                  baseline_score: Number(selectedShapBaseline.toFixed(6)),
                  signals_count: localWaterfallData.length,
                  simulator_threshold: simulatorThreshold,
                },
                user_message: `Analyze chart: Local SHAP waterfall row #${selectedShapRow.rowIndex + 1}`,
                suggested_questions: [
                  'Which top positive/negative SHAP drivers should we act on first?',
                  'What concrete intervention could shift this row toward purchase?',
                ],
              })
            }}
            disabled={!selectedShapRow || localWaterfallData.length === 0}
          >
            Analyze with AI
          </Button>
        </div>
      </div>

      <div className="rounded-xl border border-border/70 bg-card/45 p-3.5">
        <div className="mb-3 flex items-start justify-between gap-3">
          <div>
            <p className="type-kicker mb-1">Decision confidence bands</p>
            <p className="type-caption text-muted-foreground">Rows grouped by distance from each row threshold</p>
          </div>
          <span className="type-caption state-badge-warning inline-flex items-center rounded-full px-2.5 py-1 font-semibold">
            Uncertain zone: {formatPct(confidenceInsights.nearThresholdPct)}
          </span>
        </div>
        <div className="h-72">
          <ResponsiveContainer width="100%" height="100%" minWidth={0} debounce={CHART_CONTAINER_DEBOUNCE_MS}>
            <BarChart data={thresholdBands} layout="vertical" margin={{ top: 8, right: 16, left: 12, bottom: 8 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border) / 0.42)" />
              <XAxis type="number" allowDecimals={false} tick={{ fontSize: axisTickFontSize }} />
              <YAxis
                dataKey="name"
                type="category"
                width={isMobile ? 88 : 118}
                tick={isMobile ? renderBandAxisTick : { fontSize: axisTickFontSize }}
                tickFormatter={isMobile ? undefined : compactBandLabel}
              />
              <Tooltip
                formatter={(value) => [`${Number(value ?? 0)} rows`, 'Count']}
                isAnimationActive={false}
                contentStyle={CHART_TOOLTIP_CONTENT_STYLE}
                labelStyle={CHART_TOOLTIP_LABEL_STYLE}
                itemStyle={CHART_TOOLTIP_ITEM_STYLE}
              />
              <Bar dataKey="count" radius={[0, 6, 6, 0]} isAnimationActive={false}>
                {thresholdBands.map((entry) => (
                  <Cell
                    key={entry.name}
                    fill={entry.color}
                    style={{ cursor: entry.count > 0 ? 'pointer' : 'default' }}
                    onClick={() => pushChartFilter(entry.rowIndexes, `Confidence band: ${entry.name}`)}
                  />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
        <div className="mt-2 flex justify-start">
          <Button
            variant="outline"
            size="sm"
            className="h-8 border-border/70 px-2.5"
            onClick={() =>
              sendChartToAssistant({
                chart_type: 'decision_confidence_bands',
                chart_title: 'Decision confidence bands',
                question: 'Analyze confidence bands and recommend threshold or review actions.',
                series: thresholdBands.map((entry) => ({
                  band: entry.name,
                  count: entry.count,
                })),
                context: {
                  uncertain_pct: Number(confidenceInsights.nearThresholdPct.toFixed(2)),
                  high_positive_pct: Number(confidenceInsights.highPositivePct.toFixed(2)),
                  simulator_threshold: simulatorThreshold,
                  high_confidence_margin: HIGH_CONFIDENCE_MARGIN,
                  uncertainty_margin: UNCERTAINTY_MARGIN,
                },
                user_message: 'Analyze chart: Decision confidence bands',
                suggested_questions: [
                  'What policy should we apply to near-threshold rows this week?',
                  'How should threshold shift to reduce uncertainty while keeping coverage?',
                ],
              })
            }
          >
            Analyze with AI
          </Button>
        </div>
        {bandLabelHint ? (
          <button
            type="button"
            onClick={() => setBandLabelHint(null)}
            className="type-caption mt-2 inline-flex items-center rounded-md border border-border/70 bg-background/55 px-2.5 py-1 text-[11px] text-muted-foreground hover:bg-muted/40"
            title="Tap to dismiss"
          >
            Label: {bandLabelHint}
          </button>
        ) : null}
      </div>

      <div className="rounded-xl border border-border/70 bg-card/45 p-3.5">
        <div className="mb-3 flex items-start justify-between gap-3">
          <div>
            <p className="type-kicker mb-1">Predicted purchase by decile</p>
            <p className="type-caption text-muted-foreground">Top-score buckets (D1 high score → D10 low score)</p>
          </div>
          <span className="type-caption state-badge-success inline-flex items-center rounded-full px-2.5 py-1 font-semibold">
            D1 rate: {formatPct(decileTopRate)}
          </span>
        </div>
        <div className="h-60">
          <ResponsiveContainer width="100%" height="100%" minWidth={0} debounce={CHART_CONTAINER_DEBOUNCE_MS}>
            <BarChart data={decileWithVisuals} margin={{ top: 8, right: 8, left: -20, bottom: 8 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border) / 0.42)" />
              <XAxis
                dataKey="decile"
                tick={{ fontSize: axisTickFontSize }}
                angle={isMobile ? -24 : 0}
                textAnchor={isMobile ? 'end' : 'middle'}
                height={isMobile ? 42 : 30}
              />
              <YAxis tick={{ fontSize: axisTickFontSize }} unit="%" />
              <Tooltip
                formatter={(value) => [`${Number(value ?? 0).toFixed(1)}%`, 'Predicted purchase rate']}
                isAnimationActive={false}
                contentStyle={CHART_TOOLTIP_CONTENT_STYLE}
                labelStyle={CHART_TOOLTIP_LABEL_STYLE}
                itemStyle={CHART_TOOLTIP_ITEM_STYLE}
              />
              <ReferenceLine y={overallPredictedRate} stroke={CHART_COLORS.expected} strokeDasharray="5 4" ifOverflow="extendDomain" />
              <Bar dataKey="purchaseRate" radius={[6, 6, 0, 0]} isAnimationActive={false}>
                {decileWithVisuals.map((entry) => (
                  <Cell
                    key={entry.decile}
                    fill={entry.fill}
                    style={{ cursor: entry.rowIndexes.length > 0 ? 'pointer' : 'default' }}
                    onClick={() => pushChartFilter(entry.rowIndexes, `Decile ${entry.decile}`)}
                  />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
        <div className="mt-2 flex justify-start">
          <Button
            variant="outline"
            size="sm"
            className="h-8 border-border/70 px-2.5"
            onClick={() =>
              sendChartToAssistant({
                chart_type: 'predicted_purchase_by_decile',
                chart_title: 'Predicted purchase by decile',
                question: 'Analyze decile distribution and suggest audience prioritization actions.',
                series: decileWithVisuals.map((entry) => ({
                  decile: entry.decile,
                  predicted_purchase_rate: Number(entry.purchaseRate.toFixed(2)),
                })),
                context: {
                  overall_predicted_rate_pct: Number(overallPredictedRate.toFixed(2)),
                  top_decile_rate_pct: Number(decileTopRate.toFixed(2)),
                  simulator_threshold: simulatorThreshold,
                },
                user_message: 'Analyze chart: Predicted purchase by decile',
                suggested_questions: [
                  'Which deciles should receive the first campaign wave?',
                  'How should we split budget between D1-D3 and D4-D6?',
                ],
              })
            }
          >
            Analyze with AI
          </Button>
        </div>
      </div>

      <div className="rounded-xl border border-border/70 bg-card/45 p-3.5">
        <div className="mb-3 flex items-start justify-between gap-3">
          <div>
            <p className="type-kicker mb-1">Calibration (requires actual labels)</p>
            <p className="type-caption text-muted-foreground">Actual conversion vs predicted probability bins</p>
          </div>

        </div>
        {labeledResults.length > 0 ? (
          <div className="h-60">
            <ResponsiveContainer width="100%" height="100%" minWidth={0} debounce={CHART_CONTAINER_DEBOUNCE_MS}>
              <BarChart data={calibrationData} margin={{ top: 8, right: 8, left: -20, bottom: 8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis dataKey="bin" tick={{ fontSize: axisTickFontSize }} />
                <YAxis tick={{ fontSize: axisTickFontSize }} unit="%" domain={[0, 100]} />
                <Tooltip
                  formatter={(value, name, item) => {
                    const readableName = name === 'actualRate' ? 'Actual positive rate' : 'Expected rate'
                    const count = typeof item.payload?.count === 'number' ? item.payload.count : 0
                    return [`${Number(value ?? 0).toFixed(1)}% (n=${count})`, readableName]
                  }}
                  isAnimationActive={false}
                  contentStyle={CHART_TOOLTIP_CONTENT_STYLE}
                  labelStyle={CHART_TOOLTIP_LABEL_STYLE}
                  itemStyle={CHART_TOOLTIP_ITEM_STYLE}
                />
                <Legend />
                <Bar dataKey="actualRate" name="Actual rate" fill={CALIBRATION_COLORS.actual} radius={[6, 6, 0, 0]} isAnimationActive={false} />
                <Bar dataKey="predictedRate" name="Expected rate" fill={CALIBRATION_COLORS.expected} radius={[6, 6, 0, 0]} isAnimationActive={false} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <div className="type-body flex h-60 items-center justify-center rounded-lg border border-dashed border-border/65 bg-muted/20 p-3 text-sm text-muted-foreground">
            Add `actual_label` in batch results to enable calibration analysis.
          </div>
        )}
        <div className="mt-2 flex justify-start">
          <Button
            variant="outline"
            size="sm"
            className="h-8 border-border/70 px-2.5"
            onClick={() =>
              sendChartToAssistant({
                chart_type: 'calibration_bins',
                chart_title: 'Calibration by probability bins',
                question: 'Analyze calibration quality and identify if the model is over- or under-confident.',
                series: calibrationData.map((entry) => ({
                  bin: entry.bin,
                  expected_rate: Number(entry.predictedRate.toFixed(2)),
                  actual_rate: Number(entry.actualRate.toFixed(2)),
                  sample_count: entry.count,
                })),
                context: {
                  has_actual_labels: labeledResults.length > 0,
                  simulator_threshold: simulatorThreshold,
                },
                user_message: 'Analyze chart: Calibration by probability bins',
                suggested_questions: [
                  'Which bins show the largest calibration gap and need correction?',
                  'Should we trust high-score bins for auto-actions now?',
                ],
              })
            }
            disabled={labeledResults.length === 0}
          >
            Analyze with AI
          </Button>
        </div>
      </div>

      <div className="rounded-xl border border-border/70 bg-card/45 p-3.5">
        <div className="mb-3">
          <p className="type-kicker mb-1">Confusion matrix by threshold (requires actual labels)</p>
          <p className="type-caption text-muted-foreground">Evaluate TP/FP/TN/FN with a tunable decision cut-off</p>
        </div>
        {labeledResults.length > 0 ? (
          <>
            <div className="mb-3 rounded-lg border border-border/60 bg-background/45 p-3">
              <div className="flex items-center justify-between">
                <span className="type-caption">Evaluation threshold</span>
                <span className="type-metric text-sm font-semibold">
                  {simulatorThreshold !== null ? simulatorThreshold.toFixed(2) : 'Per-row default'}
                </span>
              </div>
              <div className="mt-2 grid grid-cols-2 gap-2 text-[11px] text-muted-foreground sm:grid-cols-4">
                <span>Precision: {(confusionSummary.precision * 100).toFixed(1)}%</span>
                <span>Recall: {(confusionSummary.recall * 100).toFixed(1)}%</span>
                <span>TP: {confusionSummary.tp}</span>
                <span>FN: {confusionSummary.fn}</span>
              </div>
              <p className="type-caption mt-2 text-[11px] text-muted-foreground">
                Threshold is synced from the table simulator to keep summary/charts/table consistent.
              </p>
            </div>
            <div className="grid grid-cols-2 gap-2">
              {confusionHeatmap.map((cell) => (
                <div
                  key={cell.short}
                  className="rounded-lg border p-3 transition-colors duration-200"
                  style={getHeatCellStyle(cell.tone, cell.intensity)}
                >
                  <p className="type-caption text-[11px] text-foreground/80">{cell.title}</p>
                  <p className="type-metric mt-1 text-xl font-semibold text-foreground">{cell.count}</p>
                  <p className="type-caption text-[11px] text-foreground/75">{cell.short}</p>
                </div>
              ))}
            </div>
          </>
        ) : (
          <div className="type-body flex h-60 items-center justify-center rounded-lg border border-dashed border-border/65 bg-muted/20 p-3 text-sm text-muted-foreground">
            Add `actual_label` in batch results to enable threshold confusion analysis.
          </div>
        )}
        <div className="mt-2 flex justify-start">
          <Button
            variant="outline"
            size="sm"
            className="h-8 border-border/70 px-2.5"
            onClick={() =>
              sendChartToAssistant({
                chart_type: 'confusion_matrix_threshold',
                chart_title: 'Confusion matrix by threshold',
                question: 'Analyze confusion matrix metrics and recommend threshold actions for business trade-offs.',
                series: confusionHeatmap.map((cell) => ({
                  cell: cell.short,
                  label: cell.title,
                  count: cell.count,
                })),
                context: {
                  precision_pct: Number((confusionSummary.precision * 100).toFixed(2)),
                  recall_pct: Number((confusionSummary.recall * 100).toFixed(2)),
                  tp: confusionSummary.tp,
                  fp: confusionSummary.fp,
                  tn: confusionSummary.tn,
                  fn: confusionSummary.fn,
                  simulator_threshold: simulatorThreshold,
                },
                user_message: 'Analyze chart: Confusion matrix by threshold',
                suggested_questions: [
                  'What threshold change gives the best precision-recall tradeoff for operations?',
                  'Where is the biggest avoidable error cost in TP/FP/FN/TN today?',
                ],
              })
            }
            disabled={labeledResults.length === 0}
          >
            Analyze with AI
          </Button>
        </div>
      </div>

      {featureLabelHint ? (
        <div className="xl:col-span-2">
          <button
            type="button"
            onClick={() => setFeatureLabelHint(null)}
            className="type-caption mt-1 inline-flex items-center rounded-md border border-border/70 bg-background/55 px-2.5 py-1 text-[11px] text-muted-foreground hover:bg-muted/40"
            title="Tap to dismiss"
          >
            Label: {featureLabelHint}
          </button>
        </div>
      ) : null}
    </div>
  )
})

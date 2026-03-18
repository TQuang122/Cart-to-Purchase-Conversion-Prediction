import { useCallback, useMemo, useState } from 'react'
import { Search, ArrowUpDown, Download, CheckCircle2, XCircle } from 'lucide-react'

import type { CartPrediction } from '@/types/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  HIGH_CONFIDENCE_MARGIN,
  UNCERTAINTY_MARGIN,
  getDecisionThreshold,
  isHighConfidence,
} from '@/lib/predictionConfidence'
import { cn } from '@/lib/utils'

interface BatchResultsTableProps {
  results: CartPrediction[]
  simulatorThreshold: number | null
  onSimulatorThresholdChange: (threshold: number | null) => void
  externalRowIndexes: number[] | null
  externalFilterLabel: string | null
  onClearExternalFilter: () => void
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

type SortField = 'index' | 'is_purchased' | 'probability'
type SortOrder = 'asc' | 'desc'
type ResultFilter = 'all' | 'purchased' | 'not_purchased' | 'high_confidence'

const PREVIEW_ROW_LIMIT = 10

const parseProbabilityFilterInput = (rawValue: string): number | null => {
  const trimmed = rawValue.trim().replace('%', '').replace(',', '.')
  if (!trimmed) return null

  const parsed = Number(trimmed)
  if (!Number.isFinite(parsed)) return null

  const normalized = parsed > 1 ? parsed / 100 : parsed
  if (normalized < 0 || normalized > 1) return null

  return normalized
}

export const BatchResultsTable = ({
  results,
  simulatorThreshold,
  onSimulatorThresholdChange,
  externalRowIndexes,
  externalFilterLabel,
  onClearExternalFilter,
}: BatchResultsTableProps) => {
  const [searchQuery, setSearchQuery] = useState('')
  const [minProbability, setMinProbability] = useState('')
  const [maxProbability, setMaxProbability] = useState('')
  const [sortField, setSortField] = useState<SortField>('index')
  const [sortOrder, setSortOrder] = useState<SortOrder>('asc')
  const [showFilters, setShowFilters] = useState(false)
  const [resultFilter, setResultFilter] = useState<ResultFilter>('all')
  const [showAllRows, setShowAllRows] = useState(false)

  const externalRowIndexSet = useMemo(
    () => (externalRowIndexes ? new Set(externalRowIndexes) : null),
    [externalRowIndexes]
  )

  const effectiveThresholdFor = useCallback(
    (item: CartPrediction) => simulatorThreshold ?? getDecisionThreshold(item),
    [simulatorThreshold]
  )

  const effectivePredictionFor = useCallback((item: CartPrediction) => {
    if (item.probability === null) return item.is_purchased
    return item.probability >= effectiveThresholdFor(item) ? 1 : 0
  }, [effectiveThresholdFor])

  const effectiveHighConfidenceFor = useCallback((item: CartPrediction) => {
    if (simulatorThreshold === null) return isHighConfidence(item)
    if (item.probability === null) return false
    return Math.abs(item.probability - effectiveThresholdFor(item)) >= HIGH_CONFIDENCE_MARGIN
  }, [effectiveThresholdFor, simulatorThreshold])

  const metrics = useMemo(() => {
    const total = results.length
    const purchased = results.filter((item) => effectivePredictionFor(item) === 1).length
    const notPurchased = total - purchased
    const highConfidence = results.filter((item) => effectiveHighConfidenceFor(item)).length
    const validProbabilities = results
      .map((item) => item.probability)
      .filter((probability): probability is number => probability !== null)
    const averageProbability =
      validProbabilities.length > 0
        ? validProbabilities.reduce((acc, value) => acc + value, 0) / validProbabilities.length
        : 0

    return {
      total,
      purchased,
      notPurchased,
      highConfidence,
      averageProbability,
      purchaseRate: total > 0 ? purchased / total : 0,
    }
  }, [effectiveHighConfidenceFor, effectivePredictionFor, results])

  const flipCount = useMemo(() => {
    if (simulatorThreshold === null) return 0
    return results.filter(
      (item) => item.probability !== null && effectivePredictionFor(item) !== item.is_purchased
    ).length
  }, [effectivePredictionFor, results, simulatorThreshold])

  const filteredAndSortedResults = useMemo(() => {
    let filtered = [...results]
    const min = parseProbabilityFilterInput(minProbability)
    const max = parseProbabilityFilterInput(maxProbability)
    const lowerBound = min !== null && max !== null ? Math.min(min, max) : min
    const upperBound = min !== null && max !== null ? Math.max(min, max) : max

    // Apply search filter (by index)
    if (searchQuery) {
      const query = searchQuery.toLowerCase()
      filtered = filtered.filter((_, index) =>
        String(index + 1).includes(query)
      )
    }

    if (resultFilter === 'purchased') {
      filtered = filtered.filter((item) => effectivePredictionFor(item) === 1)
    }
    if (resultFilter === 'not_purchased') {
      filtered = filtered.filter((item) => effectivePredictionFor(item) === 0)
    }
    if (resultFilter === 'high_confidence') {
      filtered = filtered.filter((item) => effectiveHighConfidenceFor(item))
    }

    if (externalRowIndexSet) {
      filtered = filtered.filter((item) => externalRowIndexSet.has(results.indexOf(item)))
    }

    // Apply probability filters
    if (lowerBound !== null) {
      filtered = filtered.filter(
        r => r.probability !== null && r.probability >= lowerBound
      )
    }
    if (upperBound !== null) {
      filtered = filtered.filter(
        r => r.probability !== null && r.probability <= upperBound
      )
    }

    // Apply sorting
    filtered.sort((a, b) => {
      let aVal: number, bVal: number
      switch (sortField) {
        case 'is_purchased':
          aVal = effectivePredictionFor(a)
          bVal = effectivePredictionFor(b)
          break
        case 'probability':
          aVal = a.probability ?? 0
          bVal = b.probability ?? 0
          break
        default: {
          // index - use original position
          const idxA = results.indexOf(a)
          const idxB = results.indexOf(b)
          aVal = idxA
          bVal = idxB
          break
        }
      }
      return sortOrder === 'asc' ? aVal - bVal : bVal - aVal
    })

    return filtered
  }, [effectiveHighConfidenceFor, effectivePredictionFor, externalRowIndexSet, maxProbability, minProbability, resultFilter, results, searchQuery, sortField, sortOrder])

  const canExpandRows = filteredAndSortedResults.length > PREVIEW_ROW_LIMIT

  const visibleResults = useMemo(() => {
    if (showAllRows || !canExpandRows) return filteredAndSortedResults
    return filteredAndSortedResults.slice(0, PREVIEW_ROW_LIMIT)
  }, [canExpandRows, filteredAndSortedResults, showAllRows])

  const exportFilteredCsv = () => {
    const rows = filteredAndSortedResults.map((item) => {
      const rowNumber = results.indexOf(item) + 1
      return `${rowNumber},${item.is_purchased},${effectivePredictionFor(item)},${item.probability ?? ''},${effectiveThresholdFor(item).toFixed(4)}`
    })
    const content = ['row,original_is_purchased,simulated_is_purchased,probability,threshold_applied', ...rows].join('\n')
    const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = 'batch_prediction_results_filtered.csv'
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    URL.revokeObjectURL(url)
  }

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc')
    } else {
      setSortField(field)
      setSortOrder('asc')
    }
  }

  const renderSortIcon = (field: SortField) => {
    if (sortField !== field) return null
    return (
      <ArrowUpDown className={cn('ml-1 h-3 w-3 inline', sortOrder === 'desc' && 'rotate-180')} />
    )
  }

  const getAriaSort = (field: SortField): 'ascending' | 'descending' | 'none' => {
    if (sortField !== field) return 'none'
    return sortOrder === 'asc' ? 'ascending' : 'descending'
  }

  const handleHeaderKeyDown = (event: React.KeyboardEvent<HTMLTableCellElement>, field: SortField) => {
    if (event.key !== 'Enter' && event.key !== ' ') return
    event.preventDefault()
    handleSort(field)
  }

  const sendAnalyzeCurrentFilteredView = () => {
    const sampleRows = filteredAndSortedResults.slice(0, 60).map((item, index) => ({
      row: index + 1,
      probability: item.probability,
      effective_prediction: effectivePredictionFor(item),
      high_confidence: effectiveHighConfidenceFor(item),
      actual_label: item.actual_label ?? null,
    }))

    const payload: ChartAnalyzeEventPayload = {
      chart_type: 'filtered_table_view',
      chart_title: 'Current filtered view',
      question: 'Analyze the currently filtered table view and provide concise actions.',
      series: sampleRows,
      context: {
        total_filtered_rows: filteredAndSortedResults.length,
        result_filter: resultFilter,
        search_query: searchQuery,
        probability_min: parseProbabilityFilterInput(minProbability),
        probability_max: parseProbabilityFilterInput(maxProbability),
        simulator_threshold: simulatorThreshold,
        external_filter_label: externalFilterLabel,
        sampled_rows: sampleRows.length,
      },
      user_message: 'Analyze current filtered view',
      suggested_questions: [
        'What is the top operational action for this filtered cohort?',
        'Which risk flags should be applied before activation?',
      ],
    }

    window.dispatchEvent(new CustomEvent<ChartAnalyzeEventPayload>('chatbot:analyze-chart', { detail: payload }))
  }

  return (
    <div className="space-y-5">
      <div className="rounded-xl border border-border/60 bg-card/40 p-4 backdrop-blur-sm">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="relative max-w-sm flex-1">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
                        placeholder="Search by row number…"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="h-11 border-border/70 bg-background/70 pl-9 focus-visible:ring-ring/45"
              aria-label="Search by row number"
            />
          </div>
          <div className="flex items-center gap-2 sm:justify-end">
            <Button
              variant="outline"
              size="sm"
              onClick={sendAnalyzeCurrentFilteredView}
              className="h-11 border-border/70 px-4 transition-[border-color,background-color] duration-200 hover:border-[hsl(var(--interactive)/0.5)] hover:bg-[hsl(var(--interactive)/0.12)]"
              disabled={filteredAndSortedResults.length === 0}
            >
              Analyze current view
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={exportFilteredCsv}
              className="h-11 border-border/70 px-4 transition-[border-color,background-color] duration-200 hover:border-[hsl(var(--interactive)/0.5)] hover:bg-[hsl(var(--interactive)/0.12)]"
            >
              <Download className="mr-2 h-4 w-4" />
              Export filtered
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowFilters(!showFilters)}
                          className="h-11 border-border/70 px-4 transition-[border-color,background-color] duration-200 hover:border-[hsl(var(--interactive)/0.5)] hover:bg-[hsl(var(--interactive)/0.12)]"
            >
              <ArrowUpDown className="mr-2 h-4 w-4" />
              {showFilters ? 'Hide' : 'Show'} Filters
            </Button>
          </div>
        </div>

        <div className="mt-4 rounded-xl border border-border/60 bg-muted/35 p-3">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
            <div className="rounded-lg border border-border/60 bg-card/60 p-3">
              <p className="type-caption">Purchase rate</p>
              <p className="type-metric mt-1 text-sm font-semibold">{(metrics.purchaseRate * 100).toFixed(1)}%</p>
            </div>
            <div className="rounded-lg border border-border/60 bg-card/60 p-3">
              <p className="type-caption">Avg probability</p>
              <p className="type-metric mt-1 text-sm font-semibold">{(metrics.averageProbability * 100).toFixed(1)}%</p>
            </div>
            <div className="rounded-lg border border-border/60 bg-card/60 p-3">
              <p className="type-caption">High confidence</p>
              <p className="type-metric mt-1 text-sm font-semibold">{metrics.highConfidence}</p>
            </div>
            <div className="rounded-lg border border-border/60 bg-card/60 p-3">
              <p className="type-caption">Rows</p>
              <p className="type-metric mt-1 text-sm font-semibold">{metrics.total}</p>
            </div>
          </div>
          <div className="mt-3 h-2.5 overflow-hidden rounded-full bg-muted/55" aria-hidden="true">
            <div className="flex h-full w-full">
              <div className="state-fill-success" style={{ width: `${metrics.total > 0 ? (metrics.purchased / metrics.total) * 100 : 0}%` }} />
              <div className="state-fill-error" style={{ width: `${metrics.total > 0 ? (metrics.notPurchased / metrics.total) * 100 : 0}%` }} />
            </div>
          </div>
          <div className="mt-2 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setResultFilter('all')}
              className={cn('type-caption rounded-md px-2.5 py-1.5 font-medium transition-colors', resultFilter === 'all' ? 'state-badge-info' : 'text-muted-foreground hover:text-foreground')}
              aria-pressed={resultFilter === 'all'}
            >
              All
            </button>
            <button
              type="button"
              onClick={() => setResultFilter('purchased')}
              className={cn('type-caption rounded-md px-2.5 py-1.5 font-medium transition-colors', resultFilter === 'purchased' ? 'state-badge-success' : 'text-muted-foreground hover:text-foreground')}
              aria-pressed={resultFilter === 'purchased'}
            >
              Purchased only
            </button>
            <button
              type="button"
              onClick={() => setResultFilter('not_purchased')}
              className={cn('type-caption rounded-md px-2.5 py-1.5 font-medium transition-colors', resultFilter === 'not_purchased' ? 'state-badge-error' : 'text-muted-foreground hover:text-foreground')}
              aria-pressed={resultFilter === 'not_purchased'}
            >
              Not purchased only
            </button>
            <button
              type="button"
              onClick={() => setResultFilter('high_confidence')}
              className={cn('type-caption rounded-md px-2.5 py-1.5 font-medium transition-colors', resultFilter === 'high_confidence' ? 'state-badge-warning' : 'text-muted-foreground hover:text-foreground')}
              aria-pressed={resultFilter === 'high_confidence'}
            >
              High confidence (&ge; 15 pts from threshold)
            </button>
          </div>

          <div className="mt-3 rounded-lg border border-border/60 bg-background/40 p-3">
            <div className="flex items-center justify-between gap-3">
              <span className="type-caption text-xs text-muted-foreground">
                Threshold simulator {simulatorThreshold !== null ? '(active)' : '(off)'}
              </span>
              <span className="type-metric text-sm font-semibold text-foreground">
                {simulatorThreshold !== null ? simulatorThreshold.toFixed(3) : 'Default per-row'}
              </span>
            </div>
            <input
              type="range"
              min="0"
              max="1"
              step="0.01"
              value={simulatorThreshold ?? 0.5}
              onChange={(event) => onSimulatorThresholdChange(Number(event.target.value))}
              className="mt-2 w-full accent-[hsl(var(--interactive))]"
              aria-label="Threshold simulator"
            />
            <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
              <span className="type-caption text-xs text-muted-foreground">
                Flip count: <span className="font-semibold text-foreground">{flipCount}</span>
              </span>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 px-2 text-xs"
                onClick={() => onSimulatorThresholdChange(null)}
                disabled={simulatorThreshold === null}
              >
                Reset simulator
              </Button>
            </div>
          </div>

          {externalRowIndexSet ? (
            <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[hsl(var(--interactive)/0.45)] bg-[hsl(var(--interactive)/0.1)] px-3 py-2">
              <span className="type-caption text-xs text-foreground/90">
                Chart filter active: {externalFilterLabel ?? `${externalRowIndexes?.length ?? 0} rows`}
              </span>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 px-2 text-xs"
                onClick={onClearExternalFilter}
              >
                Clear chart filter
              </Button>
            </div>
          ) : null}
        </div>

        <div
          aria-hidden={!showFilters}
          className={cn(
                        'grid transition-[max-height,opacity,transform] duration-300 ease-out',
            showFilters
              ? 'mt-4 grid-rows-[1fr] opacity-100'
              : 'pointer-events-none mt-0 grid-rows-[0fr] opacity-0'
          )}
        >
          <div className="overflow-hidden">
            <div className="flex flex-wrap items-center gap-3 rounded-xl border border-border/60 bg-muted/35 p-3">
              <span className="type-body text-sm font-medium text-muted-foreground">Probability range</span>
              <span className="type-caption text-xs text-muted-foreground">Supports 0-1 or 0-100%</span>
              {parseProbabilityFilterInput(minProbability) !== null || parseProbabilityFilterInput(maxProbability) !== null ? (
                <span className="type-caption state-badge-info inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium">
                  Applied: {((parseProbabilityFilterInput(minProbability) ?? 0) * 100).toFixed(1)}%-{((parseProbabilityFilterInput(maxProbability) ?? 1) * 100).toFixed(1)}%
                </span>
              ) : null}
              <div className="flex items-center gap-2">
                <Input
                  type="number"
                  placeholder="Min"
                  min="0"
                  max="100"
                  step="0.01"
                  value={minProbability}
                  onChange={(e) => setMinProbability(e.target.value)}
                  className="h-9 w-24 border-border/70 bg-background/70"
                  aria-label="Minimum probability"
                />
                <span className="text-muted-foreground">-</span>
                <Input
                  type="number"
                  placeholder="Max"
                  min="0"
                  max="100"
                  step="0.01"
                  value={maxProbability}
                  onChange={(e) => setMaxProbability(e.target.value)}
                  className="h-9 w-24 border-border/70 bg-background/70"
                  aria-label="Maximum probability"
                />
              </div>
              {(minProbability || maxProbability) && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setMinProbability('')
                    setMaxProbability('')
                  }}
                  className="h-9"
                >
                  Clear
                </Button>
              )}
            </div>
          </div>
        </div>

        <div className="type-body mt-4 flex items-center justify-between rounded-lg border border-border/50 bg-background/40 px-3 py-2 text-sm" aria-live="polite" aria-atomic="true">
          <span>Showing rows</span>
          <span className="type-heading text-sm font-medium text-foreground">
            {visibleResults.length} / {filteredAndSortedResults.length} filtered
          </span>
        </div>
        {canExpandRows ? (
          <div className="mt-2 flex justify-end">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowAllRows((prev) => !prev)}
              className="h-9 border-border/70 px-3 transition-[border-color,background-color] duration-200 hover:border-[hsl(var(--interactive)/0.5)] hover:bg-[hsl(var(--interactive)/0.12)]"
            >
              {showAllRows
                ? `Show first ${PREVIEW_ROW_LIMIT} rows`
                : `Show all ${filteredAndSortedResults.length} rows`}
            </Button>
          </div>
        ) : null}
      </div>

      <div className="relative overflow-hidden rounded-xl border border-border/70 bg-card/55 shadow-sm" role="region" aria-label="Batch prediction results table">
        <div className="pointer-events-none absolute bottom-0 left-0 top-0 z-30 w-3 bg-gradient-to-r from-background/80 to-transparent sm:hidden" />
        <div className="pointer-events-none absolute bottom-0 right-0 top-0 z-30 w-4 bg-gradient-to-l from-background/85 to-transparent sm:hidden" />

        <Table
          containerClassName="snap-x snap-mandatory scroll-px-2 [scroll-padding-left:3rem] [scrollbar-width:thin] [-webkit-overflow-scrolling:touch] sm:snap-none"
          className="min-w-[520px] text-xs [&_th]:snap-start [&_td]:snap-none sm:min-w-0 sm:text-sm sm:[&_th]:snap-none sm:[&_td]:snap-none"
          aria-label="Batch prediction results"
        >
          <TableHeader>
            <TableRow className="border-b border-border/70 bg-muted/30">
              <TableHead 
                className="type-kicker sticky left-0 top-0 z-20 h-11 w-12 min-w-12 cursor-pointer border-r border-border/55 bg-card/95 px-2 text-muted-foreground shadow-[10px_0_14px_-12px_rgba(2,6,23,0.95)] backdrop-blur hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/55 focus-visible:ring-offset-2 focus-visible:ring-offset-background sm:w-14 sm:min-w-14 sm:px-3"
                onClick={() => handleSort('index')}
                onKeyDown={(event) => handleHeaderKeyDown(event, 'index')}
                tabIndex={0}
                aria-sort={getAriaSort('index')}
              >
                # {renderSortIcon('index')}
              </TableHead>
              <TableHead 
                className="type-kicker sticky top-0 z-10 h-11 cursor-pointer bg-card/95 text-muted-foreground backdrop-blur hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/55 focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                onClick={() => handleSort('is_purchased')}
                onKeyDown={(event) => handleHeaderKeyDown(event, 'is_purchased')}
                tabIndex={0}
                aria-sort={getAriaSort('is_purchased')}
              >
                Result {renderSortIcon('is_purchased')}
              </TableHead>
              <TableHead 
                className="type-kicker sticky top-0 z-10 h-11 cursor-pointer bg-card/95 text-muted-foreground backdrop-blur hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/55 focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                onClick={() => handleSort('probability')}
                onKeyDown={(event) => handleHeaderKeyDown(event, 'probability')}
                tabIndex={0}
                aria-sort={getAriaSort('probability')}
              >
                Confidence {renderSortIcon('probability')}
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredAndSortedResults.length === 0 ? (
              <TableRow>
                <TableCell colSpan={3} className="h-24 text-center text-muted-foreground">
                  No results match your filters.
                </TableCell>
              </TableRow>
            ) : (
              visibleResults.map((item, idx) => {
                const originalIndex = results.indexOf(item)
                const zebraRowClass = idx % 2 === 0 ? 'bg-background/30' : 'bg-muted/[0.18]'
                const threshold = effectiveThresholdFor(item)
                const thresholdGap = item.probability === null ? null : item.probability - threshold
                const isAboveThreshold = thresholdGap !== null && thresholdGap >= 0
                const isHighProbability = effectiveHighConfidenceFor(item)
                const isNearThreshold = thresholdGap !== null && Math.abs(thresholdGap) < UNCERTAINTY_MARGIN
                const effectivePrediction = effectivePredictionFor(item)
                const rowDensityClass = '[&>td]:py-2.5'
                const rowHighlightClass = isHighProbability && isAboveThreshold
                  ? 'border-l-2 border-l-[hsl(var(--success)/0.72)] bg-[hsl(var(--success)/0.07)]'
                  : isNearThreshold
                  ? 'border-l-2 border-l-[hsl(var(--warning)/0.72)] bg-[hsl(var(--warning)/0.08)]'
                  : ''
                const stickyIndexBgClass = isHighProbability && isAboveThreshold
                  ? 'bg-[hsl(var(--success)/0.14)]'
                  : isNearThreshold
                    ? 'bg-[hsl(var(--warning)/0.15)]'
                  : idx % 2 === 0
                    ? 'bg-background/80'
                    : 'bg-muted/35'

                return (
                  <TableRow 
                    key={`${originalIndex}-${item.is_purchased}-${item.probability ?? 'na'}`}
                    className={cn(
                      'animate-in fade-in duration-200 transition-colors hover:bg-muted/35',
                      zebraRowClass,
                      rowDensityClass,
                      rowHighlightClass
                    )}
                    style={{ animationDelay: `${Math.min(idx * 10, 200)}ms` }}
                  >
                    <TableCell
                      className={cn(
                        'type-metric sticky left-0 z-10 w-12 min-w-12 border-r border-border/50 px-2 text-sm font-semibold text-foreground/95 shadow-[10px_0_14px_-12px_rgba(2,6,23,0.95)] sm:w-14 sm:min-w-14 sm:px-3',
                        stickyIndexBgClass
                      )}
                    >
                      {originalIndex + 1}
                    </TableCell>
                    <TableCell>
                      <span
                        className={cn(
                          'type-caption inline-flex items-center rounded-full px-2.5 py-0.5 font-semibold',
                          effectivePrediction === 1
                            ? 'state-badge-success'
                            : 'state-badge-error'
                        )}
                      >
                        {effectivePrediction === 1 ? (
                          <CheckCircle2 className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
                        ) : (
                          <XCircle className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
                        )}
                        {effectivePrediction === 1 ? 'Purchased' : 'Not purchased'}
                      </span>
                    </TableCell>
                    <TableCell className="min-w-[170px]">
                      {item.probability === null ? (
                        <span className="type-metric text-sm text-muted-foreground">N/A</span>
                      ) : (
                        <div className="flex items-center gap-2">
                          <div className="h-2 w-20 overflow-hidden rounded-full bg-muted">
                            <div
                              className={cn(
                                'h-full',
                                item.probability >= threshold + UNCERTAINTY_MARGIN
                                  ? 'state-fill-success'
                                  : item.probability >= threshold - UNCERTAINTY_MARGIN
                                  ? 'state-fill-warning'
                                  : 'state-fill-error'
                              )}
                              style={{ width: `${item.probability * 100}%` }}
                            />
                          </div>
                          <div className="flex flex-col">
                            <span className="type-metric text-sm font-semibold text-foreground/95">
                              {(item.probability * 100).toFixed(1)}%
                            </span>
                            <span className="type-caption text-[11px] text-muted-foreground">
                              Thr {(threshold * 100).toFixed(1)}%
                            </span>
                          </div>
                        </div>
                      )}
                    </TableCell>
                  </TableRow>
                )
              })
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}

import { useCallback, useMemo, useState } from 'react'
import { ArrowUpDown, CheckCircle2, Download, Search, XCircle } from 'lucide-react'
import {
  type ColumnDef,
  type PaginationState,
  type SortingState,
  type VisibilityState,
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
} from '@tanstack/react-table'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Magnetic } from '@/components/ui/magnetic'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import {
  HIGH_CONFIDENCE_MARGIN,
  UNCERTAINTY_MARGIN,
  getDecisionThreshold,
  isHighConfidence,
} from '@/lib/predictionConfidence'
import { cn } from '@/lib/utils'
import type { CartPrediction } from '@/types/api'

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

type ResultFilter = 'all' | 'purchased' | 'not_purchased' | 'high_confidence'

interface BatchTableRow {
  originalIndex: number
  item: CartPrediction
  effectivePrediction: number
  threshold: number
  thresholdGap: number | null
  isHighConfidence: boolean
}

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
  const [globalFilter, setGlobalFilter] = useState('')
  const [minProbability, setMinProbability] = useState('')
  const [maxProbability, setMaxProbability] = useState('')
  const [showFilters, setShowFilters] = useState(false)
  const [resultFilter, setResultFilter] = useState<ResultFilter>('all')
  const [sorting, setSorting] = useState<SortingState>([{ id: 'row', desc: false }])
  const [columnVisibility, setColumnVisibility] = useState<VisibilityState>({})
  const [pagination, setPagination] = useState<PaginationState>({ pageIndex: 0, pageSize: 10 })

  const externalRowIndexSet = useMemo(
    () => (externalRowIndexes ? new Set(externalRowIndexes) : null),
    [externalRowIndexes],
  )

  const effectiveThresholdFor = useCallback(
    (item: CartPrediction) => simulatorThreshold ?? getDecisionThreshold(item),
    [simulatorThreshold],
  )

  const effectivePredictionFor = useCallback(
    (item: CartPrediction) => {
      if (item.probability === null) return item.is_purchased
      return item.probability >= effectiveThresholdFor(item) ? 1 : 0
    },
    [effectiveThresholdFor],
  )

  const effectiveHighConfidenceFor = useCallback(
    (item: CartPrediction) => {
      if (simulatorThreshold === null) return isHighConfidence(item)
      if (item.probability === null) return false
      return Math.abs(item.probability - effectiveThresholdFor(item)) >= HIGH_CONFIDENCE_MARGIN
    },
    [effectiveThresholdFor, simulatorThreshold],
  )

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
      (item) => item.probability !== null && effectivePredictionFor(item) !== item.is_purchased,
    ).length
  }, [effectivePredictionFor, results, simulatorThreshold])

  const tableRows = useMemo<BatchTableRow[]>(
    () =>
      results.map((item, originalIndex) => {
        const threshold = effectiveThresholdFor(item)
        const thresholdGap = item.probability === null ? null : item.probability - threshold
        return {
          originalIndex,
          item,
          effectivePrediction: effectivePredictionFor(item),
          threshold,
          thresholdGap,
          isHighConfidence: effectiveHighConfidenceFor(item),
        }
      }),
    [effectiveHighConfidenceFor, effectivePredictionFor, effectiveThresholdFor, results],
  )

  const businessFilteredRows = useMemo(() => {
    const min = parseProbabilityFilterInput(minProbability)
    const max = parseProbabilityFilterInput(maxProbability)
    const lowerBound = min !== null && max !== null ? Math.min(min, max) : min
    const upperBound = min !== null && max !== null ? Math.max(min, max) : max

    return tableRows.filter((row) => {
      if (resultFilter === 'purchased' && row.effectivePrediction !== 1) return false
      if (resultFilter === 'not_purchased' && row.effectivePrediction !== 0) return false
      if (resultFilter === 'high_confidence' && !row.isHighConfidence) return false

      if (externalRowIndexSet && !externalRowIndexSet.has(row.originalIndex)) return false

      if (lowerBound !== null && (row.item.probability === null || row.item.probability < lowerBound)) {
        return false
      }

      if (upperBound !== null && (row.item.probability === null || row.item.probability > upperBound)) {
        return false
      }

      return true
    })
  }, [externalRowIndexSet, maxProbability, minProbability, resultFilter, tableRows])

  const columns = useMemo<ColumnDef<BatchTableRow>[]>(
    () => [
      {
        id: 'row',
        accessorFn: (row) => row.originalIndex + 1,
        header: '#',
        enableHiding: false,
        cell: ({ row }) => {
          const value = row.original.originalIndex + 1
          const item = row.original
          const isNearThreshold =
            item.thresholdGap !== null && Math.abs(item.thresholdGap) < UNCERTAINTY_MARGIN
          const stickyIndexBgClass = item.isHighConfidence && item.thresholdGap !== null && item.thresholdGap >= 0
            ? 'bg-[hsl(var(--success)/0.14)]'
            : isNearThreshold
              ? 'bg-[hsl(var(--warning)/0.15)]'
              : row.index % 2 === 0
                ? 'bg-background/80'
                : 'bg-muted/35'

          return (
            <span
              className={cn(
                'type-metric sticky left-0 z-10 block w-12 min-w-12 border-r border-border/50 px-2 text-sm font-semibold text-foreground/95 shadow-[10px_0_14px_-12px_rgba(2,6,23,0.95)] sm:w-14 sm:min-w-14 sm:px-3',
                stickyIndexBgClass,
              )}
            >
              {value}
            </span>
          )
        },
      },
      {
        id: 'result',
        accessorFn: (row) => row.effectivePrediction,
        header: 'Result',
        cell: ({ row }) => (
          <span
            className={cn(
              'type-caption inline-flex items-center rounded-full px-2.5 py-0.5 font-semibold',
              row.original.effectivePrediction === 1 ? 'state-badge-success' : 'state-badge-error',
            )}
          >
            {row.original.effectivePrediction === 1 ? (
              <CheckCircle2 className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
            ) : (
              <XCircle className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
            )}
            {row.original.effectivePrediction === 1 ? 'Purchased' : 'Not purchased'}
          </span>
        ),
      },
      {
        id: 'probability',
        accessorFn: (row) => row.item.probability ?? -1,
        header: 'Confidence',
        cell: ({ row }) => {
          const probability = row.original.item.probability
          if (probability === null) {
            return <span className="type-metric text-sm text-muted-foreground">N/A</span>
          }

          const threshold = row.original.threshold
          return (
            <div className="flex items-center gap-2">
              <div className="h-2 w-20 overflow-hidden rounded-full bg-muted">
                <div
                  className={cn(
                    'h-full',
                    probability >= threshold + UNCERTAINTY_MARGIN
                      ? 'state-fill-success'
                      : probability >= threshold - UNCERTAINTY_MARGIN
                        ? 'state-fill-warning'
                        : 'state-fill-error',
                  )}
                  style={{ width: `${probability * 100}%` }}
                />
              </div>
              <div className="flex flex-col">
                <span className="type-metric text-sm font-semibold text-foreground/95">
                  {(probability * 100).toFixed(1)}%
                </span>
                <span className="type-caption text-[11px] text-muted-foreground">
                  Thr {(threshold * 100).toFixed(1)}%
                </span>
              </div>
            </div>
          )
        },
      },
    ],
    [],
  )

  const table = useReactTable({
    data: businessFilteredRows,
    columns,
    state: {
      globalFilter,
      sorting,
      columnVisibility,
      pagination,
    },
    globalFilterFn: (row, _columnId, filterValue) => {
      if (!filterValue) return true
      const query = String(filterValue).toLowerCase()
      return String(row.original.originalIndex + 1).includes(query)
    },
    onGlobalFilterChange: setGlobalFilter,
    onSortingChange: setSorting,
    onColumnVisibilityChange: setColumnVisibility,
    onPaginationChange: setPagination,
    getCoreRowModel: getCoreRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    getRowId: (row) => String(row.originalIndex),
    autoResetPageIndex: false,
  })

  const sortedFilteredRows = table.getSortedRowModel().rows
  const paginatedRows = table.getRowModel().rows

  const exportFilteredCsv = () => {
    const rows = sortedFilteredRows.map((row) => {
      const item = row.original
      return `${item.originalIndex + 1},${item.item.is_purchased},${item.effectivePrediction},${item.item.probability ?? ''},${item.threshold.toFixed(4)}`
    })

    const content = [
      'row,original_is_purchased,simulated_is_purchased,probability,threshold_applied',
      ...rows,
    ].join('\n')
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

  const sendAnalyzeCurrentFilteredView = () => {
    const sampleRows = sortedFilteredRows.slice(0, 60).map((row, index) => ({
      row: index + 1,
      probability: row.original.item.probability,
      effective_prediction: row.original.effectivePrediction,
      high_confidence: row.original.isHighConfidence,
      actual_label: row.original.item.actual_label ?? null,
    }))

    const payload: ChartAnalyzeEventPayload = {
      chart_type: 'filtered_table_view',
      chart_title: 'Current filtered view',
      question: 'Analyze the currently filtered table view and provide concise actions.',
      series: sampleRows,
      context: {
        total_filtered_rows: sortedFilteredRows.length,
        result_filter: resultFilter,
        search_query: globalFilter,
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

  const totalFilteredRows = table.getFilteredRowModel().rows.length

  return (
    <div className="space-y-5">
      <div className="section-reveal section-delay-2 panel-accent rounded-xl border border-border/60 bg-card/40 p-4 backdrop-blur-sm">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="relative max-w-sm flex-1">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Search by row number..."
              value={globalFilter}
              onChange={(event) => {
                setGlobalFilter(event.target.value)
                table.setPageIndex(0)
              }}
              className="h-11 border-border/70 bg-background/70 pl-9 focus-visible:ring-ring/45"
              aria-label="Search by row number"
            />
          </div>
          <div className="flex flex-wrap items-center gap-2 sm:justify-end">
            <Magnetic intensity={0.14} range={56}>
              <Button
                variant="outline"
                size="sm"
                onClick={sendAnalyzeCurrentFilteredView}
                className="micro-interactive h-11 border-border/70 px-4 transition-[border-color,background-color] duration-200 hover:border-[hsl(var(--interactive)/0.5)] hover:bg-[hsl(var(--interactive)/0.12)]"
                disabled={sortedFilteredRows.length === 0}
              >
                Analyze current view
              </Button>
            </Magnetic>
            <Magnetic intensity={0.14} range={56}>
              <Button
                variant="outline"
                size="sm"
                onClick={exportFilteredCsv}
                className="micro-interactive h-11 border-border/70 px-4 transition-[border-color,background-color] duration-200 hover:border-[hsl(var(--interactive)/0.5)] hover:bg-[hsl(var(--interactive)/0.12)]"
                disabled={sortedFilteredRows.length === 0}
              >
                <Download className="mr-2 h-4 w-4" />
                Export filtered
              </Button>
            </Magnetic>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowFilters((prev) => !prev)}
              className="micro-interactive h-11 border-border/70 px-4 transition-[border-color,background-color] duration-200 hover:border-[hsl(var(--interactive)/0.5)] hover:bg-[hsl(var(--interactive)/0.12)]"
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
            <Magnetic intensity={0.08} range={36}>
            <button
              type="button"
              onClick={() => {
                setResultFilter('all')
                table.setPageIndex(0)
              }}
              className={cn('micro-interactive type-caption rounded-md px-2.5 py-1.5 font-medium transition-colors', resultFilter === 'all' ? 'state-badge-info' : 'text-muted-foreground hover:text-foreground')}
              aria-pressed={resultFilter === 'all'}
            >
              All
            </button>
            </Magnetic>
            <Magnetic intensity={0.08} range={36}>
            <button
              type="button"
              onClick={() => {
                setResultFilter('purchased')
                table.setPageIndex(0)
              }}
              className={cn('micro-interactive type-caption rounded-md px-2.5 py-1.5 font-medium transition-colors', resultFilter === 'purchased' ? 'state-badge-success' : 'text-muted-foreground hover:text-foreground')}
              aria-pressed={resultFilter === 'purchased'}
            >
              Purchased only
            </button>
            </Magnetic>
            <Magnetic intensity={0.08} range={36}>
            <button
              type="button"
              onClick={() => {
                setResultFilter('not_purchased')
                table.setPageIndex(0)
              }}
              className={cn('micro-interactive type-caption rounded-md px-2.5 py-1.5 font-medium transition-colors', resultFilter === 'not_purchased' ? 'state-badge-error' : 'text-muted-foreground hover:text-foreground')}
              aria-pressed={resultFilter === 'not_purchased'}
            >
              Not purchased only
            </button>
            </Magnetic>
            <Magnetic intensity={0.08} range={36}>
            <button
              type="button"
              onClick={() => {
                setResultFilter('high_confidence')
                table.setPageIndex(0)
              }}
              className={cn('micro-interactive type-caption rounded-md px-2.5 py-1.5 font-medium transition-colors', resultFilter === 'high_confidence' ? 'state-badge-warning' : 'text-muted-foreground hover:text-foreground')}
              aria-pressed={resultFilter === 'high_confidence'}
            >
              High confidence (&ge; 15 pts from threshold)
            </button>
            </Magnetic>
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
                className="micro-interactive h-7 px-2 text-xs"
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
              <Button variant="ghost" size="sm" className="micro-interactive h-7 px-2 text-xs" onClick={onClearExternalFilter}>
                Clear chart filter
              </Button>
            </div>
          ) : null}
        </div>

        <div
          aria-hidden={!showFilters}
          className={cn(
            'grid transition-[max-height,opacity,transform] duration-300 ease-out',
            showFilters ? 'mt-4 grid-rows-[1fr] opacity-100' : 'pointer-events-none mt-0 grid-rows-[0fr] opacity-0',
          )}
        >
          <div className="overflow-hidden">
            <div className="space-y-3 rounded-xl border border-border/60 bg-muted/35 p-3">
              <div className="flex flex-wrap items-center gap-3">
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
                    onChange={(event) => {
                      setMinProbability(event.target.value)
                      table.setPageIndex(0)
                    }}
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
                    onChange={(event) => {
                      setMaxProbability(event.target.value)
                      table.setPageIndex(0)
                    }}
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
                      table.setPageIndex(0)
                    }}
                    className="micro-interactive h-9"
                  >
                    Clear
                  </Button>
                )}
              </div>

              <div className="flex flex-wrap gap-3">
                <span className="type-body text-sm font-medium text-muted-foreground">Columns</span>
                {table
                  .getAllLeafColumns()
                  .filter((column) => column.getCanHide())
                  .map((column) => (
                    <label key={column.id} className="type-caption inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                      <input
                        type="checkbox"
                        checked={column.getIsVisible()}
                        onChange={column.getToggleVisibilityHandler()}
                        className="h-3.5 w-3.5 accent-[hsl(var(--interactive))]"
                      />
                      {column.id === 'result' ? 'Result' : 'Confidence'}
                    </label>
                  ))}
              </div>
            </div>
          </div>
        </div>

        <div className="type-body mt-4 flex items-center justify-between rounded-lg border border-border/50 bg-background/40 px-3 py-2 text-sm" aria-live="polite" aria-atomic="true">
          <span>Showing rows</span>
          <span className="type-heading text-sm font-medium text-foreground">
            {paginatedRows.length} / {totalFilteredRows} filtered
          </span>
        </div>

        <div className="mt-2 flex flex-wrap items-center justify-end gap-2">
          <label className="type-caption inline-flex items-center gap-2 text-xs text-muted-foreground">
            Page size
            <select
              value={pagination.pageSize}
              onChange={(event) => table.setPageSize(Number(event.target.value))}
              className="rounded-md border border-border/70 bg-background px-2 py-1 text-xs text-foreground"
            >
              {[10, 25, 50, 100].map((size) => (
                <option key={size} value={size}>
                  {size}
                </option>
              ))}
            </select>
          </label>
          <Button variant="outline" size="sm" className="micro-interactive h-8 px-2" onClick={() => table.firstPage()} disabled={!table.getCanPreviousPage()}>
            First
          </Button>
          <Button variant="outline" size="sm" className="micro-interactive h-8 px-2" onClick={() => table.previousPage()} disabled={!table.getCanPreviousPage()}>
            Prev
          </Button>
          <span className="type-caption text-xs text-muted-foreground">
            Page {pagination.pageIndex + 1} / {Math.max(table.getPageCount(), 1)}
          </span>
          <Button variant="outline" size="sm" className="micro-interactive h-8 px-2" onClick={() => table.nextPage()} disabled={!table.getCanNextPage()}>
            Next
          </Button>
          <Button variant="outline" size="sm" className="micro-interactive h-8 px-2" onClick={() => table.lastPage()} disabled={!table.getCanNextPage()}>
            Last
          </Button>
        </div>
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
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id} className="border-b border-border/70 bg-muted/30">
                {headerGroup.headers.map((header) => {
                  const isFirst = header.column.id === 'row'
                  const canSort = header.column.getCanSort()
                  const sortState = header.column.getIsSorted()
                  return (
                    <TableHead
                      key={header.id}
                      className={cn(
                        'type-kicker sticky top-0 z-10 h-11 bg-card/95 text-muted-foreground backdrop-blur hover:bg-muted/50',
                        canSort && 'cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/55 focus-visible:ring-offset-2 focus-visible:ring-offset-background',
                        isFirst && 'left-0 z-20 w-12 min-w-12 border-r border-border/55 px-2 shadow-[10px_0_14px_-12px_rgba(2,6,23,0.95)] sm:w-14 sm:min-w-14 sm:px-3',
                      )}
                      onClick={canSort ? header.column.getToggleSortingHandler() : undefined}
                      tabIndex={canSort ? 0 : -1}
                      aria-sort={
                        sortState === 'asc'
                          ? 'ascending'
                          : sortState === 'desc'
                            ? 'descending'
                            : 'none'
                      }
                    >
                      {header.isPlaceholder ? null : (
                        <span className="inline-flex items-center">
                          {flexRender(header.column.columnDef.header, header.getContext())}
                          {sortState ? (
                            <ArrowUpDown
                              className={cn('ml-1 h-3 w-3 inline', sortState === 'desc' && 'rotate-180')}
                            />
                          ) : null}
                        </span>
                      )}
                    </TableHead>
                  )
                })}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {paginatedRows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={table.getVisibleLeafColumns().length} className="h-24 text-center text-muted-foreground">
                  No results match your filters.
                </TableCell>
              </TableRow>
            ) : (
              paginatedRows.map((row) => {
                const item = row.original
                const zebraRowClass = row.index % 2 === 0 ? 'bg-background/30' : 'bg-muted/[0.18]'
                const isAboveThreshold = item.thresholdGap !== null && item.thresholdGap >= 0
                const isNearThreshold = item.thresholdGap !== null && Math.abs(item.thresholdGap) < UNCERTAINTY_MARGIN
                const rowHighlightClass = item.isHighConfidence && isAboveThreshold
                  ? 'border-l-2 border-l-[hsl(var(--success)/0.72)] bg-[hsl(var(--success)/0.07)]'
                  : isNearThreshold
                    ? 'border-l-2 border-l-[hsl(var(--warning)/0.72)] bg-[hsl(var(--warning)/0.08)]'
                    : ''

                return (
                  <TableRow
                    key={row.id}
                    className={cn(
                      'animate-in fade-in duration-200 transition-colors hover:bg-muted/35 [&>td]:py-2.5',
                      zebraRowClass,
                      rowHighlightClass,
                    )}
                  >
                    {row.getVisibleCells().map((cell) => (
                      <TableCell key={cell.id} className={cn(cell.column.id === 'probability' && 'min-w-[170px]')}>
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </TableCell>
                    ))}
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

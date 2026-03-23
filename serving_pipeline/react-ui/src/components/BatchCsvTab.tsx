import { toast } from 'sonner'
import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Upload, FileText, X, Download, Files, TrendingUp, TrendingDown, Target, Zap, Activity, Gauge, Sparkles } from 'lucide-react'

import { useAppContext } from '@/contexts/AppContext'
import { ApiClientError, type ExplainLevel } from '@/lib/api'
import type { CartPrediction } from '@/types/api'
import { BatchResultsTable } from '@/components/BatchResultsTable'
import {
  HIGH_CONFIDENCE_MARGIN,
  UNCERTAINTY_MARGIN,
  getDecisionThreshold,
  isHighConfidence,
} from '@/lib/predictionConfidence'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Magnetic } from '@/components/ui/magnetic'
import { ScrollText } from '@/components/ui/scroll-text'
import { Skeleton } from '@/components/ui/skeleton'
import { StatusBanner } from '@/components/ui/status-banner'
import { cn } from '@/lib/utils'

// CSV template for batch prediction
const CSV_TEMPLATE = `price,activity_count,event_weekday,event_hour,user_total_views,user_total_carts,product_total_views,product_total_carts,brand_purchase_rate,price_vs_user_avg,price_vs_category_avg,brand,category_code_level1,category_code_level2,actual_label
49.99,5,2,14,85,15,1800,350,0.42,0.25,0.18,electronics,computers,laptops,1
29.99,3,5,10,60,12,1200,200,0.35,0.15,0.12,electronics,phones,accessories,0`

const LazyBatchResultCharts = lazy(() =>
  import('@/components/BatchResultCharts').then((module) => ({
    default: module.BatchResultCharts,
  }))
)

const integerFormatter = new Intl.NumberFormat('en-US')
const percentageFormatter = new Intl.NumberFormat('en-US', {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
})

const formatCount = (value: number) => integerFormatter.format(value)
const formatPercent = (value: number) => `${percentageFormatter.format(value * 100)}%`
const formatSignedCount = (value: number) => `${value >= 0 ? '+' : ''}${integerFormatter.format(value)}`

type CohortMetadataRow = {
  brand: string
  category_code_level1: string
  event_weekday: string
}

type ChartLinkedFilter = {
  rowIndexes: number[]
  label: string
}

const parseCsvLine = (line: string): string[] => {
  const cells: string[] = []
  let current = ''
  let inQuotes = false

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index]

    if (char === '"') {
      if (inQuotes && line[index + 1] === '"') {
        current += '"'
        index += 1
      } else {
        inQuotes = !inQuotes
      }
      continue
    }

    if (char === ',' && !inQuotes) {
      cells.push(current.trim())
      current = ''
      continue
    }

    current += char
  }

  cells.push(current.trim())
  return cells
}

const extractCohortMetadata = async (file: File): Promise<CohortMetadataRow[] | null> => {
  const csvText = await file.text()
  const lines = csvText
    .replace(/\r/g, '')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)

  if (lines.length < 2) return null

  const headers = parseCsvLine(lines[0]).map((header) =>
    header.replace(/^\ufeff/, '').trim().toLowerCase()
  )

  const required = ['brand', 'category_code_level1', 'event_weekday'] as const
  const hasAny = required.some((field) => headers.includes(field))
  if (!hasAny) return null

  return lines.slice(1).map((line) => {
    const values = parseCsvLine(line)
    const read = (field: (typeof required)[number]) => {
      const index = headers.indexOf(field)
      if (index === -1 || values[index] === undefined || values[index] === '') return 'Unknown'
      return values[index]
    }

    return {
      brand: read('brand'),
      category_code_level1: read('category_code_level1'),
      event_weekday: read('event_weekday'),
    }
  })
}

export const BatchCsvTab = () => {
  const { apiClient, dispatch, isLoading, state } = useAppContext()
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [isDragging, setIsDragging] = useState(false)
  const [results, setResults] = useState<CartPrediction[]>([])
  const [previousResults, setPreviousResults] = useState<CartPrediction[] | null>(null)
  const [estimatedRows, setEstimatedRows] = useState<number | null>(null)
  const [uploadProgress, setUploadProgress] = useState(0)
  const [processingStage, setProcessingStage] = useState('')
  const [uploadStartAt, setUploadStartAt] = useState<number | null>(null)
  const [etaSeconds, setEtaSeconds] = useState<number | null>(null)
  const [selectedExplainLevel, setSelectedExplainLevel] = useState<ExplainLevel>('full')
  const [cohortRows, setCohortRows] = useState<CohortMetadataRow[] | null>(null)
  const [simulatorThreshold, setSimulatorThreshold] = useState<number | null>(null)
  const [chartLinkedFilter, setChartLinkedFilter] = useState<ChartLinkedFilter | null>(null)
  const [fileValidationMessage, setFileValidationMessage] = useState<string | null>(null)
  const resultsSectionRef = useRef<HTMLDivElement | null>(null)

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

  const effectiveHighConfidenceFor = useCallback(
    (item: CartPrediction) => {
      if (simulatorThreshold === null) return isHighConfidence(item)
      if (item.probability === null) return false
      return Math.abs(item.probability - effectiveThresholdFor(item)) >= HIGH_CONFIDENCE_MARGIN
    },
    [effectiveThresholdFor, simulatorThreshold]
  )

  const summary = useMemo(() => {
    const total = results.length
    const purchased = results.filter((item) => effectivePredictionFor(item) === 1).length
    const nonPurchased = total - purchased
    const purchaseRate = total > 0 ? purchased / total : 0
    const validProbabilities = results
      .map((item) => item.probability)
      .filter((probability): probability is number => probability !== null)
    const averageProbability =
      validProbabilities.length > 0
        ? validProbabilities.reduce((acc, value) => acc + value, 0) / validProbabilities.length
        : 0
    const highConfidence = results.filter((item) => effectiveHighConfidenceFor(item)).length

    return {
      total,
      purchased,
      nonPurchased,
      purchaseRate,
      averageProbability,
      highConfidence,
    }
  }, [effectiveHighConfidenceFor, effectivePredictionFor, results])

  const previousSummary = useMemo(() => {
    if (!previousResults || previousResults.length === 0) return null
    const total = previousResults.length
    const purchased = previousResults.filter((item) => effectivePredictionFor(item) === 1).length
    const nonPurchased = total - purchased
    return { total, purchased, nonPurchased }
  }, [effectivePredictionFor, previousResults])

  const actionSegments = useMemo(() => {
    const getThresholdGap = (item: CartPrediction) => {
      if (item.probability === null) return null
      return item.probability - effectiveThresholdFor(item)
    }

    const likelyToDrop = results.filter((item) => {
      const gap = getThresholdGap(item)
      return gap !== null && gap <= -HIGH_CONFIDENCE_MARGIN
    })

    const highValueHesitant = results.filter((item) => {
      const gap = getThresholdGap(item)
      return gap !== null && gap >= 0 && gap < HIGH_CONFIDENCE_MARGIN
    })

    const confidentConverters = results.filter((item) => {
      const gap = getThresholdGap(item)
      return gap !== null && gap >= HIGH_CONFIDENCE_MARGIN
    })

    const lowConfidenceUnknowns = results.filter((item) => {
      const gap = getThresholdGap(item)
      return gap !== null && Math.abs(gap) < UNCERTAINTY_MARGIN
    })

    return {
      likelyToDrop,
      highValueHesitant,
      confidentConverters,
      lowConfidenceUnknowns,
    }
  }, [effectiveThresholdFor, results])

  const simulatorFlipCount = useMemo(() => {
    if (simulatorThreshold === null) return 0
    return results.filter(
      (item) => item.probability !== null && effectivePredictionFor(item) !== item.is_purchased
    ).length
  }, [effectivePredictionFor, results, simulatorThreshold])

  const exportSegmentCsv = useCallback((segmentName: string, segmentRows: CartPrediction[]) => {
    const rows = segmentRows.map((item) => {
      const index = results.indexOf(item) + 1
      return `${index},${item.is_purchased},${item.probability ?? ''}`
    })
    const content = ['row,is_purchased,probability', ...rows].join('\n')
    const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `segment_${segmentName}.csv`
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    URL.revokeObjectURL(url)
  }, [results])

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(true)
  }, [])

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(false)
  }, [])

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(false)
    const files = e.dataTransfer.files
    if (files.length > 0 && files[0].name.endsWith('.csv')) {
      setSelectedFile(files[0])
      setFileValidationMessage(null)
      toast.info(`File ready: ${files[0].name}`)
    } else {
      setFileValidationMessage('Please drop a valid CSV file.')
      toast.warning('Please drop a CSV file')
    }
  }, [])

  const estimateCsvRows = useCallback(async (file: File) => {
    try {
      const content = await file.text()
      const rows = Math.max(0, content.split(/\r?\n/).filter((line) => line.trim().length > 0).length - 1)
      setEstimatedRows(rows)
      return rows
    } catch {
      setEstimatedRows(null)
      return null
    }
  }, [])

  useEffect(() => {
    if (!isLoading) {
      setUploadProgress(0)
      setProcessingStage('')
      setUploadStartAt(null)
      setEtaSeconds(null)
      return
    }

    const estimatedTotalSeconds = Math.max(4, Math.min(40, Math.round(((estimatedRows ?? 120) / 120) * 6)))

    const timer = window.setInterval(() => {
      setUploadProgress((prev) => {
        const target = 95
        const step = estimatedRows && estimatedRows > 500 ? 2 : 4
        const next = Math.min(target, prev + step)
        const elapsedSeconds = uploadStartAt ? (Date.now() - uploadStartAt) / 1000 : 0
        const progressRatio = Math.max(0.05, next / 100)
        const estimatedRemaining = Math.max(0, Math.round(estimatedTotalSeconds * (1 - progressRatio) - elapsedSeconds * 0.15))
        setEtaSeconds(estimatedRemaining)

        if (next < 30) {
          setProcessingStage('Uploading CSV payload...')
        } else if (next < 70) {
          setProcessingStage('Validating and parsing rows...')
        } else {
          setProcessingStage('Running batch inference...')
        }

        return next
      })
    }, 240)

    return () => window.clearInterval(timer)
  }, [estimatedRows, isLoading, uploadStartAt])

  useEffect(() => {
    if (results.length === 0 || !resultsSectionRef.current) return
    const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    resultsSectionRef.current.scrollIntoView({ behavior: prefersReducedMotion ? 'auto' : 'smooth', block: 'start' })
  }, [results])

  const onUpload = useCallback(async () => {
    if (!selectedFile) {
      setFileValidationMessage('Please choose a CSV file first.')
      toast.warning('Please choose a CSV file first.')
      return
    }

    dispatch({ type: 'clearError' })
    dispatch({ type: 'startRequest' })
    try {
      const rows = await estimateCsvRows(selectedFile)
      const parsedCohortRows = await extractCohortMetadata(selectedFile)
      setUploadStartAt(Date.now())
      toast.info(rows !== null ? `Batch upload started: ${rows} rows detected.` : 'Batch upload started.')
      const response = await apiClient.predictBatchUpload(
        selectedFile,
        state.selectedModel,
        state.selectedThreshold,
        selectedExplainLevel
      )
      if (results.length > 0) {
        setPreviousResults(results)
      }
      setUploadProgress(100)
      setProcessingStage('Batch inference completed.')
      setEtaSeconds(0)
      setFileValidationMessage(null)
      setResults(response)
      setCohortRows(parsedCohortRows)
      setChartLinkedFilter(null)
      toast.success(`Batch prediction completed: ${response.length} rows processed.`)
    } catch (error) {
      const message =
        error instanceof ApiClientError
          ? error.message
          : 'Failed to upload and predict CSV batch.'
      dispatch({ type: 'setError', payload: message })
      toast.error(message)
      setResults([])
      setCohortRows(null)
    } finally {
      dispatch({ type: 'finishRequest' })
    }
  }, [apiClient, dispatch, estimateCsvRows, results, selectedExplainLevel, selectedFile, state.selectedModel, state.selectedThreshold])

  const clearFile = () => {
    setSelectedFile(null)
    setEstimatedRows(null)
    setCohortRows(null)
    setChartLinkedFilter(null)
    setFileValidationMessage(null)
  }

  const downloadTemplate = () => {
    const blob = new Blob([CSV_TEMPLATE], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'prediction_template.csv'
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
    toast.info('Template downloaded.')
  }

  return (
    <Card>
      <CardHeader className="space-y-3 border-b border-border/60 bg-surface-2/65 pb-5">
        <div className="state-text-success flex items-center gap-2">
          <Files className="h-4 w-4" />
          <span className="type-kicker">Bulk Inference</span>
        </div>
        <CardTitle className="readable-title text-xl sm:text-[1.36rem]"><ScrollText effect="fadeIn">Batch CSV Prediction</ScrollText></CardTitle>
        <CardDescription className="readable-description">
          Upload a CSV with core columns.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6 pt-7 sm:space-y-7 sm:pt-8">
        {isLoading ? (
          <div className="section-reveal section-delay-1 panel-accent rounded-xl border border-border/60 bg-muted/25 p-4">
            <StatusBanner
              variant="loading"
              title="Processing batch upload"
              message={processingStage || 'Processing CSV batch...'}
              className="mb-3"
            />
            <div className="mb-3 space-y-1.5">
              <div className="type-caption flex items-center justify-between">
                <span>{estimatedRows ? `${estimatedRows} rows` : 'Estimating rows...'}</span>
                <span className="font-mono tabular-nums">{uploadProgress}%</span>
              </div>
              <div className="type-caption flex items-center justify-between text-muted-foreground/90">
                <span>{processingStage || 'Preparing upload...'}</span>
                <span className="font-mono tabular-nums">
                  ETA {etaSeconds !== null ? `${Math.floor(etaSeconds / 60)}:${String(etaSeconds % 60).padStart(2, '0')}` : '--:--'}
                </span>
              </div>
              <div className="h-2.5 overflow-hidden rounded-full bg-muted/50">
                <div className="state-fill-success h-full transition-[width] duration-300" style={{ width: `${uploadProgress}%` }} />
              </div>
            </div>
            <div className="space-y-4">
              <Skeleton className="skeleton-shimmer h-36 w-full" />
              <Skeleton className="skeleton-shimmer h-11 w-44" />
            </div>
          </div>
        ) : (
          <div
            className={cn(
              'section-reveal section-delay-2 relative flex flex-col items-center justify-center rounded-xl border-2 border-dashed p-8 transition-colors',
              isDragging
                ? 'border-primary bg-primary/5'
                : 'border-border hover:border-primary/50',
              selectedFile && 'interactive-border bg-[hsl(var(--interactive)/0.08)]'
            )}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
          >
            {selectedFile ? (
              <div className="flex flex-col items-center gap-3 text-center">
                <div className="state-surface-success flex h-12 w-12 items-center justify-center rounded-full border">
                  <FileText className="state-text-success h-6 w-6" />
                </div>
                <div>
                  <p className="type-heading text-sm font-medium text-foreground">{selectedFile.name}</p>
                  <p className="type-body text-sm">
                    {(selectedFile.size / 1024).toFixed(1)} KB
                  </p>
                </div>
                <Magnetic intensity={0.12} range={48}>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={clearFile}
                    className="micro-interactive mt-2"
                  >
                    <X className="mr-2 h-4 w-4" />
                    Remove
                  </Button>
                </Magnetic>
              </div>
            ) : (
              <>
                <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted">
                  <Upload className="h-6 w-6 text-muted-foreground" />
                </div>
                <p className="type-heading mt-4 text-sm font-medium">
                  Drag & drop your CSV file here
                </p>
                <p className="type-caption">
                  or click the button below to browse
                </p>
                <label className="mt-4">
                  <input
                    type="file"
                    accept=".csv"
                    className="hidden"
                    onChange={(e) => {
                      const file = e.target.files?.[0]
                        if (file) {
                          setSelectedFile(file)
                          setFileValidationMessage(null)
                          toast.info(`File ready: ${file.name}`)
                        } else {
                          setFileValidationMessage('Please choose a valid CSV file.')
                        }
                      }}
                      aria-invalid={fileValidationMessage ? 'true' : 'false'}
                      aria-describedby="batch-upload-feedback"
                    />
                  <Button variant="outline" size="sm" asChild>
                    <span>Browse Files</span>
                  </Button>
                </label>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={downloadTemplate}
                  className="micro-interactive mt-2 text-muted-foreground"
                >
                  <Download className="mr-2 h-4 w-4" />
                  Download Template
                </Button>
              </>
            )}
          </div>
        )}

        {fileValidationMessage ? (
          <StatusBanner
            variant="error"
            message={fileValidationMessage}
            className="mt-2"
          />
        ) : null}

        <div className="sticky bottom-0 z-10 -mx-4 border-t border-border/60 bg-card/90 px-4 py-4 backdrop-blur sm:-mx-6 sm:px-6" role="region" aria-label="Batch prediction actions">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="space-y-1">
              <p className="type-heading text-sm font-semibold">Ready for batch prediction</p>
              <p className="type-caption" aria-live="polite">{processingStage || 'Waiting for CSV upload.'}</p>
            </div>
            <div className="flex items-center gap-3">
              <div className="inline-flex h-10 items-center rounded-md border border-border/70 bg-background/65 p-0.5">
                  {([
                    { value: 'top', label: 'Explain Top' },
                    { value: 'full', label: 'Explain Full' },
                  ] as const).map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => setSelectedExplainLevel(option.value)}
                    className={cn(
                      'micro-interactive type-caption rounded px-2.5 py-1.5 text-xs font-medium transition-colors',
                      selectedExplainLevel === option.value
                        ? 'state-badge-info text-foreground'
                        : 'text-muted-foreground hover:text-foreground'
                    )}
                    aria-pressed={selectedExplainLevel === option.value}
                    title={option.value === 'top' ? 'Faster response, top signals only' : 'Full feature contributions for SHAP analysis'}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
              <Magnetic intensity={0.18} range={60}>
                <Button onClick={onUpload} disabled={!selectedFile || isLoading} className="micro-interactive h-11 min-w-40 interactive-bg hover:bg-[hsl(var(--interactive-hover))]">
                  {isLoading ? 'Uploading...' : 'Upload and Predict'}
                </Button>
              </Magnetic>
            </div>
          </div>
        </div>

        <div id="batch-upload-feedback">
          {state.errorMessage ? <StatusBanner variant="error" message={state.errorMessage} /> : null}
        </div>

        {!isLoading && results.length === 0 && !state.errorMessage && (
          <div className="type-body mt-2 rounded-xl border border-dashed border-border/70 bg-muted/20 p-4 text-center text-sm">
            Upload a CSV file to run predictions for multiple records at once.
          </div>
        )}

        {results.length > 0 ? (
          <div ref={resultsSectionRef} className="section-reveal section-delay-3 space-y-4">
            {/* KPI Summary Cards */}
            <div aria-live="polite" aria-atomic="false" className="grid grid-cols-1 gap-3 md:grid-cols-5">
              {[
                {
                  key: 'total',
                  label: 'Total rows',
                  value: formatCount(summary.total),
                  cardClass: 'rounded-xl border border-border/80 bg-surface-2/78 p-3.5',
                  valueClass: 'type-metric text-2xl font-semibold tracking-tight text-text-primary',
                  helper: '',
                  icon: <Files className="h-5 w-5" />,
                  iconBg: 'bg-blue-500/15 text-blue-600 dark:text-blue-400',
                },
                {
                  key: 'purchased',
                  label: 'Predicted purchase',
                  value: formatCount(summary.purchased),
                  cardClass: 'state-surface-success rounded-xl border p-3.5',
                  valueClass: 'type-metric state-text-success text-2xl font-semibold tracking-tight',
                  helper: '',
                  icon: <TrendingUp className="h-5 w-5" />,
                  iconBg: 'bg-green-500/15 text-green-600 dark:text-green-400',
                },
                {
                  key: 'nonPurchased',
                  label: 'Predicted non-purchase',
                  value: formatCount(summary.nonPurchased),
                  cardClass: 'state-surface-error rounded-xl border p-3.5',
                  valueClass: 'type-metric state-text-error text-2xl font-semibold tracking-tight',
                  helper: '',
                  icon: <TrendingDown className="h-5 w-5" />,
                  iconBg: 'bg-red-500/15 text-red-600 dark:text-red-400',
                },
                {
                  key: 'purchaseRate',
                  label: 'Predicted purchase rate',
                  value: formatPercent(summary.purchaseRate),
                  cardClass: 'state-surface-info rounded-xl border p-3.5',
                  valueClass: 'type-metric state-text-info text-2xl font-semibold tracking-tight',
                  helper: '',
                  icon: <Target className="h-5 w-5" />,
                  iconBg: 'bg-blue-500/15 text-blue-600 dark:text-blue-400',
                },
                {
                  key: 'highConfidence',
                  label: 'High confidence rows',
                  value: formatCount(summary.highConfidence),
                  cardClass: 'state-surface-warning rounded-xl border p-3.5',
                  valueClass: 'type-metric state-text-warning text-2xl font-semibold tracking-tight',
                  helper: `At least ${Math.round(HIGH_CONFIDENCE_MARGIN * 100)} pts from threshold`,
                  icon: <Zap className="h-5 w-5" />,
                  iconBg: 'bg-amber-500/15 text-amber-600 dark:text-amber-400',
                },
              ].map((card) => (
                <div key={card.key} className={cn('panel-accent flex min-h-[176px] flex-col', card.cardClass)}>
                  <div className="mb-3 flex items-center justify-between">
                    <p className="type-body min-h-[2rem] text-sm font-medium text-muted-foreground">{card.label}</p>
                    <div className={cn('rounded-lg p-1.5', card.iconBg)}>{card.icon}</div>
                  </div>
                  <p className={card.valueClass}>{card.value}</p>
                  <p className={cn('type-caption mt-auto min-h-[2.5rem]', !card.helper && 'invisible')}>
                    {card.helper || 'placeholder'}
                  </p>
                </div>
              ))}
            </div>

            <div className="grid grid-cols-1 gap-3 xl:grid-cols-3">
              <div className="panel-accent rounded-xl border border-border/80 bg-surface-2/78 p-3.5 xl:col-span-1">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <p className="type-kicker inline-flex items-center gap-1.5"><Activity className="h-3.5 w-3.5" />Decision console</p>
                  <span className="type-caption inline-flex rounded-full px-2 py-0.5 font-semibold state-badge-info">
                    {simulatorThreshold !== null ? `Threshold ${simulatorThreshold.toFixed(3)}` : 'Default thresholds'}
                  </span>
                </div>
                <p className="type-body text-sm text-text-primary">
                  Threshold changes are synced across summary, charts, and table.
                </p>
                <div className="mt-3 rounded-lg border border-border/70 bg-background/50 p-2.5">
                  <div className="mb-1 flex items-center justify-between">
                    <p className="type-caption text-muted-foreground">Probability vs threshold</p>
                    <span className="type-caption inline-flex items-center gap-1 rounded-full border border-border/60 bg-background/70 px-2 py-0.5">
                      <Gauge className="h-3 w-3" />
                      {formatPercent(summary.averageProbability)}
                    </span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-muted/55" aria-hidden="true">
                    <div className="h-full bg-gradient-to-r from-cyan-400 via-blue-500 to-violet-500 transition-[width] duration-700" style={{ width: `${Math.min(100, Math.max(0, summary.averageProbability * 100))}%` }} />
                  </div>
                </div>
                <div className="mt-2 grid grid-cols-2 gap-2">
                  <div className="flex min-h-[96px] flex-col justify-between rounded-lg border border-border/70 bg-background/50 p-2.5">
                    <p className="type-caption min-h-[2.75rem] text-muted-foreground">Flip count</p>
                    <p className={cn('type-metric text-xl font-semibold leading-none tracking-tight', simulatorFlipCount > 0 ? 'state-text-warning' : 'state-text-success')}>{formatCount(simulatorFlipCount)}</p>
                  </div>
                  <div className="flex min-h-[96px] flex-col justify-between rounded-lg border border-border/70 bg-background/50 p-2.5">
                    <p className="type-caption min-h-[2.75rem] text-muted-foreground">Avg probability</p>
                    <p className="type-metric text-xl font-semibold leading-none tracking-tight text-foreground">{formatPercent(summary.averageProbability)}</p>
                  </div>
                </div>
              </div>

              <div className="panel-accent rounded-xl border border-border/80 bg-surface-2/78 p-3.5 xl:col-span-2">
                <p className="type-kicker mb-2 inline-flex items-center gap-1.5"><Sparkles className="h-3.5 w-3.5" /><ScrollText effect="fadeIn">Action segmentation</ScrollText></p>
                <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
                  {[
                    { key: 'likely_to_drop', label: 'Likely to drop', rows: actionSegments.likelyToDrop, tone: 'state-text-error', bar: 'bg-gradient-to-r from-rose-400 to-rose-500', chip: 'state-badge-error' },
                    { key: 'high_value_hesitant', label: 'High-value hesitant', rows: actionSegments.highValueHesitant, tone: 'state-text-warning', bar: 'bg-gradient-to-r from-amber-400 to-orange-500', chip: 'state-badge-warning' },
                    { key: 'confident_converters', label: 'Confident converters', rows: actionSegments.confidentConverters, tone: 'state-text-success', bar: 'bg-gradient-to-r from-emerald-400 to-green-500', chip: 'state-badge-success' },
                    { key: 'low_confidence_unknowns', label: 'Low-confidence unknowns', rows: actionSegments.lowConfidenceUnknowns, tone: 'state-text-info', bar: 'bg-gradient-to-r from-cyan-400 to-blue-500', chip: 'state-badge-info' },
                  ].map((segment) => {
                    const ratio = summary.total > 0 ? (segment.rows.length / summary.total) * 100 : 0

                    return (
                      <div key={segment.key} className="flex h-full flex-col rounded-lg border border-border/70 bg-background/45 p-3 transition-colors hover:border-border/90 hover:bg-background/55">
                        <div className="mb-1 flex items-start justify-between gap-2">
                          <p className="type-caption min-h-[4.5rem] text-muted-foreground">{segment.label}</p>
                          <span className={cn('type-caption inline-flex rounded-full px-2 py-0.5 font-semibold', segment.chip)}>{ratio.toFixed(1)}%</span>
                        </div>
                        <p className={cn('type-metric mt-1 text-2xl font-semibold tracking-tight', segment.tone)}>{formatCount(segment.rows.length)}</p>
                        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted/55" aria-hidden="true">
                          <div className={cn('h-full transition-[width] duration-700', segment.bar)} style={{ width: `${ratio}%` }} />
                        </div>
                        <Magnetic intensity={0.1} range={44}>
                          <Button
                            variant="outline"
                            size="sm"
                            className="micro-interactive mt-auto h-8 w-full border-border/70 px-2.5"
                            onClick={() => exportSegmentCsv(segment.key, segment.rows)}
                            disabled={segment.rows.length === 0}
                          >
                            Export
                          </Button>
                        </Magnetic>
                      </div>
                    )
                  })}
                </div>
              </div>
            </div>

            <div className="panel-accent rounded-xl border border-border/80 bg-surface-2/78 p-3.5">
              <p className="type-kicker mb-2">Batch insight</p>
              <p className="type-body text-sm text-text-primary">
                This batch predicts <span className="type-metric font-semibold state-text-success">{formatCount(summary.purchased)}</span> likely purchases out of{' '}
                <span className="type-metric font-semibold">{formatCount(summary.total)}</span> rows ({formatPercent(summary.purchaseRate)}).
                Average model confidence is <span className="type-metric font-semibold state-text-info">{formatPercent(summary.averageProbability)}</span>.
              </p>
            </div>

            <Suspense
              fallback={
                <div className="panel-accent space-y-3 rounded-xl border border-border/70 bg-card/45 p-3.5">
                  <Skeleton className="skeleton-shimmer h-5 w-52" />
                  <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
                    <Skeleton className="skeleton-shimmer h-64 w-full" />
                    <Skeleton className="skeleton-shimmer h-64 w-full" />
                  </div>
                </div>
              }
            >
            <LazyBatchResultCharts
              results={results}
              cohortRows={cohortRows ?? undefined}
              simulatorThreshold={simulatorThreshold}
              onChartFilterChange={setChartLinkedFilter}
            />
          </Suspense>

            {previousSummary ? (
              <div className="panel-accent rounded-xl border border-border/80 bg-surface-2/78 p-3.5">
                <p className="type-kicker mb-2">Compare with previous batch</p>
                <div className="grid gap-3 sm:grid-cols-3">
                  <div>
                    <p className="type-caption text-text-secondary">Rows delta</p>
              <p className={`type-metric mt-1 text-sm font-semibold ${(summary.total - previousSummary.total) >= 0 ? 'state-text-success' : 'state-text-error'}`}>
                      {formatSignedCount(summary.total - previousSummary.total)}
                    </p>
                  </div>
                  <div>
                    <p className="type-caption text-text-secondary">Purchased delta</p>
              <p className={`type-metric mt-1 text-sm font-semibold ${(summary.purchased - previousSummary.purchased) >= 0 ? 'state-text-success' : 'state-text-error'}`}>
                      {formatSignedCount(summary.purchased - previousSummary.purchased)}
                    </p>
                  </div>
                  <div>
                    <p className="type-caption text-text-secondary">Not purchased delta</p>
              <p className={`type-metric mt-1 text-sm font-semibold ${(summary.nonPurchased - previousSummary.nonPurchased) >= 0 ? 'state-text-success' : 'state-text-error'}`}>
                      {formatSignedCount(summary.nonPurchased - previousSummary.nonPurchased)}
                    </p>
                  </div>
                </div>
              </div>
            ) : null}

            <div className="panel-accent rounded-xl border border-border/80 bg-surface-2/78 p-3.5">
              <div className="mb-3 flex items-center justify-between gap-2">
                <p className="type-kicker">Batch results table</p>
                <span className="type-caption text-muted-foreground">Use threshold simulator to drive all sections</span>
              </div>
              <BatchResultsTable
                results={results}
                simulatorThreshold={simulatorThreshold}
                onSimulatorThresholdChange={setSimulatorThreshold}
                externalRowIndexes={chartLinkedFilter?.rowIndexes ?? null}
                externalFilterLabel={chartLinkedFilter?.label ?? null}
                onClearExternalFilter={() => setChartLinkedFilter(null)}
              />
            </div>
          </div>
        ) : null}
      </CardContent>
    </Card>
  )
}

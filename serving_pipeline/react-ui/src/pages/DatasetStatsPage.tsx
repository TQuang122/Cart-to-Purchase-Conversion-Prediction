import { useEffect, useRef, useState, useMemo } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import {
  ComposedChart,
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  LabelList,
  Line,
  Scatter,
  ScatterChart,
  ZAxis,
  ReferenceDot,
  ReferenceLine,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { AlertTriangle, BarChart3, Database, Download, GitBranch, Home, Loader2, Network, Settings2, ShieldAlert, SlidersHorizontal } from 'lucide-react'

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { RainbowButton } from '@/components/ui/rainbow-button'
import { resolveApiRoot, resolveServingModelForApi } from '@/lib/api'
import { CHART_COLORS, CHART_TOOLTIP_CONTENT_STYLE, CHART_ACTIVE_BAR_STYLE } from '@/lib/chartDefaults'
import { AnimatedTable } from '@/components/ui/animated-table'
import { HighlightText } from '@/components/ui/highlight-text'
import { useAppContext } from '@/contexts/AppContext'
import { cn } from '@/lib/utils'
import type {
  DatasetConversionResponse,
  DatasetProfileResponse,
  DatasetQualityResponse,
  ModelArchitectureResponse,
  ModelHyperparametersResponse,
  ModelLineageResponse,
  ModelOverviewResponse,
} from '@/types/api'

const formatPercent = (value: number | null | undefined) => {
  if (value === null || value === undefined || Number.isNaN(value)) return 'Unavailable'
  return `${value.toFixed(1)}%`
}

const formatNumber = (value: number | null | undefined) => {
  if (value === null || value === undefined || Number.isNaN(value)) return 'Unavailable'
  return new Intl.NumberFormat('en-US').format(value)
}

const formatCompactNumber = (value: number | null | undefined) => {
  if (value === null || value === undefined || Number.isNaN(value)) return 'N/A'
  return new Intl.NumberFormat('en-US', {
    notation: 'compact',
    maximumFractionDigits: 1,
  }).format(value)
}

const formatDateTime = (value: string | null | undefined) => {
  if (!value) return 'Unavailable'
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return value
  return parsed.toLocaleString([], { hour: '2-digit', minute: '2-digit', day: '2-digit', month: 'short' })
}

const tooltipFormatter = (value: unknown) => [formatNumber(Number(value)), '']

const formatRatioPercent = (value: number) => `${(value * 100).toFixed(2)}%`

const compactAxisLabel = (value: string, maxLength = 14) => {
  if (!value) return 'N/A'
  return value.length > maxLength ? `${value.slice(0, maxLength)}…` : value
}

function ChartMountGate({
  className,
  children,
}: {
  className: string
  children: (size: { width: number; height: number }) => React.ReactNode
}) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const [isReady, setIsReady] = useState(false)
  const [hasStableFrame, setHasStableFrame] = useState(false)
  const [size, setSize] = useState({ width: 0, height: 0 })

  useEffect(() => {
    const element = containerRef.current
    if (!element) return

    let timeoutId: ReturnType<typeof setTimeout> | null = null
    let rafId = 0
    let rafId2 = 0

    rafId = requestAnimationFrame(() => {
      rafId2 = requestAnimationFrame(() => {
        timeoutId = setTimeout(() => setHasStableFrame(true), 120)
      })
    })

    const updateReadiness = () => {
      const rect = element.getBoundingClientRect()
      setSize({ width: Math.floor(rect.width), height: Math.floor(rect.height) })
      setIsReady(rect.width > 0 && rect.height > 0)
    }

    updateReadiness()
    const observer = new ResizeObserver(updateReadiness)
    observer.observe(element)
    return () => {
      observer.disconnect()
      cancelAnimationFrame(rafId)
      cancelAnimationFrame(rafId2)
      if (timeoutId) clearTimeout(timeoutId)
    }
  }, [])

  return (
    <div ref={containerRef} className={className}>
      {isReady && hasStableFrame ? children(size) : null}
    </div>
  )
}

interface MetricTileProps {
  label: string
  value: React.ReactNode
  description: string
  tone: 'info' | 'success' | 'warning' | 'error'
  icon: React.ReactNode
}

function MetricTile({ label, value, description, tone, icon }: MetricTileProps) {
  const toneClasses = {
    info: 'state-surface-info',
    success: 'state-surface-success',
    warning: 'state-surface-warning',
    error: 'state-surface-error',
  }

  const iconToneClasses = {
    info: 'state-fill-info',
    success: 'state-fill-success',
    warning: 'state-fill-warning',
    error: 'state-fill-error',
  }

  return (
    <Card className={cn('dashboard-card', toneClasses[tone])}>
      <CardContent className="flex flex-row items-start gap-3 p-4">
        <div className="min-w-0 flex-1">
          <p className="type-kicker">{label}</p>
          <p className="type-display mt-2 text-2xl">{value}</p>
          <p className="type-body mt-2">{description}</p>
        </div>
        <div className={cn('rounded-lg p-2', iconToneClasses[tone])}>{icon}</div>
      </CardContent>
    </Card>
  )
}

function PriceDistributionChartCard({ data }: { data: { axisLabel: string; fullLabel: string; value: number }[] }) {
  const [sortOrder, setSortOrder] = useState<'none' | 'asc' | 'desc'>('none')
  const [selectedBin, setSelectedBin] = useState<string | null>(null)
  const chartRef = useRef<HTMLDivElement>(null)

  const sortedData = useMemo(() => {
    if (sortOrder === 'none') return data
    return [...data].sort((a, b) => sortOrder === 'asc' ? a.value - b.value : b.value - a.value)
  }, [data, sortOrder])

  const averageBinVolume = data.length > 0
    ? data.reduce((sum, item) => sum + item.value, 0) / data.length
    : 0

  const exportToPng = async () => {
    if (!chartRef.current) return
    const svg = chartRef.current.querySelector('svg')
    if (!svg) return
    
    const canvas = document.createElement('canvas')
    const ctx = canvas.getContext('2d')
    const svgData = new XMLSerializer().serializeToString(svg)
    const img = new Image()
    const svgBlob = new Blob([svgData], { type: 'image/svg+xml;charset=utf-8' })
    const url = URL.createObjectURL(svgBlob)
    
    img.onload = () => {
      canvas.width = img.width * 2
      canvas.height = img.height * 2
      ctx?.scale(2, 2)
      ctx?.drawImage(img, 0, 0)
      const png = canvas.toDataURL('image/png')
      const link = document.createElement('a')
      link.download = 'price-distribution.png'
      link.href = png
      link.click()
      URL.revokeObjectURL(url)
    }
    img.src = url
  }

  return (
      <Card className="dashboard-card panel-accent">
      <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <div className="cursor-pointer" onClick={() => setSortOrder(prev => prev === 'none' ? 'desc' : prev === 'desc' ? 'asc' : 'none')}>
              <CardTitle className="type-heading text-base">Price Distribution</CardTitle>
              <CardDescription>Price histogram (8 bins)</CardDescription>
            </div>
            <div className="flex items-center gap-2">
              {sortOrder !== 'none' && (
                <span className="text-xs text-muted-foreground font-medium">
                  {sortOrder === 'asc' ? '↑' : '↓'}
                </span>
              )}
              <button onClick={exportToPng} className="p-1.5 rounded-md hover:bg-accent transition-colors" title="Download PNG">
                <Download className="h-4 w-4 text-muted-foreground" />
              </button>
            </div>
          </div>
        </CardHeader>
      <CardContent ref={chartRef}>
        <ChartMountGate className="h-56">
          {({ width, height }) => (
            <BarChart width={width} height={height} data={sortedData} margin={{ top: 8, right: 14, left: 0, bottom: 28 }} barCategoryGap="18%">
              <defs>
                <linearGradient id="priceHistogramGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="hsl(var(--chart-1))" stopOpacity={0.95} />
                  <stop offset="100%" stopColor="hsl(var(--chart-1))" stopOpacity={0.45} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border) / 0.45)" vertical={false} />
              <XAxis
                dataKey="axisLabel"
                tick={{ fontSize: 10, fill: 'hsl(var(--text-secondary))' }}
                tickLine={false}
                axisLine={{ stroke: 'hsl(var(--border))' }}
                angle={-28}
                textAnchor="end"
                height={64}
                interval="preserveStartEnd"
                minTickGap={14}
              />
              <YAxis
                tick={{ fontSize: 11, fill: 'hsl(var(--text-secondary))' }}
                tickLine={false}
                axisLine={{ stroke: 'hsl(var(--border))' }}
                width={58}
                tickFormatter={(value: number) => formatCompactNumber(value)}
              />
              <Tooltip
                contentStyle={CHART_TOOLTIP_CONTENT_STYLE}
                formatter={(value: unknown) => [`${formatNumber(Number(value))} records`, 'Volume']}
                labelFormatter={(label, payload) => {
                  const first = payload?.[0] as { payload?: { fullLabel?: string } } | undefined
                  return first?.payload?.fullLabel ?? String(label)
                }}
              />
              <ReferenceLine
                y={averageBinVolume}
                stroke="hsl(var(--chart-3))"
                strokeDasharray="5 4"
                ifOverflow="extendDomain"
                label={{
                  value: `Avg bin: ${formatCompactNumber(averageBinVolume)}`,
                  position: 'insideTopRight',
                  fill: 'hsl(var(--chart-3))',
                  fontSize: 10,
                }}
              />
              <Bar 
              dataKey="value" 
              fill="url(#priceHistogramGradient)" 
              radius={[5, 5, 0, 0]} 
              maxBarSize={52} 
              activeBar={selectedBin ? { ...CHART_ACTIVE_BAR_STYLE, fill: 'hsl(var(--chart-3))', filter: 'brightness(1.3)' } : CHART_ACTIVE_BAR_STYLE}
              onClick={(data) => {
                if (data && typeof data !== 'boolean') {
                  const payload = data as { axisLabel?: string }
                  setSelectedBin(prev => prev === payload.axisLabel ? null : String(payload.axisLabel))
                }
              }}
              style={{ cursor: 'pointer' }}
            />
            </BarChart>
          )}
        </ChartMountGate>
      </CardContent>
    </Card>
  )
}

// Power BI Style Horizontal Bar Chart Component
function HorizontalBarChartCard({
  data,
  title,
  description,
  layout = 'vertical',
}: {
  data: { name: string; value: number }[]
  title: string
  description: string
  layout?: 'vertical' | 'horizontal'
}) {
  return (
          <Card className="dashboard-card panel-accent">
      <CardHeader className="pb-2">
        <CardTitle className="type-heading text-base">{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent>
        <ChartMountGate className="h-64">
          {({ width, height }) => (
            <BarChart
              width={width}
              height={height}
              data={data}
              layout={layout}
              margin={{ top: 10, right: 20, left: layout === 'horizontal' ? -20 : 0, bottom: 0 }}
            >
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border) / 0.5)" vertical={layout === 'vertical'} />
              {layout === 'vertical' ? (
                <>
                  <XAxis
                    type="number"
                    tick={{ fontSize: 11, fill: 'hsl(var(--text-secondary))' }}
                    axisLine={{ stroke: 'hsl(var(--border))' }}
                    tickLine={false}
                  />
                  <YAxis
                    dataKey="name"
                    type="category"
                    tick={{ fontSize: 11, fill: 'hsl(var(--text-secondary))' }}
                    width={100}
                    axisLine={{ stroke: 'hsl(var(--border))' }}
                    tickLine={false}
                  />
                </>
              ) : (
                <>
                  <XAxis
                    dataKey="name"
                    type="category"
                    tick={{ fontSize: 11, fill: 'hsl(var(--text-secondary))' }}
                    axisLine={{ stroke: 'hsl(var(--border))' }}
                    tickLine={false}
                  />
                  <YAxis
                    type="number"
                    tick={{ fontSize: 11, fill: 'hsl(var(--text-secondary))' }}
                    axisLine={{ stroke: 'hsl(var(--border))' }}
                    tickLine={false}
                  />
                </>
              )}
              <Tooltip contentStyle={CHART_TOOLTIP_CONTENT_STYLE} formatter={tooltipFormatter} />
              <Bar dataKey="value" fill={CHART_COLORS[0]} radius={[0, 4, 4, 0]} barSize={20} activeBar={CHART_ACTIVE_BAR_STYLE} style={{ cursor: 'pointer' }} />
            </BarChart>
          )}
        </ChartMountGate>
      </CardContent>
    </Card>
  )
}


export function DatasetStatsPage() {
  const [searchParams] = useSearchParams()
  const apiRoot = resolveApiRoot(searchParams.get('api') ?? undefined)
  const { state } = useAppContext()
  const selectedModel = state.selectedModel

  const [profile, setProfile] = useState<DatasetProfileResponse | null>(null)
  const [quality, setQuality] = useState<DatasetQualityResponse | null>(null)
  const [conversion, setConversion] = useState<DatasetConversionResponse | null>(null)
  const [modelOverview, setModelOverview] = useState<ModelOverviewResponse | null>(null)
  const [architecture, setArchitecture] = useState<ModelArchitectureResponse | null>(null)
  const [hyperparameters, setHyperparameters] = useState<ModelHyperparametersResponse | null>(null)
  const [lineage, setLineage] = useState<ModelLineageResponse | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let ignore = false
    const selectedModelForApi = resolveServingModelForApi(selectedModel)

    const fetchDashboardData = async () => {
      setIsLoading(true)
      setError(null)

      try {
        const responses = await Promise.all([
          fetch(`${apiRoot}/dataset/profile`),
          fetch(`${apiRoot}/dataset/quality`),
          fetch(`${apiRoot}/dataset/conversion`),
          fetch(`${apiRoot}/model/overview?model=${selectedModelForApi}`),
          fetch(`${apiRoot}/model/architecture?model=${selectedModelForApi}`),
          fetch(`${apiRoot}/model/hyperparameters?model=${selectedModelForApi}`),
          fetch(`${apiRoot}/model/lineage?model=${selectedModelForApi}`),
        ])

        const failing = responses.find((response) => !response.ok)
        if (failing) {
          throw new Error(`Failed to load dataset intelligence (${failing.status})`)
        }

        const [
          nextProfile,
          nextQuality,
          nextConversion,
          nextModelOverview,
          nextArchitecture,
          nextHyperparameters,
          nextLineage,
        ] = await Promise.all(responses.map((response) => response.json()))

        if (ignore) return

        setProfile(nextProfile)
        setQuality(nextQuality)
        setConversion(nextConversion)
        setModelOverview(nextModelOverview)
        setArchitecture(nextArchitecture)
        setHyperparameters(nextHyperparameters)
        setLineage(nextLineage)
      } catch (fetchError) {
        if (ignore) return
        setError(fetchError instanceof Error ? fetchError.message : 'Failed to load dataset intelligence.')
      } finally {
        if (!ignore) {
          setIsLoading(false)
        }
      }
    }

    void fetchDashboardData()

    return () => {
      ignore = true
    }
  }, [apiRoot, selectedModel])

  // Transform data for Power BI style charts
  const categoryLevel1Distribution = quality?.categorical_distributions?.find(d => d.column === 'category_code_level1')?.top_values?.map(d => ({
    name: d.label,
    value: d.count
  })) || []

  const priceDistribution = quality?.numeric_distributions?.find(d => d.column === 'price')?.bins?.map(bin => ({
    axisLabel: compactAxisLabel(bin.label || 'N/A'),
    fullLabel: bin.label || 'N/A',
    value: bin.count,
  })) || []

  const categoryLevel2Distribution = quality?.categorical_distributions?.find(d => d.column === 'category_code_level2')?.top_values?.slice(0, 8).map(d => ({
    name: d.label,
    value: d.count
  })) || []

  const baseViews = conversion?.views ?? 0
  const baseCarts = conversion?.carts ?? 0
  const basePurchases = conversion?.purchases ?? 0

  const conversionFunnelData = [
    { stage: 'View', value: baseViews, rate: 1 },
    { stage: 'Add to Cart', value: baseCarts, rate: baseViews > 0 ? baseCarts / baseViews : 0 },
    { stage: 'Purchase', value: basePurchases, rate: baseCarts > 0 ? basePurchases / baseCarts : 0 },
  ]

  const funnelBase = conversionFunnelData[0]?.value ?? 0
  const conversionFunnelDisplayData = conversionFunnelData.map((item) => ({
    ...item,
    pct_of_view: funnelBase > 0 ? (item.value / funnelBase) * 100 : 0,
  }))

  const totalBrandCarts = (conversion?.brand_conversion_rate || []).reduce((sum, item) => sum + item.carts, 0)
  const brandConversionRateData = (conversion?.brand_conversion_rate || []).slice(0, 5).map((item) => ({
    name: item.brand,
    rate: item.conversion_rate,
    volume: item.carts,
    purchases: item.purchases ?? 0,
    share: totalBrandCarts > 0 ? item.carts / totalBrandCarts : 0,
  }))

  const brandEfficiencyScatterData = (conversion?.brand_conversion_rate || []).slice(0, 10).map((item) => ({
    name: item.brand,
    carts: item.carts,
    ratePct: item.conversion_rate * 100,
    purchases: item.purchases ?? 0,
  }))

  const hourlyPurchaseProbabilityData = [
    { hour: 15, rate: 0.0122 },
    { hour: 16, rate: 0.0113 },
    { hour: 17, rate: 0.0101 },
    { hour: 18, rate: 0.0116 },
    { hour: 19, rate: 0.0116 },
    { hour: 20, rate: 0.0105 },
    { hour: 21, rate: 0.0150 },
    { hour: 22, rate: 0.0133 },
    { hour: 23, rate: 0.0134 },
  ]

  const goldenHour = hourlyPurchaseProbabilityData.reduce((best, point) => (point.rate > best.rate ? point : best), hourlyPurchaseProbabilityData[0])

  const purchaseDecisionHistogramData = [
    { minute: 0.5, volume: 360 },
    { minute: 1.0, volume: 800 },
    { minute: 1.5, volume: 500 },
    { minute: 2.0, volume: 320 },
    { minute: 3.0, volume: 170 },
    { minute: 4.0, volume: 110 },
    { minute: 5.0, volume: 85 },
    { minute: 6.0, volume: 52 },
    { minute: 7.0, volume: 35 },
    { minute: 8.0, volume: 24 },
    { minute: 10.0, volume: 20 },
    { minute: 12.0, volume: 12 },
    { minute: 15.0, volume: 8 },
    { minute: 20.0, volume: 4 },
    { minute: 25.0, volume: 3 },
    { minute: 30.0, volume: 2 },
    { minute: 35.0, volume: 2 },
    { minute: 40.0, volume: 1 },
    { minute: 45.0, volume: 1 },
  ]

  const decisionTotal = purchaseDecisionHistogramData.reduce((sum, item) => sum + item.volume, 0)
  const decisionWeightedSum = purchaseDecisionHistogramData.reduce((sum, item) => sum + item.minute * item.volume, 0)
  const decisionMean = decisionTotal > 0 ? decisionWeightedSum / decisionTotal : 0
  const decisionWithinFive = purchaseDecisionHistogramData
    .filter((item) => item.minute <= 5)
    .reduce((sum, item) => sum + item.volume, 0)
  const decisionWithinFiveRatio = decisionTotal > 0 ? (decisionWithinFive / decisionTotal) * 100 : 0

  let cumulative = 0
  let decisionMedian = 0
  for (const item of purchaseDecisionHistogramData) {
    cumulative += item.volume
    if (cumulative >= decisionTotal / 2) {
      decisionMedian = item.minute
      break
    }
  }

  const weekdayDistribution = quality?.categorical_distributions?.find(d => d.column === 'event_weekday')?.top_values?.map(d => ({
    name: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][parseInt(d.label)] || d.label,
    value: d.count
  })) || []

  const weekdayMap = new Map(weekdayDistribution.map((item) => [item.name, item.value]))
  const cartEventsByDay = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((day) => ({
    day,
    value: weekdayMap.get(day) ?? 0,
  }))

  // Model performance radar data
  if (isLoading) {
    return (
      <div className="min-h-screen decor-gradient-canvas">
        <header className="border-b border-[hsl(var(--border)/0.82)] bg-[hsl(var(--surface-1)/0.99)]">
          <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4">
            <div className="flex items-center gap-3">
              <BarChart3 className="h-6 w-6 text-[hsl(var(--info))]" />
              <h1 className="readable-title text-xl">Conversion Insights Dashboard</h1>
            </div>
          </div>
        </header>
        <main className="mx-auto flex max-w-7xl items-center justify-center px-4 py-20">
          <div className="text-center">
            <Loader2 className="mx-auto h-8 w-8 animate-spin text-[hsl(var(--info))]" />
            <p className="type-body mt-4">Loading dataset intelligence...</p>
          </div>
        </main>
      </div>
    )
  }

  if (error) {
    return (
      <div className="min-h-screen decor-gradient-canvas">
        <header className="border-b border-[hsl(var(--border)/0.82)] bg-[hsl(var(--surface-1)/0.99)]">
          <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4">
            <div className="flex items-center gap-3">
              <BarChart3 className="h-6 w-6 text-[hsl(var(--info))]" />
              <h1 className="readable-title text-xl">Conversion Insights Dashboard</h1>
            </div>
            <RainbowButton colors={['#3b82f6', '#8b5cf6', '#ec4899', '#f59e0b']} duration={3}>
              <Link to="/" className="relative z-10 flex items-center gap-2 text-sm font-semibold text-foreground">
                <Home className="h-4 w-4" />
                Back to Studio
              </Link>
            </RainbowButton>
          </div>
        </header>
        <main className="mx-auto flex max-w-7xl items-center justify-center px-4 py-20">
        <Card className="dashboard-card panel-accent max-w-md">
            <CardContent className="pt-6">
                <div className="state-banner state-banner-error">
                  <AlertTriangle className="h-5 w-5 text-[hsl(var(--error))]" />
                <div>
                  <h3 className="font-semibold text-[hsl(var(--text-primary))]">Error Loading Data</h3>
                  <p className="type-body mt-1">{error}</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </main>
      </div>
    )
  }

  return (
    <div className="min-h-screen decor-gradient-canvas">
      {/* Header */}
      <header className="sticky top-0 z-50 border-b border-[hsl(var(--border)/0.82)] bg-[hsl(var(--surface-1)/0.95)] backdrop-blur">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4">
          <div className="flex items-center gap-3">
            <BarChart3 className="h-6 w-6 text-[hsl(var(--info))]" />
            <h1 className="readable-title text-xl">Conversion Insights Dashboard</h1>
          </div>
          <RainbowButton colors={['#3b82f6', '#8b5cf6', '#ec4899', '#f59e0b']} duration={3}>
            <Link to="/" className="relative z-10 flex items-center gap-2 text-sm font-semibold text-foreground">
              <Home className="h-4 w-4" />
              Back to Prediction Studio
            </Link>
          </RainbowButton>
        </div>
      </header>

      {/* Main Content */}
      <main className="mx-auto max-w-7xl space-y-6 px-4 py-6">
        <section className="section-reveal section-delay-1 rounded-2xl border border-border/75 bg-surface-2/72 p-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="type-kicker text-text-secondary">Dataset navigation</p>
              <p className="type-body mt-1 text-sm text-text-primary">Jump between insights without losing context.</p>
            </div>
            <nav className="flex flex-wrap gap-2" aria-label="Dataset section navigation">
              <a href="#overview" className="tone-chip px-2.5 py-1 text-xs transition-colors hover:bg-[hsl(var(--interactive)/0.2)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--focus-ring)/0.65)]">Overview</a>
              <a href="#conversion-behavior" className="tone-chip px-2.5 py-1 text-xs transition-colors hover:bg-[hsl(var(--interactive)/0.2)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--focus-ring)/0.65)]">Behavior</a>
              <a href="#funnel-brand" className="tone-chip px-2.5 py-1 text-xs transition-colors hover:bg-[hsl(var(--interactive)/0.2)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--focus-ring)/0.65)]">Funnel & Brand</a>
              <a href="#distribution" className="tone-chip px-2.5 py-1 text-xs transition-colors hover:bg-[hsl(var(--interactive)/0.2)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--focus-ring)/0.65)]">Distribution</a>
              <a href="#model-intelligence" className="tone-chip px-2.5 py-1 text-xs transition-colors hover:bg-[hsl(var(--interactive)/0.2)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--focus-ring)/0.65)]">Model</a>
            </nav>
          </div>
        </section>

        {/* Overview KPIs - Power BI Style */}
        <section id="overview" className="section-reveal section-delay-1 rounded-2xl border border-border/75 bg-surface-2/70 p-4">
          <div className="mb-4">
            <h2 className="type-heading text-lg">Overview</h2>
            <p className="type-caption mt-1 text-text-secondary">Core dataset and model KPIs for quick health checks.</p>
          </div>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
            <MetricTile
              label="Total Rows"
              value={formatNumber(profile?.rows)}
              description="Training dataset size"
              tone="info"
              icon={<Database className="h-5 w-5 text-[hsl(var(--info-contrast))]" />}
            />
            <MetricTile
              label="Features"
              value="32"
              description="Total columns"
              tone="info"
              icon={<Network className="h-5 w-5 text-[hsl(var(--info-contrast))]" />}
            />
            <MetricTile
              label="Missing %"
              value={formatPercent(profile?.missing_percent)}
              description="Missing data ratio"
              tone={(profile?.missing_percent ?? 0) > 5 ? 'warning' : 'success'}
              icon={<AlertTriangle className="h-5 w-5 text-[hsl(var(--warning-contrast))]" />}
            />
            <MetricTile
              label="Champion Model"
              value={modelOverview?.champion_version ?? 'N/A'}
              description="Best performing model"
              tone="success"
              icon={<BarChart3 className="h-5 w-5 text-[hsl(var(--success-contrast))]" />}
            />
            <MetricTile
              label="Best CV F1"
              value={
                <HighlightText variant="underline" color="primary" animationDuration={1}>
                  78.32%
                </HighlightText>
              }
              description="Cross-validation score"
              tone="info"
              icon={<SlidersHorizontal className="h-5 w-5 text-[hsl(var(--info-contrast))]" />}
            />
            <MetricTile
              label="Threshold"
              value={
                <HighlightText variant="marker" color="accent">
                  {modelOverview?.current_threshold?.toFixed(3) ?? 'N/A'}
                </HighlightText>
              }
              description="Prediction threshold"
              tone="info"
              icon={<Settings2 className="h-5 w-5 text-[hsl(var(--info-contrast))]" />}
            />
          </div>
        </section>

        <section id="conversion-behavior" className="section-reveal section-delay-2 rounded-2xl border border-border/75 bg-surface-2/70 p-4">
          <div className="mb-4">
            <h2 className="type-heading text-lg">Conversion Behavior</h2>
            <p className="type-caption mt-1 text-text-secondary">Time-driven patterns that shape purchase decisions.</p>
          </div>
          <div className="grid gap-4 lg:grid-cols-3">
            <Card className="dashboard-card panel-accent lg:col-span-2">
              <CardHeader className="pb-2">
                <CardTitle className="type-heading text-base">Hourly Purchase Probability</CardTitle>
                <CardDescription>Conversion rate by hour (15h - 23h)</CardDescription>
              </CardHeader>
              <CardContent>
                <ChartMountGate className="h-64">
                  {({ width, height }) => (
                    <AreaChart width={width} height={height} data={hourlyPurchaseProbabilityData} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
                      <defs>
                        <linearGradient id="hourlyRateGradient" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="hsl(var(--chart-2))" stopOpacity={0.32} />
                          <stop offset="95%" stopColor="hsl(var(--chart-2))" stopOpacity={0.02} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border) / 0.42)" />
                      <XAxis dataKey="hour" tick={{ fontSize: 11, fill: 'hsl(var(--text-secondary))' }} tickLine={false} />
                      <YAxis tickFormatter={(v: number) => `${(v * 100).toFixed(2)}%`} tick={{ fontSize: 11, fill: 'hsl(var(--text-secondary))' }} tickLine={false} width={64} />
                      <Tooltip
                        contentStyle={CHART_TOOLTIP_CONTENT_STYLE}
                        formatter={(value: unknown) => [formatRatioPercent(Number(value)), 'Conversion rate']}
                        labelFormatter={(label) => `Hour: ${label}h`}
                      />
                      <Area type="monotone" dataKey="rate" stroke="hsl(var(--chart-2))" fill="url(#hourlyRateGradient)" strokeWidth={2.25} dot={{ r: 3.5 }} activeDot={{ r: 6, fill: "hsl(var(--chart-2))", filter: "brightness(1.2)" }} />
                      <ReferenceDot
                        x={goldenHour.hour}
                        y={goldenHour.rate}
                        r={6}
                        fill="hsl(var(--chart-4))"
                        stroke="hsl(var(--background))"
                        strokeWidth={2}
                      />
                    </AreaChart>
                  )}
                </ChartMountGate>
                <p className="type-caption mt-2 text-right">
                  Golden Hour: <span className="font-semibold">{goldenHour.hour}h ({formatRatioPercent(goldenHour.rate)})</span>
                </p>
              </CardContent>
            </Card>

            <Card className="dashboard-card panel-accent">
              <CardHeader className="pb-2">
                <CardTitle className="type-heading text-base">Cart Events by Day of Week</CardTitle>
                <CardDescription className="cursor-pointer">Volume by weekday</CardDescription>
              </CardHeader>
              <CardContent>
                <ChartMountGate className="h-64">
                  {({ width, height }) => (
                    <BarChart width={width} height={height} data={cartEventsByDay} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border) / 0.42)" vertical={false} />
                      <XAxis dataKey="day" tick={{ fontSize: 11, fill: 'hsl(var(--text-secondary))' }} tickLine={false} />
                      <YAxis tick={{ fontSize: 11, fill: 'hsl(var(--text-secondary))' }} tickLine={false} />
                      <Tooltip contentStyle={CHART_TOOLTIP_CONTENT_STYLE} formatter={tooltipFormatter} />
                      <Bar dataKey="value" radius={[6, 6, 0, 0]} fill="hsl(var(--chart-3))" activeBar={CHART_ACTIVE_BAR_STYLE} style={{ cursor: 'pointer' }}>
                        <LabelList dataKey="value" position="top" className="fill-foreground text-[10px]" />
                      </Bar>
                    </BarChart>
                  )}
                </ChartMountGate>
              </CardContent>
            </Card>
          </div>

          <Card className="dashboard-card panel-accent mt-4">
            <CardHeader className="pb-2">
              <CardTitle className="type-heading text-base">Time to Make a Purchase Decision (first 60 minutes)</CardTitle>
              <CardDescription>Distribution with median / mean markers</CardDescription>
            </CardHeader>
            <CardContent>
              <ChartMountGate className="relative h-72">
                {({ width, height }) => (
                  <>
                    <ComposedChart
                      width={width}
                      height={height}
                      data={purchaseDecisionHistogramData}
                      margin={{ top: 8, right: 12, left: 0, bottom: 24 }}
                      barCategoryGap="0%"
                      barGap={0}
                    >
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border) / 0.42)" />
                      <XAxis
                        dataKey="minute"
                        tick={{ fontSize: 11, fill: 'hsl(var(--text-secondary))' }}
                        tickLine={false}
                        height={54}
                        label={{ value: 'Minutes after adding to cart', position: 'bottom', offset: 10 }}
                      />
                      <YAxis tick={{ fontSize: 11, fill: 'hsl(var(--text-secondary))' }} tickLine={false} />
                      <Tooltip
                        contentStyle={CHART_TOOLTIP_CONTENT_STYLE}
                        formatter={(value: unknown) => [formatNumber(Number(value)), 'Orders']}
                        labelFormatter={(label) => `Minute: ${label}`}
                      />
                      <Bar dataKey="volume" fill="hsl(var(--chart-3))" fillOpacity={0.42} stroke="hsl(var(--chart-3))" radius={[2, 2, 0, 0]} barSize={28} />
                      <Line type="monotone" dataKey="volume" stroke="hsl(var(--chart-4))" strokeWidth={2} dot={false} />
                      <ReferenceLine
                        x={decisionMedian}
                        stroke="hsl(var(--chart-1))"
                        strokeDasharray="6 4"
                        strokeWidth={2}
                        label={{ value: `Median: ${decisionMedian.toFixed(1)} min`, position: 'insideTopLeft', fill: 'hsl(var(--chart-1))' }}
                      />
                      <ReferenceLine
                        x={decisionMean}
                        stroke="hsl(var(--chart-2))"
                        strokeDasharray="6 4"
                        strokeWidth={2}
                        label={{ value: `Mean: ${decisionMean.toFixed(1)} min`, position: 'insideTopRight', fill: 'hsl(var(--chart-2))' }}
                      />
                    </ComposedChart>
                    <div className="pointer-events-none absolute right-4 top-4 rounded-lg border border-border/70 bg-card/80 px-3 py-2">
                      <p className="type-caption text-right">
                        Insight<br />
                        <span className="font-semibold">{decisionWithinFiveRatio.toFixed(1)}%</span> customers complete checkout within the first 5 minutes
                      </p>
                    </div>
                  </>
                )}
          </ChartMountGate>
      </CardContent>
          </Card>
        </section>

        <section id="funnel-brand" className="section-reveal section-delay-3 rounded-2xl border border-border/75 bg-surface-2/70 p-4">
          <div className="mb-4">
            <h2 className="type-heading text-lg">Conversion Funnel & Brand Efficiency</h2>
            <p className="type-caption mt-1 text-text-secondary">Compare stage drop-offs and brand-level performance impact.</p>
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            <Card className="dashboard-card panel-accent">
              <CardHeader className="pb-2">
                <CardTitle className="type-heading text-base">Conversion Funnel</CardTitle>
                <CardDescription>View → Cart → Purchase (% relative to views)</CardDescription>
              </CardHeader>
              <CardContent>
                <ChartMountGate className="h-64">
                  {({ width, height }) => (
                    <BarChart width={width} height={height} data={conversionFunnelDisplayData} margin={{ top: 34, right: 16, left: 10, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border) / 0.42)" vertical={false} />
                      <XAxis dataKey="stage" tick={{ fontSize: 11, fill: 'hsl(var(--text-secondary))' }} tickLine={false} />
                      <YAxis
                        tick={{ fontSize: 11, fill: 'hsl(var(--text-secondary))' }}
                        tickLine={false}
                        domain={[0, 100]}
                        tickFormatter={(value: number) => `${value.toFixed(0)}%`}
                      />
                      <Tooltip
                        contentStyle={CHART_TOOLTIP_CONTENT_STYLE}
                        formatter={(_value: unknown, _name: unknown, payload: { payload?: { value?: number; pct_of_view?: number } }) => {
                          const raw = payload?.payload?.value ?? 0
                          const pct = payload?.payload?.pct_of_view ?? 0
                          return [`${pct.toFixed(2)}% • ${formatNumber(raw)} records`, 'Stage']
                        }}
                      />
                      <Bar dataKey="pct_of_view" fill="hsl(var(--chart-1))" radius={[6, 6, 0, 0]} minPointSize={14} activeBar={CHART_ACTIVE_BAR_STYLE} style={{ cursor: 'pointer' }}>
                        <LabelList
                          dataKey="value"
                          position="top"
                          offset={8}
                          formatter={(v) => formatCompactNumber(Number(v))}
                          className="fill-foreground text-[10px]"
                        />
                      </Bar>
                    </BarChart>
                  )}
                </ChartMountGate>
              </CardContent>
            </Card>

            <Card className="dashboard-card panel-accent">
              <CardHeader className="pb-2">
                <CardTitle className="type-heading text-base">Brand Conversion Rate (Top 5)</CardTitle>
                <CardDescription>Estimated purchase rate by brand share</CardDescription>
              </CardHeader>
              <CardContent>
                <ChartMountGate className="h-64">
                  {({ width, height }) => (
                    <BarChart width={width} height={height} data={brandConversionRateData} layout="vertical" margin={{ top: 8, right: 16, left: 24, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border) / 0.42)" />
                      <XAxis
                        type="number"
                        tick={{ fontSize: 11, fill: 'hsl(var(--text-secondary))' }}
                        tickLine={false}
                        tickFormatter={(v: number) => `${(v * 100).toFixed(1)}%`}
                      />
                      <YAxis dataKey="name" type="category" tick={{ fontSize: 11, fill: 'hsl(var(--text-secondary))' }} tickLine={false} width={90} />
                      <Tooltip
                        contentStyle={CHART_TOOLTIP_CONTENT_STYLE}
                        formatter={(value: unknown, _name: unknown, payload: { payload?: { volume?: number; purchases?: number; share?: number } }) => {
                          const volume = payload?.payload?.volume ?? 0
                          const purchases = payload?.payload?.purchases ?? 0
                          const share = payload?.payload?.share ?? 0
                          return [`${formatRatioPercent(Number(value))} • Carts ${formatNumber(volume)} • Purchases ${formatNumber(purchases)} • Share ${(share * 100).toFixed(1)}%`, 'Conversion rate']
                        }}
                      />
                      <Bar dataKey="rate" fill="hsl(var(--chart-2))" radius={[0, 6, 6, 0]} activeBar={CHART_ACTIVE_BAR_STYLE} style={{ cursor: 'pointer' }}>
                        <LabelList
                          dataKey="rate"
                          position="right"
                          formatter={(v) => `${(Number(v) * 100).toFixed(2)}%`}
                          className="fill-foreground text-[10px]"
                        />
                      </Bar>
                    </BarChart>
                  )}
                </ChartMountGate>
              </CardContent>
            </Card>
          </div>
        </section>

        {/* Data Distribution Section - Power BI Style */}
        <section id="distribution" className="section-reveal section-delay-4 rounded-2xl border border-border/75 bg-surface-2/70 p-4">
          <div className="mb-4">
            <h2 className="type-heading text-lg">Data Distribution</h2>
            <p className="type-caption mt-1 text-text-secondary">Category, price, and brand spread to validate representativeness.</p>
          </div>
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {/* Horizontal Bar - Category Level 1 */}
            <HorizontalBarChartCard
              data={categoryLevel1Distribution}
              title="Category Level 1"
              description="Product category distribution"
            />

            <PriceDistributionChartCard data={priceDistribution} />

            <Card className="dashboard-card panel-accent">
              <CardHeader className="pb-2">
                <CardTitle className="type-heading text-base">Brand Efficiency (Carts vs Conversion)</CardTitle>
                <CardDescription>Bubble size encodes purchase volume</CardDescription>
              </CardHeader>
              <CardContent>
                <ChartMountGate className="h-56">
                  {({ width, height }) => (
                    <ScatterChart width={width} height={height} margin={{ top: 8, right: 16, left: 8, bottom: 6 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border) / 0.42)" />
                      <XAxis
                        type="number"
                        dataKey="carts"
                        name="Carts"
                        tick={{ fontSize: 11, fill: 'hsl(var(--text-secondary))' }}
                        tickLine={false}
                        tickFormatter={(value: number) => formatCompactNumber(value)}
                      />
                      <YAxis
                        type="number"
                        dataKey="ratePct"
                        name="Conversion %"
                        tick={{ fontSize: 11, fill: 'hsl(var(--text-secondary))' }}
                        tickLine={false}
                        tickFormatter={(value: number) => `${value.toFixed(1)}%`}
                      />
                      <ZAxis type="number" dataKey="purchases" range={[80, 680]} />
                      <Tooltip
                        cursor={{ strokeDasharray: '3 3' }}
                        contentStyle={CHART_TOOLTIP_CONTENT_STYLE}
                        formatter={(_value: unknown, _name: unknown, payload: { payload?: { name?: string; carts?: number; purchases?: number; ratePct?: number } }) => {
                          const d = payload?.payload
                          if (!d) return ['', '']
                          return [`${d.name} • Carts ${formatNumber(d.carts)} • Purchases ${formatNumber(d.purchases)} • CVR ${d.ratePct?.toFixed(2)}%`, 'Brand']
                        }}
                      />
                      <Scatter data={brandEfficiencyScatterData} fill="hsl(var(--chart-4))" fillOpacity={0.55} stroke="hsl(var(--chart-4))" />
                    </ScatterChart>
                  )}
                </ChartMountGate>
              </CardContent>
            </Card>

            {/* Horizontal Bar - Category Level 2 */}
            <HorizontalBarChartCard
              data={categoryLevel2Distribution}
              title="Category Level 2"
              description="Top subcategories"
            />
          </div>
        </section>

        {/* Model Section - Power BI Style */}
        <section id="model-intelligence" className="section-reveal section-delay-5 rounded-2xl border border-border/75 bg-surface-2/70 p-4">
          <div className="mb-4">
            <h2 className="type-heading text-lg">Model Intelligence</h2>
            <p className="type-caption mt-1 text-text-secondary">Architecture, hyperparameters, and lineage for auditability.</p>
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            {/* Architecture Card */}
            <Card className="dashboard-card panel-accent">
              <CardHeader className="pb-2">
                <div className="flex items-center gap-2">
                  <Network className="h-4 w-4 text-[hsl(var(--info))]" />
                  <CardTitle className="type-heading text-base">Architecture</CardTitle>
                </div>
                <CardDescription>Model type and feature schema</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <p className="type-kicker">Model Type</p>
                      <p className="type-body font-semibold mt-1">{architecture?.model_type ?? 'N/A'}</p>
                    </div>
                    <div>
                      <p className="type-kicker">Encoding</p>
                      <p className="type-body font-semibold mt-1">{architecture?.encoding_strategy ?? 'N/A'}</p>
                    </div>
                  </div>

                  <div>
                    <p className="type-kicker">Numeric Features ({architecture?.numeric_feature_count ?? 0})</p>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {(architecture?.numeric_features || []).slice(0, 12).map((feature) => (
                        <span
                          key={feature}
                          className="tone-chip px-2 py-1 text-xs"
                        >
                          {feature}
                        </span>
                      ))}
                    </div>
                  </div>

                  <div>
                    <p className="type-kicker">Categorical Features ({architecture?.categorical_feature_count ?? 0})</p>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {(architecture?.categorical_features || []).map((feature) => (
                        <span
                          key={feature}
                          className="tone-chip px-2 py-1 text-xs"
                        >
                          {feature}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Hyperparameters */}
            <Card className="dashboard-card panel-accent">
              <CardHeader className="pb-2">
                <div className="flex items-center gap-2">
                  <Settings2 className="h-4 w-4 text-[hsl(var(--info))]" />
                  <CardTitle className="type-heading text-base">Hyperparameters</CardTitle>
                </div>
                <CardDescription>Current model configuration</CardDescription>
              </CardHeader>
              <CardContent>
                <AnimatedTable
                  data={(hyperparameters?.items || []).map((param, i) => ({ id: param.key || i, ...param }))}
                  columns={[
                    { id: 'key', header: 'Parameter', accessorKey: 'key' as const, sortable: true },
                    { id: 'value', header: 'Value', accessorKey: 'value' as const, sortable: true },
                    { id: 'source', header: 'Source', accessorKey: 'source' as const, align: 'right' as const },
                  ]}
                  searchable
                  searchPlaceholder="Search parameters..."
                  className="max-h-64"
                  emptyMessage="No hyperparameters available"
                />
              </CardContent>
            </Card>

            {/* Model Lineage */}
            <Card className="dashboard-card panel-accent lg:col-span-2">
              <CardHeader className="pb-2">
                <div className="flex items-center gap-2">
                  <GitBranch className="h-4 w-4 text-[hsl(var(--info))]" />
                  <CardTitle className="type-heading text-base">Model Lineage</CardTitle>
                </div>
                <CardDescription>Version history from MLflow</CardDescription>
              </CardHeader>
              <CardContent>
                <AnimatedTable
                  data={(lineage?.versions || []).slice(0, 8).map((v, i) => ({ id: v.version || String(i), ...v }))}
                  columns={[
                    { id: 'version', header: 'Version', cell: (_row, i) => `v${i + 1}` },
                    { id: 'aliases', header: 'Aliases', cell: (row) => row.aliases?.length > 0 ? row.aliases.join(', ') : row.stage ?? '—' },
                    { id: 'run_id', header: 'Run ID', cell: (row) => row.run_id ?? 'Unavailable', sortable: true },
                    { id: 'created_at', header: 'Created', cell: (row) => formatDateTime(row.created_at), sortable: true },
                  ]}
                  searchable
                  searchPlaceholder="Search versions..."
                  className="max-h-64"
                  emptyMessage="No model versions available"
                />
                {modelOverview?.load_error ? (
                  <div className="state-banner state-banner-warning mt-3">
                    <ShieldAlert className="h-4 w-4 text-[hsl(var(--warning))]" />
                    <div>
                      <p className="text-sm font-semibold text-[hsl(var(--warning-foreground))]">Model metadata fallback</p>
                      <p className="type-caption mt-0.5">{modelOverview.load_error}</p>
                    </div>
                  </div>
                ) : null}
              </CardContent>
            </Card>
          </div>
        </section>
      </main>

      {/* Footer */}
      <footer className="border-t border-[hsl(var(--border)/0.82)] bg-[hsl(var(--surface-1)/0.99)] py-4">
        <div className="mx-auto max-w-7xl px-4">
          <div className="flex items-center justify-between type-caption">
            <p>Dataset: {profile?.dataset_source ?? 'N/A'}</p>
            <p>Last updated: {formatDateTime(profile?.last_updated_at)}</p>
          </div>
        </div>
      </footer>
    </div>
  )
}

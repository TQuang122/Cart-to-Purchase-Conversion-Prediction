import { useEffect, useState, useCallback, useMemo } from 'react'
import { 
  TrendingUp, 
  Activity, 
  CheckCircle2, 
  AlertCircle,
  Loader2,
  RefreshCw,
  Info
} from 'lucide-react'

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { BentoGrid, BentoGridItem } from '@/components/ui/bento-grid'
import { StatCounter, CircularCounter } from '@/components/ui/number-counter'
import SegmentedButton from '@/components/ui/segmented-button'
import { AnimatedTooltip } from '@/components/ui/animated-tooltip'
import { resolveApiRoot } from '@/lib/api'
import { ANIMATION_DURATION_MS, ANIMATION_STEPS, STATS_FETCH_TIMEOUT_MS, STATS_REFRESH_INTERVAL_MS, THRESHOLD_PRESETS } from '@/lib/thresholdConfig'
import type { ServingModel } from '@/types/api'

type ThresholdPresetId = 'low' | 'balanced' | 'high'

export interface StatsData {
  total_predictions: number
  successful_predictions: number
  failed_predictions: number
  success_rate: number
  recent_activity: number
  models_active: number
  models_usable?: number
  model_sources?: Partial<Record<ServingModel, string>>
  model_load_errors?: Partial<Record<ServingModel, string | null>>
  model_health?: Partial<Record<ServingModel, ModelHealthItem>>
  predict_threshold?: number
  start_time: string
}

interface ModelHealthItem {
  loaded: boolean
  usable: boolean
  source: string
  run_id: string | null
  model_uri: string | null
  last_checked_at: string | null
  last_loaded_at: string | null
  load_error: string | null
}

interface DashboardHeaderProps {
  apiBaseUrl?: string
  onStatsUpdate?: (stats: StatsData) => void
  onOpenIntro?: () => void
  layout?: 'full' | 'command'
  selectedModel: ServingModel
  onSelectModel: (model: ServingModel) => void
  selectedThreshold: number
  onThresholdChange: (threshold: number) => void
}

export function DashboardHeader({ 
  apiBaseUrl,
  onStatsUpdate,
  onOpenIntro,
  layout = 'full',
  selectedModel,
  onSelectModel,
  selectedThreshold,
  onThresholdChange,
}: DashboardHeaderProps) {
  // Normalize: always strip trailing /predict so we can consistently append it
  const resolvedBaseUrl = resolveApiRoot(apiBaseUrl)
  const [stats, setStats] = useState<StatsData | null>(null)
  const [apiStatus, setApiStatus] = useState<'connected' | 'disconnected' | 'loading'>('loading')
  const [animatedPredictions, setAnimatedPredictions] = useState(0)
  const [animatedRate, setAnimatedRate] = useState(0)
  const [isManualRefreshing, setIsManualRefreshing] = useState(false)
  const [lastUpdatedAt, setLastUpdatedAt] = useState<Date | null>(null)

  const fetchStats = useCallback(async (options?: { manual?: boolean }) => {
    const manual = options?.manual ?? false
    if (manual) {
      setIsManualRefreshing(true)
    }
    try {
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), STATS_FETCH_TIMEOUT_MS)
      const response = await fetch(`${resolvedBaseUrl}/predict/stats`, { signal: controller.signal })
      clearTimeout(timeoutId)
      if (response.ok) {
        const data = await response.json()
        setStats(data)
        setApiStatus('connected')
        setLastUpdatedAt(new Date())
        onStatsUpdate?.(data)
      } else {
        setApiStatus('disconnected')
      }
    } catch {
      setApiStatus('disconnected')
    } finally {
      if (manual) {
        setIsManualRefreshing(false)
      }
    }
  }, [resolvedBaseUrl, onStatsUpdate])

  useEffect(() => {
    void fetchStats()
    const interval = setInterval(() => {
      void fetchStats()
    }, STATS_REFRESH_INTERVAL_MS)
    return () => clearInterval(interval)
  }, [fetchStats])

  useEffect(() => {
    if (stats) {
      const stepDuration = ANIMATION_DURATION_MS / ANIMATION_STEPS
      const predictionsIncrement = (stats.total_predictions - animatedPredictions) / ANIMATION_STEPS
      const rateIncrement = (stats.success_rate - animatedRate) / ANIMATION_STEPS
      let step = 0
      const timer = setInterval(() => {
        step++
        setAnimatedPredictions(Math.round(animatedPredictions + predictionsIncrement * step))
        setAnimatedRate(Math.round((animatedRate + rateIncrement * step) * 10) / 10)
        if (step >= ANIMATION_STEPS) {
          clearInterval(timer)
          setAnimatedPredictions(stats.total_predictions)
          setAnimatedRate(stats.success_rate)
        }
      }, stepDuration)
      return () => clearInterval(timer)
    }
  }, [stats, animatedPredictions, animatedRate])

  const statusConfig = {
    connected: { icon: <CheckCircle2 className="h-4 w-4" />, label: 'Connected', bgColor: 'state-badge-success' },
    disconnected: { icon: <AlertCircle className="h-4 w-4" />, label: 'Disconnected', bgColor: 'state-badge-error' },
    loading: { icon: <Loader2 className="h-4 w-4 animate-spin" />, label: 'Connecting...', bgColor: 'state-badge-info' },
  }
  const status = statusConfig[apiStatus]
  const lastUpdatedLabel = useMemo(() => {
    if (!lastUpdatedAt) return 'N/A'
    return lastUpdatedAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  }, [lastUpdatedAt])

  const sourceValues = Object.values(stats?.model_sources ?? {})
  const derivedUsable = sourceValues.filter(
    (source) => source === 'mlflow' || source === 'heuristic_fallback'
  ).length
  const modelsUsable =
    stats?.models_usable ??
    (sourceValues.length > 0 ? derivedUsable : (stats?.models_active ?? 0))

  const fallbackModelHealth: Partial<Record<ServingModel, ModelHealthItem>> =
    Object.fromEntries(
      (Object.keys(stats?.model_sources ?? {}) as ServingModel[]).map((modelKey) => {
        const source = stats?.model_sources?.[modelKey] ?? 'unknown'
        const loadError = stats?.model_load_errors?.[modelKey] ?? null
        return [
          modelKey,
          {
            loaded: source === 'mlflow',
            usable: source === 'mlflow' || source === 'heuristic_fallback',
            source,
            run_id: null,
            model_uri: null,
            last_checked_at: null,
            last_loaded_at: null,
            load_error: loadError,
          },
        ]
      })
    )

  const modelHealth =
    stats?.model_health && Object.keys(stats.model_health).length > 0
      ? stats.model_health
      : fallbackModelHealth

  const modelHealthEntries = (Object.entries(modelHealth) as Array<[ServingModel, ModelHealthItem]>).sort(
    ([left], [right]) => left.localeCompare(right)
  )

  const clampedThreshold = Math.min(1, Math.max(0, selectedThreshold))
  const thresholdLabel = `${(clampedThreshold * 100).toFixed(1)}%`
  const thresholdExplainer = useMemo(() => {
    if (clampedThreshold < THRESHOLD_PRESETS.LOW.max) {
      return 'Low threshold: captures more potential buyers, but may increase false positives.'
    }
    if (clampedThreshold <= THRESHOLD_PRESETS.HIGH.min) {
      return 'Balanced threshold: keeps a practical tradeoff between reach and precision.'
    }
    return 'High threshold: improves precision, but may miss borderline purchase intent.'
  }, [clampedThreshold])

  const activeThresholdPreset: ThresholdPresetId = useMemo(() => {
    if (clampedThreshold < THRESHOLD_PRESETS.LOW.max) return 'low'
    if (clampedThreshold <= THRESHOLD_PRESETS.HIGH.min) return 'balanced'
    return 'high'
  }, [clampedThreshold])

  const handleThresholdInput = (event: React.ChangeEvent<HTMLInputElement>) => {
    const nextValue = Number(event.currentTarget.value)
    if (Number.isNaN(nextValue)) return
    onThresholdChange(Math.min(1, Math.max(0, nextValue)))
  }

  return (
    <div className={`animate-fade-in ${layout === 'command' ? '' : 'space-y-5'}`}>
      <div className={layout === 'command' ? 'flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between' : 'flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between'}>
        {layout === 'full' ? (
          <div className="flex items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl border border-border/60 bg-surface-2/70 shadow-sm">
              <img src="/logo-cart-neural.svg" alt="C2P Neural Cart Logo" width={36} height={36} className="h-9 w-9 md:hidden" />
              <img src="/logo-cart-neural-dense.svg" alt="C2P Neural Cart Dense Logo" width={40} height={40} className="hidden h-10 w-10 md:block" />
            </div>
            <div>
              <h1 className="type-display text-2xl text-text-primary sm:text-3xl md:text-4xl">
                Cart-to-Purchase Prediction
              </h1>
              <p className="type-body mt-1 text-sm">ML-powered conversion prediction dashboard</p>
            </div>
          </div>
        ) : (
          <div className="type-kicker inline-flex items-center gap-2 rounded-lg border border-border/70 bg-surface-2/85 px-3 py-2 text-text-secondary">
            <Activity className="state-text-success h-4 w-4" />
            Command controls
          </div>
        )}
        {layout === 'command' ? (
          <div className="grid w-full gap-3 md:ml-auto md:w-auto xl:grid-cols-[minmax(210px,232px)_minmax(240px,320px)_minmax(252px,280px)]">
            <div className="dashboard-card-muted dashboard-card-scale-sm rounded-xl p-3">
              <p className="type-kicker mb-2">Model</p>
              <Select value={selectedModel} onValueChange={(value) => onSelectModel(value as ServingModel)}>
                <SelectTrigger className="h-11 w-full border-border/70 bg-surface-2/88 text-sm font-semibold sm:text-base">
                  <SelectValue placeholder="Select model" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="tabicl">TabICL</SelectItem>
                  <SelectItem value="xgboost">XGBoost</SelectItem>
                  <SelectItem value="lightgbm">LightGBM</SelectItem>
                  <SelectItem value="catboost">CatBoost</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="dashboard-card dashboard-card-scale-md max-w-[320px] rounded-xl px-3 py-2.5">
              <div className="mb-1.5 flex items-center justify-between">
                <span className="type-kicker">Decision threshold</span>
                <span className="type-metric text-sm text-text-primary sm:text-base">{thresholdLabel}</span>
              </div>
              <input
                type="range"
                min={0}
                max={1}
                step={0.01}
                value={clampedThreshold}
                onChange={handleThresholdInput}
                className="h-2.5 w-full cursor-pointer accent-[hsl(var(--interactive))]"
                aria-label="Decision threshold"
                aria-valuetext={thresholdLabel}
              />
              <div className="mt-2">
                <AnimatedTooltip content="Quick threshold presets" placement="top">
                  <SegmentedButton
                    buttons={[
                      { id: 'low', label: 'Low' },
                      { id: 'balanced', label: 'Balanced' },
                      { id: 'high', label: 'High' },
                    ]}
                    active={activeThresholdPreset}
                    onChange={(id) => {
                      const values = {
                        low: THRESHOLD_PRESETS.LOW.value,
                        balanced: THRESHOLD_PRESETS.BALANCED.value,
                        high: THRESHOLD_PRESETS.HIGH.value,
                      }
                      onThresholdChange(values[id as keyof typeof values] ?? THRESHOLD_PRESETS.BALANCED.value)
                    }}
                    className="w-full"
                  />
                </AnimatedTooltip>
              </div>
              <p className="type-caption mt-1">{thresholdExplainer}</p>
            </div>

            <div className="dashboard-card-muted dashboard-card-scale-sm rounded-xl p-3">
              <div className="mb-2 flex items-center justify-between gap-2">
                <p className="type-kicker">System state</p>
                <div className={`type-caption flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 font-medium ${status.bgColor}`}>
                  <span className={`h-1.5 w-1.5 rounded-full ${apiStatus === 'connected' ? 'bg-green-500' : apiStatus === 'loading' ? 'bg-amber-500 animate-pulse' : 'bg-red-500'}`} />
                  {status.icon}
                  <span>{status.label}</span>
                </div>
              </div>
              <div className="mt-3 space-y-2">
                <div className="flex items-center gap-2 rounded-lg bg-surface-2/60 px-3 py-2">
                  <Activity className="h-4 w-4 text-blue-400" />
                  <div className="flex-1">
                    <p className="type-caption text-text-secondary">Recent activity</p>
                    <p className="type-metric text-sm font-bold tabular-nums text-text-primary">{stats?.recent_activity ?? 0} <span className="text-xs font-normal text-text-secondary">requests / 5m</span></p>
                  </div>
                </div>
                <div className="flex items-center justify-between">
                  <p className="type-caption text-text-secondary">Last updated</p>
                  <p className="type-caption font-medium tabular-nums text-text-primary">{lastUpdatedLabel}</p>
                </div>
              </div>
              <div className="mt-3 flex items-center gap-2">
                <button
                  onClick={onOpenIntro}
                  className="rounded-lg border border-border/60 bg-surface-2/70 p-2 text-text-secondary transition-colors hover:bg-surface-2 hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/55 focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                  title="About this project"
                  aria-label="Open project introduction"
                >
                  <Info className="h-4 w-4" />
                </button>
                <button
                  onClick={() => {
                    void fetchStats({ manual: true })
                  }}
                  disabled={isManualRefreshing}
                  className="rounded-lg border border-border/60 bg-surface-2/70 p-2 text-text-secondary transition-colors hover:bg-surface-2 hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/55 focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:opacity-50"
                  title="Refresh stats"
                  aria-label="Refresh dashboard statistics"
                >
                  <RefreshCw className={`h-4 w-4 ${isManualRefreshing ? 'animate-spin' : ''}`} />
                </button>
              </div>
            </div>
          </div>
        ) : (
          <div className="flex w-full flex-wrap items-center justify-end gap-2 sm:w-auto">
            <Select
              value={selectedModel}
              onValueChange={(value) => onSelectModel(value as ServingModel)}
            >
              <SelectTrigger className="h-11 w-[186px] border-border/70 bg-surface-2/88 text-sm font-semibold sm:w-[210px] sm:text-base">
                <SelectValue placeholder="Select model" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="tabicl">TabICL</SelectItem>
                <SelectItem value="xgboost">XGBoost</SelectItem>
                <SelectItem value="lightgbm">LightGBM</SelectItem>
                <SelectItem value="catboost">CatBoost</SelectItem>
              </SelectContent>
            </Select>
            <div className="min-w-[224px] rounded-lg border border-border/70 bg-surface-2/88 px-3 py-2.5">
              <div className="mb-1.5 flex items-center justify-between text-xs font-semibold uppercase tracking-wider text-text-secondary">
                <span>Decision threshold</span>
                <span className="type-metric text-sm text-text-primary sm:text-base">{thresholdLabel}</span>
              </div>
              <input
                type="range"
                min={0}
                max={1}
                step={0.01}
                value={clampedThreshold}
                onChange={handleThresholdInput}
                className="h-2.5 w-full cursor-pointer accent-[hsl(var(--interactive))]"
                aria-label="Decision threshold"
                aria-valuetext={thresholdLabel}
              />
              <p className="type-caption mt-1">{thresholdExplainer}</p>
            </div>
            <button onClick={onOpenIntro} className="rounded-lg border border-border/60 bg-surface-2/70 p-2 text-text-secondary transition-colors hover:bg-surface-2 hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/55 focus-visible:ring-offset-2 focus-visible:ring-offset-background" title="About this project" aria-label="Open project introduction">
              <Info className="h-4 w-4" />
            </button>
            <button onClick={() => { void fetchStats({ manual: true }) }} disabled={isManualRefreshing} className="rounded-lg border border-border/60 bg-surface-2/70 p-2 text-text-secondary transition-colors hover:bg-surface-2 hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/55 focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:opacity-50" title="Refresh stats" aria-label="Refresh dashboard statistics">
              <RefreshCw className={`h-4 w-4 ${isManualRefreshing ? 'animate-spin' : ''}`} />
            </button>
            <div className={`type-caption flex items-center gap-2 rounded-full border px-3 py-1.5 font-medium ${status.bgColor}`}>
              {status.icon}
              <span>{status.label}</span>
            </div>
          </div>
        )}
      </div>
      {layout === 'full' && (
        <>
          <BentoGrid className="grid-cols-1 sm:grid-cols-2 lg:grid-cols-4">
            <BentoGridItem className="animate-slide-up" style={{ animationDelay: '0ms' }}>
              <div className="dashboard-card-muted relative flex h-full flex-col justify-between overflow-hidden p-4 sm:p-5">
                <div className="mb-3">
                  <Activity className="state-text-info mb-2 h-6 w-6" />
                  <p className="text-xs font-medium uppercase tracking-wider text-text-secondary">Total Predictions</p>
                </div>
                <div>
                  <p className="type-metric text-3xl font-bold tabular-nums text-text-primary sm:text-4xl">
                    {animatedPredictions.toLocaleString()}
                  </p>
                  <StatCounter value={animatedRate} label="Success Rate %" suffix="%" decimals={1} className="font-bold text-2xl text-text-primary" />
                </div>
              </div>
            </BentoGridItem>

            <BentoGridItem className="animate-slide-up" style={{ animationDelay: '100ms' }}>
              <div className="dashboard-card-muted relative flex h-full flex-col items-center justify-center overflow-hidden p-4 sm:p-5">
                <div className="mb-3 text-center">
                  <TrendingUp className="state-text-success mx-auto mb-2 h-6 w-6" />
                  <p className="text-xs font-medium uppercase tracking-wider text-text-secondary">Success Rate</p>
                </div>
                <CircularCounter value={animatedRate} size={120} strokeWidth={8} color="hsl(var(--success))" />
              </div>
            </BentoGridItem>

            <BentoGridItem className="animate-slide-up" style={{ animationDelay: '200ms' }}>
              <div className="dashboard-card-muted relative flex h-full flex-col justify-between overflow-hidden p-4 sm:p-5">
                <div className="mb-3">
                  <CheckCircle2 className="state-text-warning mb-2 h-6 w-6" />
                  <p className="text-xs font-medium uppercase tracking-wider text-text-secondary">Models Usable</p>
                </div>
                <p className="type-metric text-4xl font-bold tabular-nums text-text-primary sm:text-5xl">{modelsUsable}</p>
              </div>
            </BentoGridItem>

            <BentoGridItem className="animate-slide-up" style={{ animationDelay: '300ms' }}>
              <div className="dashboard-card-muted relative flex h-full flex-col justify-between overflow-hidden p-4 sm:p-5">
                <div className="mb-3">
                  <Activity className="state-text-error mb-2 h-6 w-6" />
                  <p className="text-xs font-medium uppercase tracking-wider text-text-secondary">Recent (5m)</p>
                </div>
                <p className="type-metric text-4xl font-bold tabular-nums text-text-primary sm:text-5xl">{stats?.recent_activity ?? 0}</p>
              </div>
            </BentoGridItem>
          </BentoGrid>

          {modelHealthEntries.length > 0 && (
            <div className="dashboard-card-muted animate-slide-up p-4" style={{ animationDelay: '420ms' }}>
              <div className="mb-3 flex items-center justify-between">
                <p className="type-heading text-sm font-semibold text-text-primary">Model Health</p>
                <p className="type-caption">Runtime status</p>
              </div>
              <div className="grid gap-2 sm:grid-cols-3">
                {modelHealthEntries.map(([modelKey, health]) => (
                  <div key={modelKey} className="rounded-lg border border-border/55 bg-surface-2/60 p-3">
                    <div className="mb-2 flex items-center justify-between gap-2">
                      <p className="type-heading text-sm font-semibold text-text-primary">{modelKey.toUpperCase()}</p>
                      <span
                        className={
                          `type-kicker rounded-full border px-2 py-0.5 ${
                            health.loaded
                              ? 'state-badge-success'
                              : health.usable
                                ? 'state-badge-warning'
                                : 'state-badge-error'
                          }`
                        }
                      >
                        {health.loaded ? 'Loaded' : health.usable ? 'Fallback' : 'Unavailable'}
                      </span>
                    </div>
                    <p className="type-caption">Source: {health.source}</p>
                    {health.run_id ? (
                      <p className="type-caption truncate" title={health.run_id}>
                        Run ID: {health.run_id}
                      </p>
                    ) : null}
                    {health.load_error ? (
                      <p className="type-caption state-text-error mt-1 line-clamp-2" title={health.load_error}>
                        {health.load_error}
                      </p>
                    ) : null}
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}

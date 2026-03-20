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
import type { ServingModel } from '@/types/api'

interface StatCardProps {
  icon: React.ReactNode
  label: string
  value: string | number
  color: 'teal' | 'emerald' | 'amber' | 'rose'
}

const colorClasses = {
  teal: 'state-surface-info',
  emerald: 'state-surface-success',
  amber: 'state-surface-warning',
  rose: 'state-surface-error',
}

function StatCard({ icon, label, value, color }: StatCardProps) {
  return (
    <div
      className={`dashboard-card-muted relative overflow-hidden p-3 sm:p-4 transition-[border-color,background-color,color,box-shadow] duration-200 ${colorClasses[color]}`}
    >
      <div className="flex items-center justify-between">
        <div className="flex-1">
          <p className="text-xs font-medium uppercase tracking-wider text-text-secondary">{label}</p>
          <p className="mt-1 text-xl font-mono font-semibold tabular-nums tracking-tight text-text-primary sm:text-2xl">{value}</p>
        </div>
        <div className="rounded-lg bg-surface-1/60 p-2">{icon}</div>
      </div>
    </div>
  )
}

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
  apiBaseUrl = 'http://127.0.0.1:8000',
  onStatsUpdate,
  onOpenIntro,
  layout = 'full',
  selectedModel,
  onSelectModel,
  selectedThreshold,
  onThresholdChange,
}: DashboardHeaderProps) {
  // Normalize: always strip trailing /predict so we can consistently append it
  const resolvedBaseUrl = (apiBaseUrl ?? 'http://127.0.0.1:8000').replace(/\/predict\/?$/, '')
  const [stats, setStats] = useState<StatsData | null>(null)
  const [apiStatus, setApiStatus] = useState<'connected' | 'disconnected' | 'loading'>('loading')
  const [animatedPredictions, setAnimatedPredictions] = useState(0)
  const [animatedRate, setAnimatedRate] = useState(0)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [lastUpdatedAt, setLastUpdatedAt] = useState<Date | null>(null)

  const fetchStats = useCallback(async () => {
    setIsRefreshing(true)
    try {
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), 5000)
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
      setIsRefreshing(false)
    }
  }, [resolvedBaseUrl, onStatsUpdate])

  useEffect(() => {
    fetchStats()
    const interval = setInterval(fetchStats, 10000)
    return () => clearInterval(interval)
  }, [fetchStats])

  useEffect(() => {
    if (stats) {
      const duration = 1000
      const steps = 30
      const stepDuration = duration / steps
      const predictionsIncrement = (stats.total_predictions - animatedPredictions) / steps
      const rateIncrement = (stats.success_rate - animatedRate) / steps
      let step = 0
      const timer = setInterval(() => {
        step++
        setAnimatedPredictions(Math.round(animatedPredictions + predictionsIncrement * step))
        setAnimatedRate(Math.round((animatedRate + rateIncrement * step) * 10) / 10)
        if (step >= steps) {
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
  const stateMessage = useMemo(() => {
    if (isRefreshing) return 'Refreshing model stats and API heartbeat...'
    if (apiStatus === 'loading') return 'Checking API connection and service readiness.'
    if (apiStatus === 'disconnected') return 'API disconnected. Start backend to resume predictions.'
    return `Connected. Recent activity: ${stats?.recent_activity ?? 0} requests in the last 5 minutes.`
  }, [apiStatus, isRefreshing, stats?.recent_activity])

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
    if (clampedThreshold < 0.45) {
      return 'Low threshold: captures more potential buyers, but may increase false positives.'
    }
    if (clampedThreshold <= 0.6) {
      return 'Balanced threshold: keeps a practical tradeoff between reach and precision.'
    }
    return 'High threshold: improves precision, but may miss borderline purchase intent.'
  }, [clampedThreshold])

  const handleThresholdInput = (event: React.ChangeEvent<HTMLInputElement>) => {
    const nextValue = Number(event.target.value)
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
                  <SelectItem value="xgboost">XGBoost</SelectItem>
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
              <p className="type-caption mt-1">{thresholdExplainer}</p>
            </div>

            <div className="dashboard-card-muted dashboard-card-scale-sm rounded-xl p-3">
              <div className="mb-2 flex items-center justify-between gap-2">
                <p className="type-kicker">System state</p>
                <div className={`type-caption flex items-center gap-2 rounded-full border px-3 py-1 font-medium ${status.bgColor}`}>
                  {status.icon}
                  <span>{status.label}</span>
                </div>
              </div>
              <p className="type-caption">{stateMessage}</p>
              <p className="type-caption mt-1">Updated: {lastUpdatedLabel}</p>
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
                  onClick={fetchStats}
                  disabled={isRefreshing}
                  className="rounded-lg border border-border/60 bg-surface-2/70 p-2 text-text-secondary transition-colors hover:bg-surface-2 hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/55 focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:opacity-50"
                  title="Refresh stats"
                  aria-label="Refresh dashboard statistics"
                >
                  <RefreshCw className={`h-4 w-4 ${isRefreshing ? 'animate-spin' : ''}`} />
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
                <SelectItem value="xgboost">XGBoost</SelectItem>
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
            <button onClick={fetchStats} disabled={isRefreshing} className="rounded-lg border border-border/60 bg-surface-2/70 p-2 text-text-secondary transition-colors hover:bg-surface-2 hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/55 focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:opacity-50" title="Refresh stats" aria-label="Refresh dashboard statistics">
              <RefreshCw className={`h-4 w-4 ${isRefreshing ? 'animate-spin' : ''}`} />
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
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-2 sm:gap-4 lg:grid-cols-4">
            <div className="animate-slide-up" style={{ animationDelay: '0ms' }}>
              <StatCard icon={<Activity className="state-text-info h-5 w-5" />} label="Total Predictions" value={animatedPredictions.toLocaleString()} color="teal" />
            </div>
            <div className="animate-slide-up" style={{ animationDelay: '100ms' }}>
              <StatCard icon={<TrendingUp className="state-text-success h-5 w-5" />} label="Success Rate" value={`${animatedRate}%`} color="emerald" />
            </div>
            <div className="animate-slide-up" style={{ animationDelay: '200ms' }}>
              <StatCard icon={<CheckCircle2 className="state-text-warning h-5 w-5" />} label="Models Usable" value={modelsUsable} color="amber" />
            </div>
            <div className="animate-slide-up" style={{ animationDelay: '300ms' }}>
              <StatCard icon={<Activity className="state-text-error h-5 w-5" />} label="Recent (5m)" value={stats?.recent_activity ?? 0} color="rose" />
            </div>
          </div>

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

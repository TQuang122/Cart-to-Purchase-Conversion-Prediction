import { useEffect, useMemo, useState } from 'react'
import { AlertCircle, BarChart3, Database, GitBranch, Loader2, Network, Settings2, ShieldAlert, SlidersHorizontal } from 'lucide-react'
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { useAppContext } from '@/contexts/AppContext'
import { cn } from '@/lib/utils'
import type {
  DatasetProfileResponse,
  DatasetQualityResponse,
  ModelArchitectureResponse,
  ModelHyperparametersResponse,
  ModelLineageResponse,
  ModelOverviewResponse,
} from '@/types/api'

const CHART_TOOLTIP_CONTENT_STYLE = {
  backgroundColor: 'hsl(var(--surface-2))',
  border: '1px solid hsl(var(--border))',
  borderRadius: '0.75rem',
  color: 'hsl(var(--text-primary))',
}

const formatPercent = (value: number | null | undefined) => {
  if (value === null || value === undefined || Number.isNaN(value)) return 'Unavailable'
  return `${value.toFixed(1)}%`
}

const formatNumber = (value: number | null | undefined) => {
  if (value === null || value === undefined || Number.isNaN(value)) return 'Unavailable'
  return new Intl.NumberFormat('en-US').format(value)
}

const formatDateTime = (value: string | null | undefined) => {
  if (!value) return 'Unavailable'
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return value
  return parsed.toLocaleString([], { hour: '2-digit', minute: '2-digit', day: '2-digit', month: 'short' })
}

interface MetricTileProps {
  label: string
  value: string
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

  return (
    <div className={cn('dashboard-card-muted relative overflow-hidden p-4', toneClasses[tone])}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="type-kicker">{label}</p>
          <p className="type-metric mt-2 text-xl font-semibold text-text-primary sm:text-2xl">{value}</p>
          <p className="type-caption mt-2 text-text-secondary">{description}</p>
        </div>
        <div className="rounded-lg bg-surface-1/65 p-2 text-text-primary">{icon}</div>
      </div>
    </div>
  )
}

export function DatasetStatsTab() {
  const { state } = useAppContext()
  const apiRoot = useMemo(() => state.apiBaseUrl.replace(/\/predict\/?$/, ''), [state.apiBaseUrl])

  const [profile, setProfile] = useState<DatasetProfileResponse | null>(null)
  const [quality, setQuality] = useState<DatasetQualityResponse | null>(null)
  const [modelOverview, setModelOverview] = useState<ModelOverviewResponse | null>(null)
  const [architecture, setArchitecture] = useState<ModelArchitectureResponse | null>(null)
  const [hyperparameters, setHyperparameters] = useState<ModelHyperparametersResponse | null>(null)
  const [lineage, setLineage] = useState<ModelLineageResponse | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let ignore = false

    const fetchDashboardData = async () => {
      setIsLoading(true)
      setError(null)

      try {
        const responses = await Promise.all([
          fetch(`${apiRoot}/dataset/profile`),
          fetch(`${apiRoot}/dataset/quality`),
          fetch(`${apiRoot}/model/overview?model=${state.selectedModel}`),
          fetch(`${apiRoot}/model/architecture?model=${state.selectedModel}`),
          fetch(`${apiRoot}/model/hyperparameters?model=${state.selectedModel}`),
          fetch(`${apiRoot}/model/lineage?model=${state.selectedModel}`),
        ])

        const failing = responses.find((response) => !response.ok)
        if (failing) {
          throw new Error(`Failed to load dataset intelligence dashboard (${failing.status})`)
        }

        const [
          nextProfile,
          nextQuality,
          nextModelOverview,
          nextArchitecture,
          nextHyperparameters,
          nextLineage,
        ] = await Promise.all(responses.map((response) => response.json()))

        if (ignore) return

        setProfile(nextProfile)
        setQuality(nextQuality)
        setModelOverview(nextModelOverview)
        setArchitecture(nextArchitecture)
        setHyperparameters(nextHyperparameters)
        setLineage(nextLineage)
      } catch (fetchError) {
        if (ignore) return
        setError(fetchError instanceof Error ? fetchError.message : 'Failed to load dataset intelligence dashboard.')
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
  }, [apiRoot, state.selectedModel])

  const missingChartData = useMemo(
    () =>
      (quality?.top_missing_columns ?? [])
        .filter((column) => column.missing_percent > 0)
        .slice(0, 8)
        .map((column) => ({
          name: column.column,
          missing: Number(column.missing_percent.toFixed(2)),
        })),
    [quality]
  )

  const distributionSnapshots = quality?.numeric_distributions ?? []
  const categorySnapshots = quality?.categorical_distributions ?? []

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="type-heading flex items-center gap-2 text-base">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading dataset intelligence
          </CardTitle>
          <CardDescription>Collecting dataset profile, quality signals, and model metadata.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            <div className="h-36 animate-pulse rounded-2xl bg-surface-2/70" />
            <div className="h-36 animate-pulse rounded-2xl bg-surface-2/70" />
            <div className="h-64 animate-pulse rounded-2xl bg-surface-2/70 xl:col-span-2" />
          </div>
        </CardContent>
      </Card>
    )
  }

  if (error) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="type-heading flex items-center gap-2 text-base text-text-primary">
            <AlertCircle className="h-4 w-4 text-[hsl(var(--error))]" />
            Dataset intelligence unavailable
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="state-banner state-banner-error">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <div>
              <p className="type-heading text-sm font-semibold">Unable to load dashboard</p>
              <p className="type-caption mt-0.5 text-current/90">{error}</p>
            </div>
          </div>
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="border-b border-border/78 bg-surface-2/78">
          <CardTitle className="type-heading flex items-center gap-2 text-base sm:text-lg">
            <Database className="h-5 w-5 text-[hsl(var(--interactive-hover))]" />
            Dataset Intelligence Workspace
          </CardTitle>
          <CardDescription>
            A single view for dataset profile, data quality risk, and model metadata for the active serving model.
          </CardDescription>
        </CardHeader>
        <CardContent className="pt-4">
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 xl:grid-cols-3">
            <MetricTile
              label="Rows"
              value={formatNumber(profile?.rows)}
              description={profile?.dataset_available ? 'Training baseline rows available for profiling.' : 'Dataset file not found, using config fallback.'}
              tone="info"
              icon={<Database className="h-4 w-4" />}
            />
            <MetricTile
              label="Columns"
              value={formatNumber(profile?.cols)}
              description={`${formatNumber(profile?.numeric_columns)} numeric / ${formatNumber(profile?.categorical_columns)} categorical`}
              tone="info"
              icon={<BarChart3 className="h-4 w-4" />}
            />
            <MetricTile
              label="Missing %"
              value={formatPercent(profile?.missing_percent)}
              description={profile?.duplicate_rows !== null ? `${formatNumber(profile?.duplicate_rows)} duplicate rows detected` : 'Duplicate check unavailable'}
              tone={profile?.missing_percent && profile.missing_percent > 5 ? 'warning' : 'success'}
              icon={<ShieldAlert className="h-4 w-4" />}
            />
            <MetricTile
              label="Champion Model"
              value={modelOverview?.model_name ?? 'Unavailable'}
              description={modelOverview?.champion_version ? `v${modelOverview.champion_version} • ${modelOverview.model_alias}` : 'No registered version resolved yet'}
              tone="success"
              icon={<Network className="h-4 w-4" />}
            />
            <MetricTile
              label="Best CV F1"
              value={formatPercent(modelOverview?.best_cv_f1 ? modelOverview.best_cv_f1 * 100 : null)}
              description="Best Optuna study score captured from MLflow parent HPO runs."
              tone="success"
              icon={<GitBranch className="h-4 w-4" />}
            />
            <MetricTile
              label="Current Threshold"
              value={formatPercent(modelOverview?.current_threshold ? modelOverview.current_threshold * 100 : null)}
              description={`Workspace selection is currently ${state.selectedModel.toUpperCase()}.`}
              tone="warning"
              icon={<SlidersHorizontal className="h-4 w-4" />}
            />
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1.1fr_0.9fr]">
        <Card>
          <CardHeader className="border-b border-border/78 bg-surface-2/78">
            <CardTitle className="type-heading text-base">Data Quality</CardTitle>
            <CardDescription>
              Nulls, duplicates, distribution snapshots, and current drift readiness for the training baseline.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4 pt-4">
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              <div className="dashboard-card-muted p-4">
                <p className="type-kicker">Dataset source</p>
                <p className="type-heading mt-1 text-sm font-semibold text-text-primary">{profile?.dataset_source ?? 'Unavailable'}</p>
                <p className="type-caption mt-2 text-text-secondary">Updated {formatDateTime(profile?.last_updated_at)}</p>
              </div>
              <div className="dashboard-card-muted p-4">
                <p className="type-kicker">Drift monitor</p>
                <p className="type-heading mt-1 text-sm font-semibold text-text-primary">{quality?.drift_summary.status === 'available' ? 'Available' : 'Not configured'}</p>
                <p className="type-caption mt-2 text-text-secondary">{quality?.drift_summary.message}</p>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-4 xl:grid-cols-[0.95fr_1.05fr]">
              <div className="rounded-2xl border border-border/75 bg-surface-2/90 p-3.5">
                <p className="type-kicker mb-2">Missing value hotspots</p>
                {missingChartData.length > 0 ? (
                  <div className="h-72">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={missingChartData} layout="vertical" margin={{ top: 8, right: 12, left: 12, bottom: 8 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border) / 0.4)" />
                        <XAxis type="number" tickFormatter={(value) => `${value}%`} stroke="hsl(var(--text-secondary))" />
                        <YAxis dataKey="name" type="category" width={120} stroke="hsl(var(--text-secondary))" />
                        <Tooltip
                          formatter={(value) => {
                            const numericValue = typeof value === 'number' ? value : Number(value)
                            return Number.isFinite(numericValue) ? `${numericValue.toFixed(2)}%` : String(value)
                          }}
                          contentStyle={CHART_TOOLTIP_CONTENT_STYLE}
                        />
                        <Bar dataKey="missing" fill="hsl(var(--warning))" radius={[0, 8, 8, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                ) : (
                  <div className="type-caption flex h-72 items-center justify-center rounded-xl border border-dashed border-border/65 bg-background/35 text-text-secondary">
                    No missing-value spikes found in the current baseline.
                  </div>
                )}
              </div>

              <div className="rounded-2xl border border-border/75 bg-surface-2/90 p-3.5">
                <p className="type-kicker mb-2">Top columns by missingness</p>
                <Table containerClassName="max-h-72">
                  <TableHeader>
                    <TableRow>
                      <TableHead>Column</TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead className="text-right">Missing %</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(quality?.top_missing_columns ?? []).slice(0, 8).map((column) => (
                      <TableRow key={column.column}>
                        <TableCell className="font-medium text-text-primary">{column.column}</TableCell>
                        <TableCell>{column.dtype}</TableCell>
                        <TableCell className="text-right font-mono">{formatPercent(column.missing_percent)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
              {distributionSnapshots.map((snapshot) => (
                <div key={snapshot.column} className="rounded-2xl border border-border/75 bg-surface-2/90 p-3.5">
                  <div className="mb-2 flex items-start justify-between gap-3">
                    <div>
                      <p className="type-kicker">Numeric distribution</p>
                      <p className="type-heading mt-1 text-sm font-semibold text-text-primary">{snapshot.column}</p>
                    </div>
                    <div className="type-caption text-right text-text-secondary">
                      <p>Mean {snapshot.mean?.toFixed(2) ?? 'N/A'}</p>
                      <p>P50 {snapshot.median?.toFixed(2) ?? 'N/A'}</p>
                    </div>
                  </div>
                  <div className="h-52">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={snapshot.bins} margin={{ top: 8, right: 12, left: 0, bottom: 18 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border) / 0.35)" />
                        <XAxis dataKey="label" angle={-20} textAnchor="end" height={48} stroke="hsl(var(--text-secondary))" interval={0} />
                        <YAxis stroke="hsl(var(--text-secondary))" />
                        <Tooltip contentStyle={CHART_TOOLTIP_CONTENT_STYLE} />
                        <Bar dataKey="count" fill="hsl(var(--interactive-hover))" radius={[8, 8, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              ))}
            </div>

            <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
              {categorySnapshots.map((snapshot) => (
                <div key={snapshot.column} className="rounded-2xl border border-border/75 bg-surface-2/90 p-3.5">
                  <div className="mb-2 flex items-start justify-between gap-3">
                    <div>
                      <p className="type-kicker">Categorical profile</p>
                      <p className="type-heading mt-1 text-sm font-semibold text-text-primary">{snapshot.column}</p>
                    </div>
                    <p className="type-caption text-text-secondary">{snapshot.unique_count} unique values</p>
                  </div>
                  <div className="space-y-2">
                    {snapshot.top_values.map((item) => (
                      <div key={`${snapshot.column}-${item.label}`}>
                        <div className="type-caption mb-1 flex items-center justify-between gap-3 text-text-secondary">
                          <span className="truncate text-text-primary">{item.label}</span>
                          <span className="font-mono">{formatNumber(item.count)}</span>
                        </div>
                        <div className="h-2 rounded-full bg-surface-1/80">
                          <div
                            className="h-2 rounded-full bg-[hsl(var(--success))]"
                            style={{ width: `${Math.max(6, (item.count / Math.max(snapshot.top_values[0]?.count ?? 1, 1)) * 100)}%` }}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="border-b border-border/78 bg-surface-2/78">
            <CardTitle className="type-heading text-base">Model</CardTitle>
            <CardDescription>
              Architecture, feature schema, hyperparameter snapshot, and lineage for the active champion candidate.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4 pt-4">
            <div className="grid grid-cols-1 gap-4">
              <div className="dashboard-card-muted p-4">
                <div className="mb-3 flex items-start justify-between gap-3">
                  <div>
                    <p className="type-kicker">Architecture card</p>
                    <p className="type-heading mt-1 text-base font-semibold text-text-primary">{architecture?.model_label ?? 'Unavailable'}</p>
                  </div>
                  <span className="type-kicker rounded-full border border-border/70 px-2.5 py-1 text-text-primary">
                    {architecture?.model_type ?? state.selectedModel}
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                  <div>
                    <p className="type-kicker">Objective</p>
                    <p className="type-caption mt-1 text-text-primary">{architecture?.objective ?? 'Unavailable'}</p>
                  </div>
                  <div>
                    <p className="type-kicker">Eval metric</p>
                    <p className="type-caption mt-1 text-text-primary">
                      {Array.isArray(architecture?.eval_metric)
                        ? architecture.eval_metric.join(', ')
                        : architecture?.eval_metric ?? 'Unavailable'}
                    </p>
                  </div>
                  <div>
                    <p className="type-kicker">Split</p>
                    <p className="type-caption mt-1 text-text-primary">{architecture?.train_test_split ?? 'N/A'}</p>
                  </div>
                </div>
                <p className="type-caption mt-3 text-text-secondary">{architecture?.encoding_strategy ?? 'Encoding strategy unavailable.'}</p>
              </div>

              <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
                <div className="rounded-2xl border border-border/75 bg-surface-2/90 p-3.5">
                  <div className="mb-2 flex items-center gap-2">
                    <Settings2 className="h-4 w-4 text-[hsl(var(--interactive-hover))]" />
                    <p className="type-kicker">Hyperparameters</p>
                  </div>
                  <Table containerClassName="max-h-80">
                    <TableHeader>
                      <TableRow>
                        <TableHead>Key</TableHead>
                        <TableHead>Value</TableHead>
                        <TableHead>Source</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {(hyperparameters?.items ?? []).slice(0, 14).map((item) => (
                        <TableRow key={item.key}>
                          <TableCell className="font-medium text-text-primary">{item.key}</TableCell>
                          <TableCell className="font-mono">{item.value}</TableCell>
                          <TableCell className="uppercase tracking-wide">{item.source}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>

                <div className="rounded-2xl border border-border/75 bg-surface-2/90 p-3.5">
                  <div className="mb-2 flex items-center gap-2">
                    <Network className="h-4 w-4 text-[hsl(var(--interactive-hover))]" />
                    <p className="type-kicker">Feature schema</p>
                  </div>
                  <div className="space-y-3">
                    <div>
                      <p className="type-kicker mb-1">Numeric features ({architecture?.numeric_feature_count ?? 0})</p>
                      <div className="flex flex-wrap gap-1.5">
                        {(architecture?.numeric_features ?? []).slice(0, 12).map((feature) => (
                          <span key={feature} className="type-caption rounded-full border border-border/70 px-2 py-1 text-text-secondary">
                            {feature}
                          </span>
                        ))}
                      </div>
                    </div>
                    <div>
                      <p className="type-kicker mb-1">Categorical features ({architecture?.categorical_feature_count ?? 0})</p>
                      <div className="flex flex-wrap gap-1.5">
                        {(architecture?.categorical_features ?? []).map((feature) => (
                          <span key={feature} className="type-caption rounded-full border border-border/70 px-2 py-1 text-text-secondary">
                            {feature}
                          </span>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              <div className="rounded-2xl border border-border/75 bg-surface-2/90 p-3.5">
                <div className="mb-2 flex items-center gap-2">
                  <GitBranch className="h-4 w-4 text-[hsl(var(--interactive-hover))]" />
                  <p className="type-kicker">Model lineage</p>
                </div>
                <Table containerClassName="max-h-80">
                  <TableHeader>
                    <TableRow>
                      <TableHead>Version</TableHead>
                      <TableHead>Aliases</TableHead>
                      <TableHead>Run ID</TableHead>
                      <TableHead>Created</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(lineage?.versions ?? []).slice(0, 8).map((version) => (
                      <TableRow key={version.version}>
                        <TableCell className="font-medium text-text-primary">v{version.version}</TableCell>
                        <TableCell>{version.aliases.length > 0 ? version.aliases.join(', ') : version.stage ?? '—'}</TableCell>
                        <TableCell className="font-mono text-xs text-text-secondary">{version.run_id ?? 'Unavailable'}</TableCell>
                        <TableCell>{formatDateTime(version.created_at)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
                {modelOverview?.load_error ? (
                  <div className="state-banner state-banner-warning mt-3">
                    <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
                    <div>
                      <p className="type-heading text-sm font-semibold">Model metadata fallback</p>
                      <p className="type-caption mt-0.5 text-current/90">{modelOverview.load_error}</p>
                    </div>
                  </div>
                ) : null}
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

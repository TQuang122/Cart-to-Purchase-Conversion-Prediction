import { toast } from '@/lib/toast'
import { zodResolver } from '@hookform/resolvers/zod'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useForm } from 'react-hook-form'
import { z } from 'zod'
import { Activity, DatabaseZap, Gauge, Loader2, RotateCcw, ShieldCheck, Target } from 'lucide-react'

import { useAppContext } from '@/contexts/AppContext'
import { ApiClientError } from '@/lib/api'
import { cn } from '@/lib/utils'
import type { CartPrediction, FeatureContribution } from '@/types/api'
import { PredictionResultCard } from '@/components/PredictionResultCard'
import type { ConfidenceSignal } from '@/components/PredictionResultCard'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { StatusBanner } from '@/components/ui/status-banner'

const feastLookupSchema = z.object({
  user_id: z.string().min(1, 'User ID is required.'),
  product_id: z.string().min(1, 'Product ID is required.'),
})

type FeastLookupFormValues = z.infer<typeof feastLookupSchema>

const defaultValues: FeastLookupFormValues = {
  user_id: '',
  product_id: '',
}
const FEAST_DRAFT_KEY = 'c2p_feast_draft_v1'

const FEAST_PRESET_SCENARIOS = [
  {
    id: 'high-intent',
    title: 'Known pair A',
    description: 'Sample IDs aligned with feature-store utility examples.',
    values: { user_id: '512550662', product_id: '12703493' },
  },
  {
    id: 'known-pair-b',
    title: 'Known pair B',
    description: 'Alternate sample pair used in Feast scripts.',
    values: { user_id: '516301799', product_id: '12702930' },
  },
  {
    id: 'known-pair-c',
    title: 'Known pair C',
    description: 'Additional sample pair for quick lookup validation.',
    values: { user_id: '561066382', product_id: '3800966' },
  },
] as const

const toTitleCase = (value: string) =>
  value
    .split('_')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ')

const buildContributionSignals = (contributions: FeatureContribution[]): ConfidenceSignal[] => {
  const ranked = [...contributions].sort((a, b) => Math.abs(b.contribution) - Math.abs(a.contribution)).slice(0, 3)
  const maxAbs = Math.max(0.0001, ...ranked.map((item) => Math.abs(item.contribution)))

  return ranked.map((item) => ({
    label: item.display_name ?? toTitleCase(item.feature),
    detail: `Contribution score ${item.contribution >= 0 ? '+' : ''}${item.contribution.toFixed(4)}`,
    impact: item.contribution > 0 ? 'positive' : item.contribution < 0 ? 'negative' : 'neutral',
    strength: Math.min(1, Math.abs(item.contribution) / maxAbs),
  }))
}

export const FeastLookupTab = () => {
  const form = useForm<FeastLookupFormValues>({
    resolver: zodResolver(feastLookupSchema),
    defaultValues,
    mode: 'onTouched',
  })
  const { apiClient, dispatch, isLoading, state } = useAppContext()
  const [prediction, setPrediction] = useState<CartPrediction | null>(null)
  const [previousPrediction, setPreviousPrediction] = useState<CartPrediction | null>(null)
  const [lastLookupInput, setLastLookupInput] = useState<FeastLookupFormValues | null>(null)
  const [lastDraftSavedAt, setLastDraftSavedAt] = useState<Date | null>(null)
  const [draftRestored, setDraftRestored] = useState(false)
  const [showPresets, setShowPresets] = useState(true)
  const resultRef = useRef<HTMLDivElement | null>(null)
  const hasShownRestoreToastRef = useRef(false)

  const onSubmit = useCallback(async (values: FeastLookupFormValues) => {
    dispatch({ type: 'clearError' })
    dispatch({ type: 'startRequest' })
    try {
      setLastLookupInput(values)
      toast.info('Querying Feast online features...')
      const response = await apiClient.predictFeast(
        values,
        state.selectedModel,
        state.selectedThreshold
      )
      setPrediction((currentPrediction) => {
        setPreviousPrediction(currentPrediction)
        return response
      })
      toast.success('Feast lookup prediction completed!')
    } catch (error) {
      const baseMessage =
        error instanceof ApiClientError
          ? error.message
          : 'Failed to predict with feast lookup input.'
      const isUnavailable =
        error instanceof ApiClientError &&
        (error.status === 503 || baseMessage.toLowerCase().includes('not available'))
      const message = isUnavailable
        ? 'Feast lookup is unavailable on production server. Use Raw Features or Batch CSV instead.'
        : baseMessage
      dispatch({ type: 'setError', payload: message })
      toast.error(message)
      setPrediction(null)
    } finally {
      dispatch({ type: 'finishRequest' })
    }
  }, [apiClient, dispatch, state.selectedModel, state.selectedThreshold])

  useEffect(() => {
    if (typeof window === 'undefined') return
    const draft = window.localStorage.getItem(FEAST_DRAFT_KEY)
    if (!draft) return

    try {
      const parsed = JSON.parse(draft) as Partial<FeastLookupFormValues>
      const allowedKeys = Object.keys(defaultValues) as Array<keyof FeastLookupFormValues>
      const sanitized = Object.fromEntries(
        Object.entries(parsed).filter(([key]) => allowedKeys.includes(key as keyof FeastLookupFormValues))
      ) as Partial<FeastLookupFormValues>
      form.reset({ ...defaultValues, ...sanitized })
      setDraftRestored(true)
      if (!hasShownRestoreToastRef.current) {
        toast.info('Restored your last Feast draft.', 2200)
        hasShownRestoreToastRef.current = true
      }
    } catch {
      window.localStorage.removeItem(FEAST_DRAFT_KEY)
    }
  }, [form])

  useEffect(() => {
    if (!draftRestored) return
    const timer = window.setTimeout(() => {
      setDraftRestored(false)
    }, 3200)

    return () => window.clearTimeout(timer)
  }, [draftRestored])

  useEffect(() => {
    if (typeof window === 'undefined') return
    const subscription = form.watch((value) => {
      window.localStorage.setItem(FEAST_DRAFT_KEY, JSON.stringify(value))
      setLastDraftSavedAt(new Date())
    })

    return () => subscription.unsubscribe()
  }, [form])

  useEffect(() => {
    if (!prediction || !resultRef.current) return
    const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    resultRef.current.scrollIntoView({ behavior: prefersReducedMotion ? 'auto' : 'smooth', block: 'start' })
  }, [prediction])

  // Keyboard shortcut: Ctrl+Enter to submit
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter' && !isLoading) {
        form.handleSubmit(onSubmit)()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [form, isLoading, onSubmit])

  const feastConfidenceSignals: ConfidenceSignal[] =
    prediction?.feature_contributions && prediction.feature_contributions.length > 0
      ? buildContributionSignals(prediction.feature_contributions)
      : prediction
        ? [
        {
          label: 'Feast entity lookup',
          detail: `Resolved with user_id=${lastLookupInput?.user_id ?? 'N/A'} and product_id=${lastLookupInput?.product_id ?? 'N/A'}`,
          impact: 'neutral',
          strength: 0.55,
        },
        {
          label: 'Model confidence distance',
          detail: `Distance from boundary: ${(Math.abs((prediction.probability ?? 0.5) - 0.5) * 100).toFixed(1)} pts`,
          impact: (prediction.probability ?? 0) >= 0.5 ? 'positive' : 'negative',
          strength: Math.min(1, Math.abs((prediction.probability ?? 0.5) - 0.5) * 2),
        },
        {
          label: 'Real-time feature freshness',
          detail: 'Prediction uses online feature values at request time.',
          impact: 'positive',
          strength: 0.7,
        },
          ]
        : []

  const probability = prediction?.probability ?? 0
  const decisionThreshold = prediction?.decision_threshold ?? 0.5
  const thresholdGap = probability - decisionThreshold
  const confidenceBand = (() => {
    const midpointDistance = Math.abs(probability - 0.5)
    if (midpointDistance >= 0.35) return 'High'
    if (midpointDistance >= 0.18) return 'Medium'
    return 'Low'
  })()

  const draftSavedLabel =
    lastDraftSavedAt
      ? `Draft saved at ${lastDraftSavedAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
      : 'Draft autosave inactive'

  const clearDraft = () => {
    if (typeof window !== 'undefined') {
      window.localStorage.removeItem(FEAST_DRAFT_KEY)
    }
    setDraftRestored(false)
    setLastDraftSavedAt(null)
    toast.info('Feast draft cleared.')
  }

  const applyPreset = useCallback((values: FeastLookupFormValues, label: string) => {
    form.reset({ ...defaultValues, ...values })
    setDraftRestored(false)
    setPrediction(null)
    dispatch({ type: 'clearError' })
    toast.success(`Preset loaded: ${label}`)
  }, [dispatch, form])

  const retryPrediction = useCallback(() => {
    form.handleSubmit(onSubmit)()
  }, [form, onSubmit])

  return (
    <Card>
      <CardHeader className="space-y-3 border-b border-border/60 bg-surface-2/65 pb-5">
        <div className="state-text-success flex items-center gap-2">
          <DatabaseZap className="h-4 w-4" />
          <span className="type-kicker">Feature Store Lookup</span>
        </div>
        <CardTitle className="readable-title text-xl sm:text-[1.36rem]">Feast Lookup Prediction</CardTitle>
        <CardDescription className="readable-description">
          Query online features and run prediction.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6 pt-7 sm:pt-8">
        <Form {...form}>
          <form className="space-y-5" onSubmit={form.handleSubmit(onSubmit)}>
            <div className="panel-accent rounded-xl border border-border/60 bg-muted/20 p-4">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <p className="type-heading text-sm font-semibold text-foreground">Preset entity scenarios</p>
                  <p className="readable-helper">Use sample IDs to validate Feast lookup, fallback, and threshold behavior.</p>
                </div>
                <button
                  type="button"
                  onClick={() => setShowPresets((prev) => !prev)}
                  className="micro-interactive rounded-lg border border-border/50 px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                >
                  {showPresets ? 'Hide' : 'Show'}
                </button>
              </div>
              {showPresets ? (
                <div className="mt-4 grid grid-cols-1 gap-2.5 sm:grid-cols-3">
                  {FEAST_PRESET_SCENARIOS.map((preset) => (
                    <button
                      key={preset.id}
                      type="button"
                      onClick={() => applyPreset(preset.values, preset.title)}
                      className="micro-interactive rounded-lg border border-border/60 bg-background/60 p-3 text-left transition-colors hover:border-[hsl(var(--interactive)/0.5)] hover:bg-[hsl(var(--interactive)/0.12)]"
                    >
                      <p className="type-heading text-sm font-semibold text-foreground">{preset.title}</p>
                      <p className="type-caption mt-1">{preset.description}</p>
                      <p className="type-caption mt-2 text-text-secondary">u:{preset.values.user_id} / p:{preset.values.product_id}</p>
                    </button>
                  ))}
                </div>
              ) : null}
            </div>

            {isLoading ? (
              <div className="section-reveal section-delay-2 panel-accent rounded-xl border border-border/60 bg-muted/25 p-4">
                <StatusBanner
                  variant="loading"
                  title="Loading lookup form"
                  message="Loading Feast lookup controls..."
                  className="mb-3"
                />
                <div className="space-y-4">
                  <div className="space-y-2">
                    <Skeleton className="skeleton-shimmer h-4 w-20" />
                    <Skeleton className="skeleton-shimmer h-11 w-full" />
                  </div>
                  <div className="space-y-2">
                    <Skeleton className="skeleton-shimmer h-4 w-24" />
                    <Skeleton className="skeleton-shimmer h-11 w-full" />
                  </div>
                  <Skeleton className="skeleton-shimmer h-11 w-40" />
                </div>
              </div>
            ) : (
              <fieldset className="space-y-4 rounded-xl border border-border/60 bg-card/40 p-4" aria-describedby="feast-lookup-hint">
                <legend className="type-kicker px-1 text-muted-foreground">Lookup entities</legend>
                <p id="feast-lookup-hint" className="type-caption -mt-1 px-1 text-muted-foreground">Provide both entity IDs to resolve online features in Feast before scoring.</p>
                <FormField
                  control={form.control}
                  name="user_id"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="readable-label">User ID</FormLabel>
                      <FormControl>
                        <Input
                          {...field}
                          placeholder="e.g. 512550662"
                          disabled={isLoading}
                          className="h-11 border-border/70 bg-background/70 focus-visible:ring-[hsl(var(--focus-ring)/0.4)]"
                        />
                      </FormControl>
                      <FormDescription className="type-caption">Use a Feast entity key (numeric or string) available in online store.</FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="product_id"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="readable-label">Product ID</FormLabel>
                      <FormControl>
                        <Input
                          {...field}
                          placeholder="e.g. 12703493"
                          disabled={isLoading}
                          className="h-11 border-border/70 bg-background/70 focus-visible:ring-[hsl(var(--focus-ring)/0.4)]"
                        />
                      </FormControl>
                      <FormDescription className="type-caption">Use product entity key from Feast registry to fetch online features.</FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </fieldset>
            )}

            <div className="sticky bottom-0 z-10 -mx-4 border-t border-border/60 bg-card/90 px-4 py-4 backdrop-blur sm:-mx-6 sm:px-6" role="region" aria-label="Feast lookup actions">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="space-y-1">
                  <p className="type-heading text-sm font-semibold">Ready to run Feast lookup prediction</p>
                  <p className="readable-helper">Shortcut: Ctrl+Enter</p>
                  <p className="type-caption" aria-live="polite">{draftSavedLabel}</p>
                  {draftRestored ? <p className="type-caption state-text-success">Draft restored from previous session.</p> : null}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Button type="button" variant="outline" onClick={clearDraft} className="h-11">Clear Draft</Button>
                  <Button type="submit" disabled={isLoading} variant="glow" size="lg" className="min-w-32">
                    {isLoading ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Predicting...
                      </>
                    ) : 'Predict'}
                  </Button>
                </div>
              </div>
            </div>
          </form>
        </Form>

        {state.errorMessage ? (
          <div className="space-y-3">
            <StatusBanner variant="error" message={state.errorMessage} />
            <div className="flex justify-end">
              <Button type="button" variant="outline" onClick={retryPrediction} disabled={isLoading} className="h-10">
                <RotateCcw className="mr-2 h-4 w-4" />
                Retry prediction
              </Button>
            </div>
          </div>
        ) : null}

        {!prediction && !isLoading && (
          <div className="type-body mt-2 rounded-xl border border-dashed border-border/70 bg-muted/20 p-4 text-center text-sm">
            Enter a user ID and product ID to run prediction using Feast online features.
          </div>
        )}

        {prediction ? (
          <div ref={resultRef} className="space-y-4">
            <div className="grid grid-cols-1 gap-3 md:grid-cols-4" aria-live="polite" aria-atomic="false">
              <div className="state-surface-info rounded-xl border p-3.5">
                <div className="mb-2 flex items-center justify-between">
                  <p className="type-caption">Conversion probability</p>
                  <Activity className="h-4 w-4 text-blue-500" />
                </div>
                <p className="type-metric state-text-info text-xl font-semibold">{(probability * 100).toFixed(1)}%</p>
              </div>
              <div className="rounded-xl border border-border/70 bg-surface-2/70 p-3.5">
                <div className="mb-2 flex items-center justify-between">
                  <p className="type-caption">Confidence band</p>
                  <ShieldCheck className="h-4 w-4 text-emerald-500" />
                </div>
                <p className="type-heading text-xl font-semibold text-text-primary">{confidenceBand}</p>
              </div>
              <div className={thresholdGap >= 0 ? 'state-surface-success rounded-xl border p-3.5' : 'state-surface-error rounded-xl border p-3.5'}>
                <div className="mb-2 flex items-center justify-between">
                  <p className="type-caption">Threshold gap</p>
                  <Target className={thresholdGap >= 0 ? 'h-4 w-4 text-green-500' : 'h-4 w-4 text-rose-500'} />
                </div>
                <p className={cn('type-metric text-xl font-semibold', thresholdGap >= 0 ? 'state-text-success' : 'state-text-error')}>
                  {thresholdGap >= 0 ? '+' : ''}
                  {(thresholdGap * 100).toFixed(1)} pts
                </p>
              </div>
              <div className="state-surface-warning rounded-xl border p-3.5">
                <div className="mb-2 flex items-center justify-between">
                  <p className="type-caption">Feature quality</p>
                  <Gauge className="h-4 w-4 text-amber-500" />
                </div>
                <p className="type-metric state-text-warning text-xl font-semibold">
                  {prediction.feature_quality ? prediction.feature_quality.grade : 'N/A'}
                </p>
              </div>
            </div>

            <div className="panel-accent rounded-xl border border-border/70 bg-surface-2/68 p-4">
              <p className="type-kicker mb-2">Feast story</p>
              <p className="type-body text-sm text-text-primary">
                Entity pair <span className="type-metric font-semibold">{lastLookupInput?.user_id ?? 'N/A'}</span> and <span className="type-metric font-semibold">{lastLookupInput?.product_id ?? 'N/A'}</span>{' '}
                resolved online features, then model <span className={cn('font-semibold', prediction.is_purchased === 1 ? 'state-text-success' : 'state-text-error')}>{prediction.is_purchased === 1 ? 'favored conversion' : 'flagged lower purchase intent'}</span> at{' '}
                <span className="type-metric font-semibold">{(probability * 100).toFixed(1)}%</span> against threshold{' '}
                <span className="type-metric font-semibold">{(decisionThreshold * 100).toFixed(1)}%</span>.
              </p>
              {prediction.feature_quality ? (
                <p className="type-caption mt-2 text-muted-foreground">
                  Quality score {prediction.feature_quality.score.toFixed(1)} ({prediction.feature_quality.grade}) with fallback ratio {(prediction.feature_quality.fallback_ratio * 100).toFixed(1)}%.
                </p>
              ) : null}
            </div>

            <PredictionResultCard
              prediction={prediction}
              previousPrediction={previousPrediction}
              context="feast"
              onPredictAgain={() => setPrediction(null)}
              confidenceSignals={feastConfidenceSignals}
            />
          </div>
        ) : null}
      </CardContent>
    </Card>
  )
}

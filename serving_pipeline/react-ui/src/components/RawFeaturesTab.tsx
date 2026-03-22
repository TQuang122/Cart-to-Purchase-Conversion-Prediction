import { zodResolver } from '@hookform/resolvers/zod'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useForm } from 'react-hook-form'
import { toast } from 'sonner'
import { z } from 'zod'
import { BrainCircuit, Sparkles } from 'lucide-react'

import { useAppContext } from '@/contexts/AppContext'
import { ApiClientError } from '@/lib/api'
import type { CartInputRawLite, CartPrediction, FeatureContribution } from '@/types/api'
import { PredictionResultCard } from '@/components/PredictionResultCard'
import type { ConfidenceSignal } from '@/components/PredictionResultCard'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'

const rawLiteSchema = z.object({
  price: z.number().nonnegative(),
  activity_count: z.number().nonnegative(),
  event_weekday: z.number().int().min(0).max(6),
  event_hour: z.number().int().min(0).max(23),
  user_total_views: z.number().nonnegative(),
  user_total_carts: z.number().nonnegative(),
  product_total_views: z.number().nonnegative(),
  product_total_carts: z.number().nonnegative(),
  brand_purchase_rate: z.number().min(0).max(1),
  price_vs_user_avg: z.number(),
  price_vs_category_avg: z.number(),
  brand: z.string().min(1),
  category_code_level1: z.string().min(1),
  category_code_level2: z.string().min(1),
})

type RawFeaturesFormValues = z.infer<typeof rawLiteSchema>
type LiteFeatureName = keyof RawFeaturesFormValues
type FeatureGroup = 'event' | 'user' | 'product' | 'category'

interface LiteFeatureMetadata {
  name: LiteFeatureName
  type: 'number' | 'string'
  constraints?: { min?: number; max?: number }
}

const defaultValues: RawFeaturesFormValues = {
  price: 0, activity_count: 0, event_weekday: 0, event_hour: 0,
  user_total_views: 0, user_total_carts: 0, product_total_views: 0, product_total_carts: 0,
  brand_purchase_rate: 0, price_vs_user_avg: 0, price_vs_category_avg: 0,
  brand: '', category_code_level1: '', category_code_level2: '',
}

const FEATURE_GROUPS: Record<FeatureGroup, LiteFeatureName[]> = {
  event: ['price', 'activity_count', 'event_weekday', 'event_hour'],
  user: ['user_total_views', 'user_total_carts'],
  product: ['product_total_views', 'product_total_carts', 'brand_purchase_rate', 'price_vs_user_avg', 'price_vs_category_avg'],
  category: ['brand', 'category_code_level1', 'category_code_level2'],
}

const FEATURE_GROUP_LABELS: Record<FeatureGroup, string> = {
  event: 'Event Info', user: 'User Signals', product: 'Product Signals', category: 'Category & Brand',
}

const LITE_FEATURES: LiteFeatureMetadata[] = [
  { name: 'price', type: 'number', constraints: { min: 0 } },
  { name: 'activity_count', type: 'number', constraints: { min: 0 } },
  { name: 'event_weekday', type: 'number', constraints: { min: 0, max: 6 } },
  { name: 'event_hour', type: 'number', constraints: { min: 0, max: 23 } },
  { name: 'user_total_views', type: 'number', constraints: { min: 0 } },
  { name: 'user_total_carts', type: 'number', constraints: { min: 0 } },
  { name: 'product_total_views', type: 'number', constraints: { min: 0 } },
  { name: 'product_total_carts', type: 'number', constraints: { min: 0 } },
  { name: 'brand_purchase_rate', type: 'number', constraints: { min: 0, max: 1 } },
  { name: 'price_vs_user_avg', type: 'number' },
  { name: 'price_vs_category_avg', type: 'number' },
  { name: 'brand', type: 'string' },
  { name: 'category_code_level1', type: 'string' },
  { name: 'category_code_level2', type: 'string' },
]

const FEATURE_LABEL_OVERRIDES: Partial<Record<LiteFeatureName, string>> = {
  event_weekday: 'Event Weekday (0-6)', event_hour: 'Event Hour (0-23)',
  brand_purchase_rate: 'Brand Purchase Rate', price_vs_user_avg: 'Price vs User Average',
  price_vs_category_avg: 'Price vs Category Average', category_code_level1: 'Category Code Level 1',
  category_code_level2: 'Category Code Level 2',
}

const formatFeatureLabel = (featureName: LiteFeatureName) => {
  if (FEATURE_LABEL_OVERRIDES[featureName]) return FEATURE_LABEL_OVERRIDES[featureName]
  return featureName.split('_').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ')
}

interface PresetScenario { id: string; title: string; description: string; values: Partial<RawFeaturesFormValues> }
interface RawFeaturesTabProps { autoApplyPresetId?: string | null; autoApplyPresetToken?: number }
export const DEFAULT_PRESET_SCENARIO_ID = 'new-user-low-intent'

const PRESET_SCENARIOS: PresetScenario[] = [
  { id: 'new-user-low-intent', title: 'Low Intent Starter', description: 'Lean behavior and weak conversion signal.', values: { price: 59.99, activity_count: 2, event_weekday: 2, event_hour: 11, user_total_views: 24, user_total_carts: 2, product_total_views: 640, product_total_carts: 72, brand_purchase_rate: 0.16, price_vs_user_avg: 0.35, price_vs_category_avg: 0.22, brand: 'starter_brand', category_code_level1: 'electronics', category_code_level2: 'accessories' }},
  { id: 'returning-high-intent', title: 'High Intent Returning', description: 'Strong repeat behavior and favorable conversion context.', values: { price: 42.5, activity_count: 9, event_weekday: 5, event_hour: 20, user_total_views: 240, user_total_carts: 65, product_total_views: 3700, product_total_carts: 920, brand_purchase_rate: 0.58, price_vs_user_avg: -0.12, price_vs_category_avg: -0.08, brand: 'trusted_brand', category_code_level1: 'electronics', category_code_level2: 'smartphones' }},
  { id: 'price-sensitive-comparer', title: 'Price-Sensitive Comparer', description: 'High browsing, conversion highly dependent on price fit.', values: { price: 129.0, activity_count: 7, event_weekday: 6, event_hour: 14, user_total_views: 160, user_total_carts: 38, product_total_views: 2100, product_total_carts: 490, brand_purchase_rate: 0.31, price_vs_user_avg: 0.26, price_vs_category_avg: 0.19, brand: 'value_line', category_code_level1: 'electronics', category_code_level2: 'audio' }},
]

const buildLiteConfidenceSignals = (values: RawFeaturesFormValues): ConfidenceSignal[] => {
  const viewToCartRate = values.user_total_views > 0 ? values.user_total_carts / values.user_total_views : 0
  const productViewToCartRate = values.product_total_views > 0 ? values.product_total_carts / values.product_total_views : 0
  const candidates: Array<ConfidenceSignal & { score: number }> = [
    { label: 'User view-to-cart rate', detail: `Current value ${(viewToCartRate * 100).toFixed(1)}%`, impact: viewToCartRate >= 0.22 ? 'positive' : 'negative', strength: Math.min(1, Math.abs(viewToCartRate - 0.22) / 0.22), score: Math.abs(viewToCartRate - 0.22) },
    { label: 'Product view-to-cart rate', detail: `Current value ${(productViewToCartRate * 100).toFixed(1)}%`, impact: productViewToCartRate >= 0.18 ? 'positive' : 'negative', strength: Math.min(1, Math.abs(productViewToCartRate - 0.18) / 0.18), score: Math.abs(productViewToCartRate - 0.18) },
    { label: 'Brand purchase baseline', detail: `Current baseline ${(values.brand_purchase_rate * 100).toFixed(1)}%`, impact: values.brand_purchase_rate >= 0.35 ? 'positive' : 'negative', strength: Math.min(1, Math.abs(values.brand_purchase_rate - 0.35) / 0.35), score: Math.abs(values.brand_purchase_rate - 0.35) },
    { label: 'Price vs user average', detail: `Current delta ${values.price_vs_user_avg.toFixed(2)}`, impact: values.price_vs_user_avg <= 0 ? 'positive' : 'negative', strength: Math.min(1, Math.abs(values.price_vs_user_avg) / 0.8), score: Math.abs(values.price_vs_user_avg) },
  ]
  return candidates
    .sort((a, b) => b.score - a.score)
    .slice(0, 3)
    .map((signal) => ({
      label: signal.label,
      detail: signal.detail,
      impact: signal.impact,
      strength: signal.strength,
    }))
}

const toConfidenceSignals = (contributions: FeatureContribution[]): ConfidenceSignal[] => {
  const ranked = [...contributions].sort((a, b) => Math.abs(b.contribution) - Math.abs(a.contribution)).slice(0, 3)
  const maxAbs = Math.max(0.0001, ...ranked.map(item => Math.abs(item.contribution)))
  return ranked.map(item => ({
    label: item.display_name ?? formatFeatureLabel(item.feature as LiteFeatureName),
    detail: `Contribution score ${item.contribution >= 0 ? '+' : ''}${item.contribution.toFixed(4)}`,
    impact: (item.contribution > 0 ? 'positive' : item.contribution < 0 ? 'negative' : 'neutral') as 'positive' | 'negative' | 'neutral',
    strength: Math.min(1, Math.abs(item.contribution) / maxAbs),
  }))
}

const featureGroups: FeatureGroup[] = ['event', 'user', 'product', 'category']
const RAW_DRAFT_KEY = 'c2p_raw_draft_v1'

export const RawFeaturesTab = ({ autoApplyPresetId, autoApplyPresetToken = 0 }: RawFeaturesTabProps) => {
  const form = useForm<RawFeaturesFormValues>({ resolver: zodResolver(rawLiteSchema), defaultValues, mode: 'onBlur' })
  const { apiClient, dispatch, isLoading, state } = useAppContext()
  const [prediction, setPrediction] = useState<CartPrediction | null>(null)
  const [previousPrediction, setPreviousPrediction] = useState<CartPrediction | null>(null)
  const [lastSubmittedValues, setLastSubmittedValues] = useState<RawFeaturesFormValues | null>(null)
  const [openGroups, setOpenGroups] = useState<Record<FeatureGroup, boolean>>({ event: true, user: true, product: true, category: false })
  const [showPresets, setShowPresets] = useState(false)
  const [lastDraftSavedAt, setLastDraftSavedAt] = useState<Date | null>(null)
  const [draftRestored, setDraftRestored] = useState(false)

  const onSubmit = useCallback(async (values: RawFeaturesFormValues) => {
    dispatch({ type: 'clearError' })
    dispatch({ type: 'startRequest' })
    try {
      setLastSubmittedValues(values)
      toast.info('Running minimal-input prediction...')
      const response = await apiClient.predictRawLite(
        values as CartInputRawLite,
        state.selectedModel,
        state.selectedThreshold
      )
      if (prediction) {
        setPreviousPrediction(prediction)
      }
      setPrediction(response)
      toast.success('Prediction completed with auto-preprocessed features.')
    } catch (error) {
      const message = error instanceof ApiClientError ? error.message : 'Failed to predict with minimal feature input.'
      dispatch({ type: 'setError', payload: message })
      toast.error(message)
      setPrediction(null)
    } finally {
      dispatch({ type: 'finishRequest' })
    }
  }, [apiClient, dispatch, prediction, state.selectedModel, state.selectedThreshold])

  const applyPreset = useCallback((preset: PresetScenario) => {
    form.reset({ ...defaultValues, ...preset.values })
    setPrediction(null)
    setLastSubmittedValues(null)
    toast.info(`Preset loaded: ${preset.title}`)
  }, [form])

  useEffect(() => {
    if (typeof window === 'undefined') return
    const rawDraft = window.localStorage.getItem(RAW_DRAFT_KEY)
    if (!rawDraft) return

    try {
      const parsed = JSON.parse(rawDraft) as Partial<RawFeaturesFormValues>
      const allowedKeys = Object.keys(defaultValues) as LiteFeatureName[]
      const sanitized = Object.fromEntries(
        Object.entries(parsed).filter(([key]) => allowedKeys.includes(key as LiteFeatureName))
      ) as Partial<RawFeaturesFormValues>
      form.reset({ ...defaultValues, ...sanitized })
      setDraftRestored(true)
      toast.info('Restored your last Raw Features draft.')
    } catch {
      window.localStorage.removeItem(RAW_DRAFT_KEY)
    }
  }, [form])

  useEffect(() => {
    if (typeof window === 'undefined') return
    const subscription = form.watch((value) => {
      window.localStorage.setItem(RAW_DRAFT_KEY, JSON.stringify(value))
      setLastDraftSavedAt(new Date())
    })

    return () => subscription.unsubscribe()
  }, [form])

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter' && !isLoading) {
        form.handleSubmit(onSubmit)()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [form, isLoading, onSubmit])

  useEffect(() => {
    if (!autoApplyPresetId || autoApplyPresetToken <= 0) return
    const preset = PRESET_SCENARIOS.find(item => item.id === autoApplyPresetId)
    if (preset) applyPreset(preset)
  }, [applyPreset, autoApplyPresetId, autoApplyPresetToken])

  const confidenceSignals = useMemo(() => {
    if (prediction?.explainability?.top_signals?.length) return toConfidenceSignals(prediction.explainability.top_signals)
    if (prediction?.feature_contributions?.length) return toConfidenceSignals(prediction.feature_contributions)
    return lastSubmittedValues ? buildLiteConfidenceSignals(lastSubmittedValues) : []
  }, [lastSubmittedValues, prediction])

  const draftSavedLabel = useMemo(() => {
    if (!lastDraftSavedAt) return 'Draft autosave inactive'
    return `Draft saved at ${lastDraftSavedAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
  }, [lastDraftSavedAt])

  const clearDraft = () => {
    if (typeof window !== 'undefined') {
      window.localStorage.removeItem(RAW_DRAFT_KEY)
    }
    setDraftRestored(false)
    setLastDraftSavedAt(null)
    toast.info('Raw Features draft cleared.')
  }

  const getFeaturesForGroup = (group: FeatureGroup) => LITE_FEATURES.filter(feature => FEATURE_GROUPS[group].includes(feature.name))

  return (
    <Card>
      <CardHeader className="space-y-3 border-b border-border/60 bg-surface-2/65 pb-5">
        <div className="state-text-success flex items-center gap-2"><BrainCircuit className="h-4 w-4" /><span className="type-kicker">Minimal Input Inference</span></div>
        <CardTitle className="readable-title text-xl sm:text-[1.36rem]">Raw Features Prediction</CardTitle>
        <CardDescription className="readable-description">Enter core fields to run prediction.</CardDescription>
      </CardHeader>
      <CardContent className="pt-7 sm:pt-8">
        <Form {...form}>
          <form className="space-y-6" onSubmit={form.handleSubmit(onSubmit)}>
            <div className="rounded-xl border border-border/60 bg-muted/20 p-4">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <p className="type-heading text-sm font-semibold text-foreground">Preset scenarios</p>
                  <p className="readable-helper">{showPresets ? 'Auto-fill the minimal form with realistic sample patterns.' : 'Enable to auto-fill with preset patterns.'}</p>
                </div>
                <button type="button" onClick={() => setShowPresets(!showPresets)} className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${showPresets ? 'state-badge-success' : 'border-border/50 text-muted-foreground hover:bg-muted hover:text-foreground'}`}>
                  {showPresets ? 'Hide' : 'Show'}
                </button>
              </div>
              {showPresets && (
                <div className="mt-4 grid grid-cols-1 gap-2.5 sm:grid-cols-3">
                  {PRESET_SCENARIOS.map(preset => (
                    <button key={preset.id} type="button" onClick={() => applyPreset(preset)} className="rounded-lg border border-border/60 bg-background/60 p-3 text-left transition-colors hover:border-[hsl(var(--interactive)/0.5)] hover:bg-[hsl(var(--interactive)/0.12)]">
                      <p className="type-heading text-sm font-semibold text-foreground">{preset.title}</p>
                      <p className="type-caption mt-1">{preset.description}</p>
                    </button>
                  ))}
                </div>
              )}
            </div>
            {isLoading ? (
              <div className="rounded-xl border border-border/60 bg-muted/25 p-4">
                <div className="type-caption mb-3 flex items-center gap-2 font-medium"><Sparkles className="h-3.5 w-3.5" />Preparing minimal feature controls...</div>
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
                  {LITE_FEATURES.map(feature => (<div key={feature.name} className="space-y-2"><Skeleton className="h-4 w-24" /><Skeleton className="h-11 w-full" /></div>))}
                </div>
              </div>
            ) : (
              featureGroups.map(group => {
                const features = getFeaturesForGroup(group)
                const isOpen = openGroups[group]
                return (
                  <Collapsible key={group} open={isOpen} onOpenChange={nextOpen => setOpenGroups(prev => ({ ...prev, [group]: nextOpen }))}>
                    <CollapsibleTrigger className="type-heading w-full rounded-xl border border-border/60 bg-gradient-to-r from-muted/60 to-muted/30 px-4 py-3.5 text-sm font-semibold hover:from-muted hover:to-muted/50">
                      <span className="flex items-center gap-2 text-left"><span>{FEATURE_GROUP_LABELS[group]}</span><span className="state-badge-success rounded-full px-2 py-0.5 text-xs font-medium">{features.length} fields</span></span>
                    </CollapsibleTrigger>
                    <CollapsibleContent className="pt-3">
                      <div className="grid grid-cols-1 gap-4 rounded-xl border border-border/50 bg-card/40 p-4 md:grid-cols-2 lg:grid-cols-3">
                        {features.map(feature => (
                          <FormField key={feature.name} control={form.control} name={feature.name} render={({ field }) => (
                            <FormItem>
                              <FormLabel className="readable-label">{formatFeatureLabel(feature.name)}</FormLabel>
                              <FormControl><Input {...field} type={feature.type === 'number' ? 'number' : 'text'} step={feature.type === 'number' ? 'any' : undefined} value={field.value ?? ''} disabled={isLoading} className="h-11 border-border/70 bg-background/70 focus-visible:ring-[hsl(var(--focus-ring)/0.4)]" onChange={e => { if (feature.type === 'number') { const next = e.target.value; field.onChange(next === '' ? 0 : Number(next)); return } field.onChange(e.target.value) }} /></FormControl>
                              {feature.constraints?.min !== undefined && feature.constraints?.max !== undefined && <FormDescription className="type-caption">Range: {feature.constraints.min} - {feature.constraints.max}</FormDescription>}
                              <FormMessage />
                            </FormItem>
                          )} />
                        ))}
                      </div>
                    </CollapsibleContent>
                  </Collapsible>
                )
              })
            )}
            <div className="sticky bottom-0 z-10 -mx-4 mt-6 border-t border-border/60 bg-card/90 px-4 py-4 backdrop-blur sm:-mx-6 sm:px-6" role="region" aria-label="Raw features actions">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="space-y-1">
                  <p className="type-heading text-sm font-semibold">Ready to run prediction</p>
                  <p className="readable-helper">Shortcut: Ctrl+Enter</p>
                  <p className="type-caption" aria-live="polite">{draftSavedLabel}</p>
                  {draftRestored ? <p className="type-caption state-text-success">Draft restored from previous session.</p> : null}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Button type="button" variant="outline" onClick={clearDraft} className="h-11 border-border/70 bg-background/50">Clear Draft</Button>
                  <Button type="submit" disabled={isLoading} className="h-11 min-w-32 interactive-bg hover:bg-[hsl(var(--interactive-hover))]">{isLoading ? 'Predicting...' : 'Predict'}</Button>
                </div>
              </div>
            </div>
          </form>
        </Form>
        {!prediction && !isLoading && <div className="type-body mt-6 rounded-xl border border-dashed border-border/70 bg-muted/20 p-4 text-center text-sm">Fill the main fields above and run Predict. Remaining model features will be preprocessed automatically.</div>}
        {prediction && (
          <>
            {prediction.feature_quality && (
              <div className="mt-6 space-y-3">
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <div className="state-surface-success rounded-xl border p-3"><p className="type-caption state-text-success">Feature Quality Score</p><p className="type-metric state-text-success text-lg font-semibold">{prediction.feature_quality.score.toFixed(1)}</p></div>
                <div className="state-surface-info rounded-xl border p-3"><p className="type-caption state-text-info">Quality Grade</p><p className="type-heading state-text-info text-lg font-semibold">{prediction.feature_quality.grade}</p></div>
                <div className="state-surface-warning rounded-xl border p-3"><p className="type-caption state-text-warning">Fallback Ratio</p><p className="type-metric state-text-warning text-lg font-semibold">{(prediction.feature_quality.fallback_ratio * 100).toFixed(1)}%</p></div>
                <div className="state-surface-error rounded-xl border p-3"><p className="type-caption state-text-error">Inferred Features</p><p className="type-metric state-text-error text-lg font-semibold">{prediction.feature_quality.inferred_count}</p></div>
                </div>
              </div>
            )}
            <PredictionResultCard prediction={prediction} previousPrediction={previousPrediction} context="raw" onPredictAgain={() => setPrediction(null)} onTryPreset={() => applyPreset(PRESET_SCENARIOS[0])} confidenceSignals={confidenceSignals} />
          </>
        )}
      </CardContent>
    </Card>
  )
}

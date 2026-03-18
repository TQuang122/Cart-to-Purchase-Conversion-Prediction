import { toast } from 'sonner'
import { zodResolver } from '@hookform/resolvers/zod'
import { useCallback, useEffect, useState } from 'react'
import { useForm } from 'react-hook-form'
import { z } from 'zod'
import { DatabaseZap, Sparkles } from 'lucide-react'

import { useAppContext } from '@/contexts/AppContext'
import { ApiClientError } from '@/lib/api'
import type { CartPrediction, FeatureContribution } from '@/types/api'
import { PredictionResultCard } from '@/components/PredictionResultCard'
import type { ConfidenceSignal } from '@/components/PredictionResultCard'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'

const feastLookupSchema = z.object({
  user_id: z.string().min(1),
  product_id: z.string().min(1),
})

type FeastLookupFormValues = z.infer<typeof feastLookupSchema>

const defaultValues: FeastLookupFormValues = {
  user_id: '',
  product_id: '',
}
const FEAST_DRAFT_KEY = 'c2p_feast_draft_v1'

export const FeastLookupTab = () => {
  const form = useForm<FeastLookupFormValues>({
    resolver: zodResolver(feastLookupSchema),
    defaultValues,
    mode: 'onBlur',
  })
  const { apiClient, dispatch, isLoading, state } = useAppContext()
  const [prediction, setPrediction] = useState<CartPrediction | null>(null)
  const [previousPrediction, setPreviousPrediction] = useState<CartPrediction | null>(null)
  const [lastLookupInput, setLastLookupInput] = useState<FeastLookupFormValues | null>(null)
  const [lastDraftSavedAt, setLastDraftSavedAt] = useState<Date | null>(null)
  const [draftRestored, setDraftRestored] = useState(false)

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
      if (prediction) {
        setPreviousPrediction(prediction)
      }
      setPrediction(response)
      toast.success('Feast lookup prediction completed!')
    } catch (error) {
      const message =
        error instanceof ApiClientError
          ? error.message
          : 'Failed to predict with feast lookup input.'
      dispatch({ type: 'setError', payload: message })
      toast.error(message)
      setPrediction(null)
    } finally {
      dispatch({ type: 'finishRequest' })
    }
  }, [apiClient, dispatch, prediction, state.selectedModel, state.selectedThreshold])

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
      toast.info('Restored your last Feast draft.')
    } catch {
      window.localStorage.removeItem(FEAST_DRAFT_KEY)
    }
  }, [form])

  useEffect(() => {
    if (typeof window === 'undefined') return
    const subscription = form.watch((value) => {
      window.localStorage.setItem(FEAST_DRAFT_KEY, JSON.stringify(value))
      setLastDraftSavedAt(new Date())
    })

    return () => subscription.unsubscribe()
  }, [form])

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

  return (
    <Card>
      <CardHeader className="space-y-3 border-b border-border/60 bg-surface-2/65 pb-5">
        <div className="state-text-success flex items-center gap-2">
          <DatabaseZap className="h-4 w-4" />
          <span className="type-kicker">Feature Store Lookup</span>
        </div>
        <CardTitle className="readable-title text-xl sm:text-[1.36rem]">Feast Lookup Prediction</CardTitle>
        <CardDescription className="readable-description">
          Query online features using entity keys, then run prediction with Feast-backed data.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6 pt-7 sm:pt-8">
        <Form {...form}>
          <form className="space-y-5" onSubmit={form.handleSubmit(onSubmit)}>
            {isLoading ? (
              <div className="rounded-xl border border-border/60 bg-muted/25 p-4">
                <div className="type-caption mb-3 flex items-center gap-2 font-medium">
                  <Sparkles className="h-3.5 w-3.5" />
                  Loading Feast lookup controls...
                </div>
                <div className="space-y-4">
                  <div className="space-y-2">
                    <Skeleton className="h-4 w-20" />
                    <Skeleton className="h-11 w-full" />
                  </div>
                  <div className="space-y-2">
                    <Skeleton className="h-4 w-24" />
                    <Skeleton className="h-11 w-full" />
                  </div>
                  <Skeleton className="h-11 w-40" />
                </div>
              </div>
            ) : (
              <div className="space-y-4 rounded-xl border border-border/60 bg-card/40 p-4">
                <FormField
                  control={form.control}
                  name="user_id"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="readable-label">User ID</FormLabel>
                      <FormControl>
                        <Input
                          {...field}
                          placeholder="Enter user id"
                          disabled={isLoading}
                          className="h-11 border-border/70 bg-background/70 focus-visible:ring-[hsl(var(--focus-ring)/0.4)]"
                        />
                      </FormControl>
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
                          placeholder="Enter product id"
                          disabled={isLoading}
                          className="h-11 border-border/70 bg-background/70 focus-visible:ring-[hsl(var(--focus-ring)/0.4)]"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
            )}

            <div className="sticky bottom-0 z-10 -mx-4 border-t border-border/60 bg-card/90 px-4 py-4 backdrop-blur sm:-mx-6 sm:px-6" role="region" aria-label="Feast lookup actions">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="space-y-1">
                  <p className="type-heading text-sm font-semibold">Ready to run Feast lookup prediction</p>
                  <p className="readable-helper">Shortcut: Ctrl+Enter | Provide valid user and product IDs.</p>
                  <p className="type-caption" aria-live="polite">{draftSavedLabel}</p>
                  {draftRestored ? <p className="type-caption state-text-success">Draft restored from previous session.</p> : null}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Button type="button" variant="outline" onClick={clearDraft} className="h-11 border-border/70 bg-background/50">Clear Draft</Button>
                  <Button type="submit" disabled={isLoading} className="h-11 min-w-32 interactive-bg hover:bg-[hsl(var(--interactive-hover))]">
                    {isLoading ? 'Predicting...' : 'Predict'}
                  </Button>
                </div>
              </div>
            </div>
          </form>
        </Form>

        {state.errorMessage ? (
          <div className="type-body state-surface-error state-text-error rounded-xl border p-3 text-sm">
            {state.errorMessage}
          </div>
        ) : null}

        {!prediction && !isLoading && (
          <div className="type-body mt-2 rounded-xl border border-dashed border-border/70 bg-muted/20 p-4 text-center text-sm">
            Enter a user ID and product ID to run prediction using Feast online features.
          </div>
        )}

        {prediction ? (
          <PredictionResultCard
            prediction={prediction}
            previousPrediction={previousPrediction}
            context="feast"
            onPredictAgain={() => setPrediction(null)}
            confidenceSignals={feastConfidenceSignals}
          />
        ) : null}
      </CardContent>
    </Card>
  )
}
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

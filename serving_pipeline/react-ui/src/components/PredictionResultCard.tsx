import { useEffect, useMemo, useState } from 'react'
import { ArrowDownRight, ArrowRight, ArrowUpRight, CheckCircle2, RotateCcw, Sparkles, Wand2, XCircle } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { Magnetic } from '@/components/ui/magnetic'
import { cn } from '@/lib/utils'
import type { CartPrediction } from '@/types/api'

interface PredictionResultCardProps {
  prediction: CartPrediction
  previousPrediction?: CartPrediction | null
  context: 'raw' | 'feast'
  onPredictAgain?: () => void
  onTryPreset?: () => void
  confidenceSignals?: ConfidenceSignal[]
}

export interface ConfidenceSignal {
  label: string
  detail: string
  impact: 'positive' | 'negative' | 'neutral'
  strength: number
}

export const PredictionResultCard = ({
  prediction,
  previousPrediction = null,
  context,
  onPredictAgain,
  onTryPreset,
  confidenceSignals = [],
}: PredictionResultCardProps) => {
  const probability = prediction.probability ?? 0
  const decisionThreshold = prediction.decision_threshold ?? 0.5
  const thresholdGap = probability - decisionThreshold
  const percentage = Math.round(probability * 100)
  const thresholdPercentage = Math.min(100, Math.max(0, decisionThreshold * 100))
  const previousProbability = previousPrediction?.probability ?? null
  const previousPercentage = previousProbability !== null ? Math.round(previousProbability * 100) : null
  const probabilityDelta = previousProbability !== null ? probability - previousProbability : null

  const [animatedPercentage, setAnimatedPercentage] = useState(0)

  useEffect(() => {
    const durationMs = 800
    const start = performance.now()

    const animate = (timestamp: number) => {
      const elapsed = timestamp - start
      const progress = Math.min(elapsed / durationMs, 1)
      const eased = 1 - Math.pow(1 - progress, 3)
      setAnimatedPercentage(Math.round(percentage * eased))

      if (progress < 1) {
        requestAnimationFrame(animate)
      }
    }

    requestAnimationFrame(animate)
  }, [percentage])

  const confidence = useMemo(() => {
    const distanceFromMid = Math.abs(percentage - 50)
    if (distanceFromMid >= 35) return 'High'
    if (distanceFromMid >= 18) return 'Medium'
    return 'Low'
  }, [percentage])

  const confidenceLegend = [
    {
      label: 'High',
      range: '>= 35 pts from midpoint',
      hint: 'Strong separation from 50% midpoint.',
      tone: 'state-badge-success',
    },
    {
      label: 'Medium',
      range: '18-34 pts from midpoint',
      hint: 'Moderate certainty, validate with scenario checks.',
      tone: 'state-badge-warning',
    },
    {
      label: 'Low',
      range: '< 18 pts from midpoint',
      hint: 'Borderline signal, review feature assumptions.',
      tone: 'state-badge-error',
    },
  ] as const

  const resultTheme = useMemo(() => {
    const purchased = prediction.is_purchased === 1

    if (purchased) {
      return {
        surface:
          'state-surface-success',
        badge: 'state-badge-success',
        emphasis: 'state-text-success',
        ring: 'state-text-success',
        progress: 'state-fill-success',
        title: 'Likely Purchase',
        icon: <CheckCircle2 className="h-5 w-5" />,
      }
    }

    return {
      surface: 'state-surface-error',
      badge: 'state-badge-error',
      emphasis: 'state-text-error',
      ring: 'state-text-error',
      progress: 'state-fill-error',
      title: 'Lower Purchase Likelihood',
      icon: <XCircle className="h-5 w-5" />,
    }
  }, [prediction.is_purchased])

  const insights = useMemo(() => {
    if (prediction.explainability?.notes?.length) {
      return prediction.explainability.notes
    }

    const contextLabel = context === 'raw' ? 'manual input pattern' : 'feast online features'
    const insightLines = [`Model confidence is ${confidence.toLowerCase()} for this ${contextLabel}.`]

    if (percentage >= 75) {
      insightLines.push('Strong conversion signal detected - good candidate for immediate targeting.')
    } else if (percentage >= 45) {
      insightLines.push('Borderline intent - consider incentive or follow-up nudges before checkout.')
    } else {
      insightLines.push('Weak conversion signal - optimize messaging or pricing before next action.')
    }

    insightLines.push('Run another scenario to compare how probability shifts with different inputs.')
    return insightLines
  }, [confidence, context, percentage, prediction.explainability])

  const signalStyles = {
    positive: {
      badge: 'state-badge-success',
      bar: 'state-fill-success',
      icon: <ArrowUpRight className="h-3.5 w-3.5" />,
      label: 'Pushes up',
    },
    negative: {
      badge: 'state-badge-error',
      bar: 'state-fill-error',
      icon: <ArrowDownRight className="h-3.5 w-3.5" />,
      label: 'Pushes down',
    },
    neutral: {
      badge: 'state-badge-info',
      bar: 'state-fill-info',
      icon: <ArrowRight className="h-3.5 w-3.5" />,
      label: 'Neutral',
    },
  } as const

  const ringRadius = 48
  const ringCircumference = 2 * Math.PI * ringRadius
  const ringOffset = ringCircumference - (animatedPercentage / 100) * ringCircumference

  return (
    <div
      className={cn(
        'mt-6 overflow-hidden rounded-2xl border shadow-card transition-[border-color,background-color,box-shadow] animate-in fade-in slide-in-from-top-2 duration-300',
        resultTheme.surface
      )}
    >
      <div className="border-b border-border/55 bg-surface-2/60 px-5 py-4 sm:px-6">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <div className={cn('inline-flex h-9 w-9 items-center justify-center rounded-lg border', resultTheme.badge)}>
              {resultTheme.icon}
            </div>
            <div>
              <h3 className="type-heading text-base font-semibold sm:text-lg">Prediction Result</h3>
              <p className={cn('type-body text-sm font-medium', resultTheme.emphasis)}>{resultTheme.title}</p>
            </div>
          </div>
          <span className={cn('rounded-full border px-2.5 py-1 text-xs font-semibold tracking-wide', resultTheme.badge)}>
            {confidence} Confidence
          </span>
        </div>
      </div>

      <div className="grid gap-5 p-5 sm:grid-cols-[200px_1fr] sm:p-6">
        <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-border/60 bg-background/50 p-4">
          <div className="relative h-28 w-28">
            <svg className="h-full w-full -rotate-90" viewBox="0 0 120 120" role="img" aria-label="Probability ring">
              <circle cx="60" cy="60" r={ringRadius} className="stroke-muted/40" strokeWidth="10" fill="none" />
              <circle
                cx="60"
                cy="60"
                r={ringRadius}
                className={cn('transition-colors duration-300', resultTheme.ring)}
                strokeWidth="10"
                fill="none"
                strokeLinecap="round"
                strokeDasharray={ringCircumference}
                strokeDashoffset={ringOffset}
                style={{ transition: 'stroke-dashoffset 200ms linear' }}
              />
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center">
              <span className="font-mono text-2xl font-bold tabular-nums">{animatedPercentage}%</span>
              <span className="type-caption text-xs uppercase tracking-wide text-muted-foreground">Probability</span>
            </div>
          </div>
          <p className="type-caption">Animated confidence score</p>
        </div>

        <div className="space-y-4">
          <div className="space-y-2">
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Conversion Probability</span>
              <span className="font-mono text-sm font-semibold tabular-nums">{animatedPercentage}%</span>
            </div>
            <div className="relative h-3 w-full overflow-hidden rounded-full bg-muted/60">
              <div
                className={cn('h-full transition-[width] duration-500 ease-out', resultTheme.progress)}
                style={{ width: `${animatedPercentage}%` }}
              />
              <div
                className="pointer-events-none absolute inset-y-0 z-[1] w-px bg-foreground/75"
                style={{ left: `${thresholdPercentage}%` }}
                aria-hidden="true"
              />
            </div>
            <div className="type-caption flex items-center justify-between">
              <span>Current: {animatedPercentage}%</span>
              <span>Threshold marker: {thresholdPercentage.toFixed(1)}%</span>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-lg border border-border/55 bg-background/45 p-3">
              <p className="type-caption">Prediction</p>
              <p className={cn('mt-1 text-sm font-semibold', resultTheme.emphasis)}>
                {prediction.is_purchased === 1 ? 'Purchased' : 'Not Purchased'}
              </p>
            </div>
            <div className="rounded-lg border border-border/55 bg-background/45 p-3">
              <p className="type-caption">Raw probability</p>
              <p className="type-metric mt-1 text-sm font-semibold">{probability.toFixed(4)}</p>
            </div>
            <div className="rounded-lg border border-border/55 bg-background/45 p-3">
              <p className="type-caption">Decision threshold</p>
              <p className="type-metric mt-1 text-sm font-semibold">{decisionThreshold.toFixed(4)}</p>
            </div>
            <div className="rounded-lg border border-border/55 bg-background/45 p-3">
              <p className="type-caption">Probability - threshold</p>
              <p className={cn('type-metric mt-1 text-sm font-semibold', thresholdGap >= 0 ? 'state-text-success' : 'state-text-error')}>
                {thresholdGap >= 0 ? '+' : ''}
                {thresholdGap.toFixed(4)}
              </p>
            </div>
          </div>

          {previousPercentage !== null && probabilityDelta !== null ? (
            <div className="rounded-lg border border-border/55 bg-background/45 p-3">
              <p className="type-kicker mb-2">Compare with previous run</p>
              <div className="grid gap-2 sm:grid-cols-3">
                <div>
                  <p className="type-caption">Current</p>
                  <p className="type-metric mt-1 text-sm font-semibold text-text-primary">{percentage}%</p>
                </div>
                <div>
                  <p className="type-caption">Previous</p>
                  <p className="type-metric mt-1 text-sm font-semibold text-text-primary">{previousPercentage}%</p>
                </div>
                <div>
                  <p className="type-caption">Delta</p>
                  <p className={cn('type-metric mt-1 text-sm font-semibold', probabilityDelta >= 0 ? 'state-text-success' : 'state-text-error')}>
                    {probabilityDelta >= 0 ? '+' : ''}
                    {(probabilityDelta * 100).toFixed(1)} pts
                  </p>
                </div>
              </div>
            </div>
          ) : null}

          <Collapsible defaultOpen className="rounded-lg border border-border/55 bg-background/45 p-3">
            <CollapsibleTrigger className="type-kicker w-full border border-border/50 bg-background/35 text-left text-text-primary hover:bg-background/45">
              <span className="inline-flex items-center gap-1.5">
                <Sparkles className="h-3.5 w-3.5" />
                Mini insights
              </span>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <ul className="space-y-1.5 text-xs text-muted-foreground sm:text-sm">
                {insights.map((line) => (
                  <li key={line}>- {line}</li>
                ))}
              </ul>
            </CollapsibleContent>
          </Collapsible>

          <Collapsible className="rounded-lg border border-border/55 bg-background/45 p-3">
            <CollapsibleTrigger className="type-kicker w-full border border-border/50 bg-background/35 text-left text-text-primary hover:bg-background/45">
              <span className="inline-flex items-center gap-1.5">
                <Sparkles className="h-3.5 w-3.5" />
                Confidence explanation
              </span>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <div className="mb-3 grid gap-2 sm:grid-cols-3">
                {confidenceLegend.map((item) => (
                  <div key={item.label} className="flex h-full flex-col rounded-md border border-border/50 bg-background/35 p-2.5">
                    <div className="mb-1.5 space-y-1">
                      <span className={cn('inline-flex rounded-full border px-2 py-0.5 text-xs font-semibold', item.tone)}>{item.label}</span>
                      <p className="type-kicker break-words leading-snug">{item.range}</p>
                    </div>
                    <p className="type-caption">{item.hint}</p>
                  </div>
                ))}
              </div>

              {confidenceSignals.length > 0 ? (
                <div className="space-y-2.5">
                  {confidenceSignals.map((signal) => {
                    const style = signalStyles[signal.impact]
                    const signalStrength = Math.max(10, Math.min(100, Math.round(signal.strength * 100)))

                    return (
                      <div key={`${signal.label}-${signal.detail}`} className="rounded-md border border-border/50 bg-background/35 p-2.5">
                        <div className="mb-1.5 flex items-start justify-between gap-2">
                          <div>
                            <p className="text-xs font-semibold text-foreground sm:text-sm">{signal.label}</p>
                            <p className="type-caption sm:text-xs">{signal.detail}</p>
                          </div>
                          <span className={cn('inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-semibold', style.badge)}>
                            {style.icon}
                            {style.label}
                          </span>
                        </div>

                        <div className="h-1.5 overflow-hidden rounded-full bg-muted/60">
                          <div className={cn('h-full transition-[width] duration-500', style.bar)} style={{ width: `${signalStrength}%` }} />
                        </div>
                      </div>
                    )
                  })}
                </div>
              ) : (
                <div className="state-banner state-banner-warning mt-2" role="status">
                  <span>No confidence signals available for this prediction.</span>
                </div>
              )}
            </CollapsibleContent>
          </Collapsible>

          <div className="flex flex-wrap items-center gap-2 border-t border-border/55 pt-3">
            {onPredictAgain ? (
              <Button onClick={onPredictAgain} variant="outline" className="h-9 border-border/70 bg-background/50">
                <RotateCcw className="mr-1.5 h-4 w-4" />
                Predict Again
              </Button>
            ) : null}

            {onTryPreset ? (
              <Magnetic intensity={0.5} range={60}>
                <Button onClick={onTryPreset} className="h-9 interactive-bg hover:bg-[hsl(var(--interactive-hover))]">
                  <Wand2 className="mr-1.5 h-4 w-4" />
                  Try Preset
                </Button>
              </Magnetic>
            ) : null}
          </div>

        </div>
      </div>
    </div>
  )
}

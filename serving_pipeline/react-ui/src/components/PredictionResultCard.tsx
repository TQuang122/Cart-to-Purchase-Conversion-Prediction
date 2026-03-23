import { useEffect, useMemo, useState } from 'react'
import { Activity, ArrowDownRight, ArrowRight, ArrowUpRight, CheckCircle2, RotateCcw, Sparkles, Target, TrendingDown, TrendingUp, Wand2, XCircle } from 'lucide-react'

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

  const confidenceTone = useMemo(() => {
    if (confidence === 'High') {
      return prediction.is_purchased === 1
        ? 'state-badge-success'
        : 'state-badge-error'
    }
    if (confidence === 'Medium') return 'state-badge-warning'
    return 'state-badge-info'
  }, [confidence, prediction.is_purchased])

  const probabilityDescriptor = useMemo(() => {
    if (percentage >= 75) return 'Strong conversion momentum'
    if (percentage >= 55) return 'Positive conversion tendency'
    if (percentage >= 45) return 'Borderline intent signal'
    if (percentage >= 25) return 'Weak conversion tendency'
    return 'Very low purchase intent'
  }, [percentage])

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
  const thresholdMarkerLeft = `${Math.min(96, Math.max(4, thresholdPercentage))}%`
  const thresholdGapPoints = Math.abs(thresholdGap * 100)
  const isAboveThreshold = thresholdGap >= 0

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
        <div className="relative flex flex-col items-center justify-center gap-3 overflow-hidden rounded-xl border border-border/60 bg-background/55 p-4">
          <div className={cn('pointer-events-none absolute inset-x-6 top-4 h-20 rounded-full blur-2xl opacity-45', prediction.is_purchased === 1 ? 'bg-emerald-500/40' : 'bg-rose-500/35')} aria-hidden="true" />
          <div className="relative h-32 w-32">
            <div className="absolute inset-0 animate-pulse rounded-full border border-border/35" aria-hidden="true" />
            <svg className="h-full w-full -rotate-90" viewBox="0 0 120 120" role="img" aria-label="Probability ring">
              <defs>
                <linearGradient id="probability-gradient" x1="0%" y1="0%" x2="100%" y2="100%">
                  <stop offset="0%" stopColor={prediction.is_purchased === 1 ? '#34d399' : '#fb7185'} />
                  <stop offset="100%" stopColor={prediction.is_purchased === 1 ? '#10b981' : '#f43f5e'} />
                </linearGradient>
              </defs>
              <circle cx="60" cy="60" r={ringRadius} className="stroke-muted/30" strokeWidth="12" fill="none" />
              <circle
                cx="60"
                cy="60"
                r={ringRadius + 7}
                className="stroke-border/30"
                strokeWidth="2"
                fill="none"
              />
              <circle
                cx="60"
                cy="60"
                r={ringRadius}
                stroke="url(#probability-gradient)"
                strokeWidth="12"
                fill="none"
                strokeLinecap="round"
                strokeDasharray={ringCircumference}
                strokeDashoffset={ringOffset}
                style={{ transition: 'stroke-dashoffset 200ms linear' }}
              />
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center">
              <span className="font-mono text-[2rem] font-bold leading-none tabular-nums text-foreground">{animatedPercentage}%</span>
              <span className="type-caption mt-1 text-[11px] uppercase tracking-[0.18em] text-muted-foreground">Probability</span>
            </div>
          </div>
          <div className="flex items-center gap-1.5 rounded-full border border-border/60 bg-background/65 px-2.5 py-1">
            <span className={cn('h-2 w-2 animate-pulse rounded-full', prediction.is_purchased === 1 ? 'bg-emerald-400' : 'bg-rose-400')} />
            <span className="type-caption text-xs">Live confidence signal</span>
          </div>
          <p className={cn('inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-semibold', confidenceTone)}>{confidence} confidence</p>
          <p className="type-caption text-center text-xs text-muted-foreground">{probabilityDescriptor}</p>
        </div>

        <div className="space-y-4">
          <div className="space-y-3 rounded-xl border border-border/55 bg-background/45 p-3.5">
            <div className="flex items-center justify-between text-sm">
              <span className="inline-flex items-center gap-1.5 text-muted-foreground">
                <Activity className="h-4 w-4" />
                Conversion Probability
              </span>
              <span className={cn('rounded-full border px-2.5 py-1 font-mono text-sm font-semibold tabular-nums', resultTheme.badge)}>{animatedPercentage}%</span>
            </div>

            <div className="relative pt-6">
              <div className="relative h-4 w-full overflow-hidden rounded-full border border-border/50 bg-muted/55">
                <div
                  className={cn(
                    'relative h-full transition-[width] duration-700 ease-out',
                    prediction.is_purchased === 1
                      ? 'bg-gradient-to-r from-emerald-400 via-emerald-500 to-green-500'
                      : 'bg-gradient-to-r from-rose-400 via-rose-500 to-red-500'
                  )}
                  style={{ width: `${animatedPercentage}%` }}
                >
                  <span className="absolute inset-0 animate-pulse bg-white/10" aria-hidden="true" />
                </div>
                <span
                  className="pointer-events-none absolute top-1/2 z-[2] h-2.5 w-2.5 -translate-y-1/2 rounded-full border border-white/60 bg-white/80 shadow-[0_0_10px_rgba(255,255,255,0.55)]"
                  style={{ left: `${Math.min(98, Math.max(0, animatedPercentage))}%`, transform: 'translate(-50%, -50%)' }}
                  aria-hidden="true"
                />
                <div
                  className="pointer-events-none absolute inset-y-0 z-[1] w-px bg-foreground/75"
                  style={{ left: thresholdMarkerLeft }}
                  aria-hidden="true"
                />
              </div>
              <div
                className="pointer-events-none absolute left-0 top-0 -translate-x-1/2 rounded-md border border-border/60 bg-background/90 px-2 py-0.5 text-[11px] font-medium text-muted-foreground"
                style={{ left: thresholdMarkerLeft }}
                aria-hidden="true"
              >
                T {thresholdPercentage.toFixed(1)}%
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
              <span className="inline-flex items-center gap-1 rounded-full border border-border/60 bg-background/65 px-2 py-1 text-muted-foreground">
                Current {animatedPercentage}%
              </span>
              <span className={cn('inline-flex items-center gap-1 rounded-full border px-2 py-1', isAboveThreshold ? 'state-badge-success' : 'state-badge-error')}>
                {isAboveThreshold ? <TrendingUp className="h-3.5 w-3.5" /> : <TrendingDown className="h-3.5 w-3.5" />}
                {isAboveThreshold ? '+' : '-'}{thresholdGapPoints.toFixed(1)} pts vs threshold
              </span>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-lg border border-border/55 bg-gradient-to-br from-background/65 to-background/35 p-3 transition-colors hover:border-border/80">
              <p className="type-caption">Prediction</p>
              <p className={cn('mt-1 text-sm font-semibold', resultTheme.emphasis)}>
                {prediction.is_purchased === 1 ? 'Purchased' : 'Not Purchased'}
              </p>
            </div>
            <div className="rounded-lg border border-border/55 bg-gradient-to-br from-background/65 to-background/35 p-3 transition-colors hover:border-border/80">
              <p className="type-caption">Raw probability</p>
              <p className="type-metric mt-1 text-sm font-semibold">{probability.toFixed(4)}</p>
            </div>
            <div className="rounded-lg border border-border/55 bg-gradient-to-br from-background/65 to-background/35 p-3 transition-colors hover:border-border/80">
              <p className="type-caption">Decision threshold</p>
              <p className="type-metric mt-1 inline-flex items-center gap-1.5 text-sm font-semibold"><Target className="h-3.5 w-3.5" />{decisionThreshold.toFixed(4)}</p>
            </div>
            <div className="rounded-lg border border-border/55 bg-gradient-to-br from-background/65 to-background/35 p-3 transition-colors hover:border-border/80">
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

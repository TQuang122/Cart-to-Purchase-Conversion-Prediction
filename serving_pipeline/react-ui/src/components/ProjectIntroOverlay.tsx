import { useEffect, useMemo, useState } from 'react'
import { Sparkles, Database, FileSpreadsheet, Search, X, Rocket } from 'lucide-react'

import { Button } from '@/components/ui/button'

interface ProjectIntroOverlayProps {
  open: boolean
  onClose: () => void
  onUsePreset: () => void
}

const introFeatures = [
  {
    icon: <Database className="h-4 w-4" />,
    title: 'Raw Features',
    description: 'Run one fast prediction with manual feature input.',
  },
  {
    icon: <FileSpreadsheet className="h-4 w-4" />,
    title: 'Batch CSV',
    description: 'Upload once, score many rows in seconds.',
  },
  {
    icon: <Search className="h-4 w-4" />,
    title: 'Feast Lookup',
    description: 'Pull live features from Feast for real-time scoring.',
  },
]

const tourSteps = [
  {
    id: 'welcome',
    eyebrow: 'Welcome',
    title: 'Welcome to the C2P Dashboard',
    description:
      'Predict purchase intent faster. Test one case, score a full batch, or run live Feast-powered inference - all in one place.',
  },
  {
    id: 'modes',
    eyebrow: 'Choose your mode',
    title: 'Three ways to run predictions',
    description: 'Pick the input flow that matches your task and move from data to signal quickly.',
  },
  {
    id: 'launch',
    eyebrow: 'Quick start',
    title: 'Go from input to insight in seconds',
    description: 'Use this short flow to get your first prediction and read outcomes with confidence.',
  },
] as const

export function ProjectIntroOverlay({ open, onClose, onUsePreset }: ProjectIntroOverlayProps) {
  const [currentStep, setCurrentStep] = useState(0)

  const isLastStep = currentStep === tourSteps.length - 1

  const stepMeta = useMemo(() => tourSteps[currentStep], [currentStep])

  useEffect(() => {
    if (!open) return

    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    return () => {
      document.body.style.overflow = previousOverflow
    }
  }, [open])

  useEffect(() => {
    if (!open) return

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [open, onClose])

  if (!open) return null

  return (
    <div
      className="overlay-scrim-strong fixed inset-0 z-[60] flex items-center justify-center px-4 py-6"
      onClick={onClose}
      style={{ touchAction: 'manipulation' }}
    >
      <div
        className="relative w-full max-w-4xl overflow-hidden rounded-2xl border border-border/70 bg-card/95 shadow-2xl shadow-black/50"
        onClick={(event) => event.stopPropagation()}
      >
        <button
          type="button"
          onClick={onClose}
          className="absolute right-3 top-3 inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg border border-border/60 bg-background/70 p-1.5 text-muted-foreground transition-colors hover:bg-muted/40 hover:text-foreground"
          aria-label="Close introduction"
        >
          <X className="h-4 w-4" />
        </button>

        <div className="decor-gradient-hero border-b border-border/60 px-6 py-6 sm:px-8 sm:py-7">
          <div className="state-badge-success mb-3 inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-wide">
            <Sparkles className="h-3.5 w-3.5" />
            {stepMeta.eyebrow}
          </div>
          <h2 className="readable-title text-2xl font-extrabold text-foreground sm:text-3xl">
            {stepMeta.title}
          </h2>
          <p className="readable-description mt-2 text-sm sm:text-base">
            {stepMeta.description}
          </p>

          <div className="mt-4 flex items-center gap-2">
            {tourSteps.map((step, index) => (
              <button
                key={step.id}
                type="button"
                aria-label={`Go to step ${index + 1}`}
                onClick={() => setCurrentStep(index)}
              className={`h-2 rounded-full transition-[width,background-color] ${
                  index === currentStep ? 'w-7 state-fill-success' : 'w-2 bg-muted-foreground/35 hover:bg-muted-foreground/60'
                }`}
              />
            ))}
            <span className="ml-1 text-xs text-muted-foreground">
              Step {currentStep + 1}/{tourSteps.length}
            </span>
          </div>
        </div>

        <div className="space-y-6 px-6 py-6 sm:px-8 sm:py-7">
          {currentStep === 0 ? (
            <div className="rounded-xl border border-border/60 bg-background/55 p-4 sm:p-5">
              <div className="state-badge-success mb-3 inline-flex h-10 w-10 items-center justify-center rounded-xl">
                <Rocket className="h-5 w-5" />
              </div>
              <p className="text-sm font-semibold text-foreground sm:text-base">Built for fast decision cycles</p>
              <p className="readable-helper mt-2 text-xs sm:text-sm">
                This dashboard helps you move from raw events to conversion predictions with production-ready inputs and
                clean outputs.
              </p>
            </div>
          ) : null}

          {currentStep === 1 ? (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              {introFeatures.map((feature) => (
                <div
                  key={feature.title}
                  className="rounded-xl border border-border/60 bg-background/60 p-3.5 shadow-sm transition-colors hover:border-[hsl(var(--interactive)/0.4)]"
                >
                  <div className="state-badge-success mb-2 inline-flex h-8 w-8 items-center justify-center rounded-lg">
                    {feature.icon}
                  </div>
                  <p className="text-sm font-semibold tracking-[0.01em] text-foreground">{feature.title}</p>
                  <p className="readable-helper mt-1 text-xs">{feature.description}</p>
                </div>
              ))}
            </div>
          ) : null}

          {currentStep === 2 ? (
            <div className="rounded-xl border border-border/60 bg-muted/25 p-4">
              <p className="text-sm font-semibold text-foreground">Quick start</p>
              <ol className="mt-2 space-y-1.5 text-xs text-muted-foreground sm:text-sm">
                <li>1. Pick a mode: Raw, Batch CSV, or Feast Lookup.</li>
                <li>2. Enter inputs or upload your file, then hit Predict.</li>
                <li>3. Track probability and purchase outcomes instantly.</li>
              </ol>
            </div>
          ) : null}

          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-end">
            <Button
              variant="ghost"
              onClick={onClose}
              className="h-10 justify-center text-muted-foreground hover:text-foreground sm:mr-auto"
            >
              Skip intro
            </Button>
            {currentStep > 0 ? (
              <Button
                variant="outline"
                onClick={() => setCurrentStep((step) => step - 1)}
                className="h-10 border-border/80 bg-surface-2/80 text-foreground shadow-sm hover:bg-surface-2"
              >
                Back
              </Button>
            ) : null}

            {!isLastStep ? (
              <Button
                onClick={() => setCurrentStep((step) => Math.min(step + 1, tourSteps.length - 1))}
                className="interactive-bg h-10 border interactive-border shadow-md shadow-[hsl(var(--interactive)/0.3)] transition-colors hover:bg-[hsl(var(--interactive-hover))]"
              >
                Next
              </Button>
            ) : (
              <>
                <Button
                  variant="outline"
                  onClick={onClose}
                  className="h-10 border-border/80 bg-surface-2/80 text-foreground shadow-sm hover:bg-surface-2"
                >
                  Continue to Dashboard
                </Button>
                <Button
                  onClick={onUsePreset}
                  className="interactive-bg h-10 border interactive-border shadow-md shadow-[hsl(var(--interactive)/0.3)] transition-colors hover:bg-[hsl(var(--interactive-hover))]"
                >
                  Try Sample Now
                </Button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

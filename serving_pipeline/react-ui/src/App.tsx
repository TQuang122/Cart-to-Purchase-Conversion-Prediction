import { Suspense, lazy, useEffect, useState } from 'react'
import { Link, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import { CheckCircle2, ChevronRight, Database, FileSpreadsheet, Github, Loader2, PanelRightClose, PanelRightOpen, Search, ShoppingCart, Sparkles } from 'lucide-react'
import { Analytics } from '@vercel/analytics/react'

import { DashboardHeader, type StatsData } from '@/components/DashboardHeader'
import { ProjectIntroOverlay } from '@/components/ProjectIntroOverlay'
import { ChatbotWidget } from '@/components/ChatbotWidget'
import { MeshGradient } from '@/components/MeshGradient'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { MorphingText } from '@/components/ui/text-morphing'
import { FeedbackWidget } from '@/components/ui/feedback-widget'
import { Magnetic } from '@/components/ui/magnetic'
import { RainbowButton } from '@/components/ui/rainbow-button'
import { ScrollText } from '@/components/ui/scroll-text'
import { AnimatedToastProvider } from '@/components/ui/animated-toast'
import { useAppContext } from '@/contexts/AppContext'
import { formatServingModelLabel } from '@/lib/api'

type TabValue = 'raw' | 'batch' | 'feast'
const TAB_QUERY_KEY = 'tab'

const TAB_PATHS: Record<TabValue, string> = {
  raw: '/raw',
  batch: '/batch',
  feast: '/feast',
}

interface TabConfig {
  id: TabValue
  label: string
  icon: React.ReactNode
  description: string
}

const tabs: TabConfig[] = [
  { id: 'raw', label: 'Raw Features', icon: <Database className="h-5 w-5" />, description: 'Enter features manually for single prediction' },
  { id: 'batch', label: 'Batch CSV', icon: <FileSpreadsheet className="h-5 w-5" />, description: 'Upload CSV file for bulk predictions' },
  { id: 'feast', label: 'Feast Lookup', icon: <Search className="h-5 w-5" />, description: 'Query features from Feast feature store' },
]

const isTabValue = (value: string): value is TabValue => value === 'raw' || value === 'batch' || value === 'feast'

const getTabFromLocation = (pathname: string, search: string): TabValue => {
  const normalizedPath = pathname.toLowerCase()
  if (normalizedPath === '/raw') return 'raw'
  if (normalizedPath === '/batch') return 'batch'
  if (normalizedPath === '/feast') return 'feast'

  const queryTab = new URLSearchParams(search).get(TAB_QUERY_KEY)
  if (queryTab && isTabValue(queryTab)) return queryTab
  return 'raw'
}

const RawFeaturesTab = lazy(() => import('@/components/RawFeaturesTab').then((m) => ({ default: m.RawFeaturesTab })))
const BatchCsvTab = lazy(() => import('@/components/BatchCsvTab').then((m) => ({ default: m.BatchCsvTab })))
const FeastLookupTab = lazy(() => import('@/components/FeastLookupTab').then((m) => ({ default: m.FeastLookupTab })))
const DatasetStatsPage = lazy(() => import('@/pages/DatasetStatsPage').then((m) => ({ default: m.DatasetStatsPage })))

const NeuralCartMark = ({ variant = 'halo' }: { variant?: 'ink' | 'halo' }) => {
  const isHalo = variant === 'halo'
  return (
    <span aria-hidden="true" className="relative inline-flex h-[0.95em] w-[0.95em] shrink-0 items-center justify-center">
      {isHalo && <span className="pointer-events-none absolute inset-[-0.14em] rounded-[0.38em] border border-[hsl(var(--border)/0.78)] bg-[hsl(var(--surface-1)/0.92)]" />}
      <ShoppingCart className={`relative h-full w-full ${isHalo ? 'text-[hsl(var(--interactive))]' : 'text-foreground'}`} strokeWidth={2.25} absoluteStrokeWidth />
    </span>
  )
}

function App() {
  const location = useLocation()
  const navigate = useNavigate()

  const { state, dispatch } = useAppContext()
  const INTRO_SEEN_KEY = 'c2p_intro_seen_v1'
  const CALM_MODE_KEY = 'c2p_calm_mode_v1'
  const activeTab = getTabFromLocation(location.pathname, location.search)
  const [isIntroOpen, setIsIntroOpen] = useState(() => {
    if (typeof window === 'undefined') return false
    if (navigator.webdriver) return false
    const navigationEntry = window.performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined
    if (navigationEntry?.type === 'reload') return true
    return !window.localStorage.getItem(INTRO_SEEN_KEY)
  })
  const [introSessionKey, setIntroSessionKey] = useState(0)
  const [autoPresetId, setAutoPresetId] = useState<string | null>(null)
  const [autoPresetToken, setAutoPresetToken] = useState(0)
  const [calmMode] = useState(() => {
    if (typeof window === 'undefined') return false
    return window.localStorage.getItem(CALM_MODE_KEY) === 'true'
  })
  const [isDesktop, setIsDesktop] = useState(() => {
    if (typeof window === 'undefined') return true
    return window.matchMedia('(min-width: 1024px)').matches
  })
  const [isSideRailOpen, setIsSideRailOpen] = useState(() => {
    return false
  })
  const [, setStats] = useState<StatsData | null>(null)

  const handleStatsUpdate = (newStats: StatsData) => setStats(newStats)

  useEffect(() => {
    const media = window.matchMedia('(min-width: 1024px)')
    const handle = () => setIsDesktop(media.matches)
    handle()
    media.addEventListener('change', handle)
    return () => media.removeEventListener('change', handle)
  }, [])

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => { 
      if (e.key === 'Escape') {
        setIsSideRailOpen(false)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  useEffect(() => {
    const params = new URLSearchParams(location.search)
    const queryTab = params.get(TAB_QUERY_KEY)

    if (location.pathname === '/' && queryTab && isTabValue(queryTab)) {
      params.delete(TAB_QUERY_KEY)
      const nextSearch = params.toString()
      const nextPath = TAB_PATHS[queryTab]
      navigate(nextSearch ? `${nextPath}?${nextSearch}` : nextPath, { replace: true })
      return
    }

  }, [location.pathname, location.search, navigate])

  const handleTabChange = (nextTab: TabValue) => {
    if (nextTab === activeTab) return
    navigate(TAB_PATHS[nextTab], { replace: true })
  }

  const handleTabKeyDown = (e: React.KeyboardEvent<HTMLElement>, idx: number) => {
    const nextIdx = (idx + (e.key === 'ArrowDown' ? 1 : -1) + tabs.length) % tabs.length
    handleTabChange(tabs[nextIdx].id)
  }

  const handleOpenIntro = () => { setIsSideRailOpen(false); setIsIntroOpen(true); setIntroSessionKey(k => k + 1) }
  const handleCloseIntro = () => { window.localStorage.setItem(INTRO_SEEN_KEY, 'true'); setIsIntroOpen(false) }
  const handleUseStarterPreset = () => { handleCloseIntro(); setAutoPresetId('default'); setAutoPresetToken(Date.now()) }
  const handleThresholdChange = (value: number) => dispatch({ type: 'setSelectedThreshold', payload: value })

  const primaryHint: Record<TabValue, string> = {
    raw: 'Review feature quality and compare against previous single prediction.',
    batch: 'Upload a cleaned CSV and validate summary deltas before export.',
    feast: 'Confirm entity + event timestamp to avoid feature-store misses.',
  }

  const sideRailContent = (
    <div className="space-y-3">
      <Card><CardHeader className="border-b border-border/78 pb-3"><CardTitle className="text-base">Context</CardTitle></CardHeader><CardContent className="pt-4 space-y-4"><div><p className="type-kicker">Model</p><p className="type-body mt-1 font-medium">{formatServingModelLabel(state.selectedModel)}</p></div><div><p className="type-kicker">Threshold</p><p className="type-body mt-1 font-medium">{state.selectedThreshold}</p></div><div><p className="type-kicker">Hint</p><p className="type-body mt-1 text-text-secondary">{primaryHint[activeTab]}</p></div></CardContent></Card>
      <Card><CardHeader className="border-b border-border/78 pb-3"><CardTitle className="text-base">Controls</CardTitle></CardHeader><CardContent className="pt-4"><button type="button" onClick={handleOpenIntro} className="type-body w-full rounded-lg border border-border/80 bg-surface-2/80 px-3 py-2 text-left text-text-secondary hover:border-[hsl(var(--interactive)/0.48)] hover:bg-surface-2]">View intro</button></CardContent></Card>
    </div>
  )

  const workspaceElement = (
    <>
      <a href="#main-content" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-surface-1 focus:px-3 focus:py-2 focus:text-sm focus:text-text-primary focus:outline-none focus:ring-2 focus:ring-[hsl(var(--focus-ring)/0.65)]">Skip to main</a>
      <MeshGradient mode={calmMode ? 'calm' : 'dynamic'} />
      <main id="main-content" tabIndex={-1} className="relative min-h-screen">
        <div className="mx-auto w-full max-w-[1440px] px-3 pb-24 pt-4 sm:px-5 sm:pb-8 sm:pt-6 lg:px-8">
          <section className="dashboard-shell dashboard-card-scale-lg section-reveal section-delay-1 panel-accent px-3 py-3 sm:px-4">
            <div className="mb-3 flex items-center justify-between border-b border-border/70 pb-3">
              <h1 className="type-display mt-1 flex items-center gap-2 text-2xl font-extrabold text-text-primary sm:text-3xl lg:text-5xl">
                <NeuralCartMark variant="halo" />
                <span className="hero-reveal">Cart-to-Purchase</span>
                <MorphingText
                  words={['Workspace', 'Studio', 'Dashboard', 'Predictor']}
                  className="hero-gradient-text hero-reveal"
                  interval={2000}
                  animationDuration={0.45}
                />
              </h1>
              <div className="flex items-center gap-2">
                <Magnetic intensity={0.4} range={80}>
                  <RainbowButton colors={['#3b82f6', '#8b5cf6', '#ec4899', '#f59e0b']} duration={3}>
                      <Link to="/dashboard" className="relative z-10 flex items-center gap-2 text-sm font-semibold text-foreground">
                        Dashboard Explorer
                      </Link>
                  </RainbowButton>
                </Magnetic>
                <Magnetic intensity={0.12} range={46}>
                  <button type="button" onClick={() => setIsSideRailOpen(p => !p)} className="micro-interactive inline-flex items-center gap-2 rounded-lg border border-border/80 bg-surface-2/92 px-3 py-2 text-sm font-medium text-text-secondary hover:text-text-primary" aria-expanded={isSideRailOpen}>
                    {isSideRailOpen ? <PanelRightClose className="h-4 w-4" /> : <PanelRightOpen className="h-4 w-4" />}
                    <span>{isSideRailOpen ? 'Hide' : 'Open'} rail</span>
                  </button>
                </Magnetic>
              </div>
            </div>
            <DashboardHeader apiBaseUrl={state.apiBaseUrl} layout="command" onOpenIntro={handleOpenIntro} onStatsUpdate={handleStatsUpdate} selectedModel={state.selectedModel} onSelectModel={(m) => dispatch({ type: 'setSelectedModel', payload: m })} selectedThreshold={state.selectedThreshold} onThresholdChange={handleThresholdChange} />
          </section>
          <section className="mt-6 dashboard-shell dashboard-card-scale-md section-reveal section-delay-3 panel-accent p-3 sm:p-4">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="type-heading flex items-center gap-2.5 text-base font-semibold text-text-primary sm:text-lg">
                <Sparkles className="state-text-success h-[18px] w-[18px] sm:h-5 sm:w-5" />
                <ScrollText effect="fadeIn" className="inline-flex items-center">
                  <span>Prediction studio</span>
                </ScrollText>
              </h2>
              <p className="tone-chip type-kicker px-2.5 py-1">Action-first</p>
            </div>
            <div className="state-banner state-banner-ready mb-4" role="status">
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
              <div><p className="type-heading text-sm font-semibold">Workspace ready</p><p className="type-caption mt-0.5 opacity-90">Pick a method, then run prediction.</p></div>
            </div>
            <div className={`grid grid-cols-1 gap-4 ${isSideRailOpen ? 'lg:grid-cols-[252px_minmax(0,1fr)_292px]' : 'lg:grid-cols-[252px_minmax(0,1fr)]'}`}>
              <nav className="dashboard-card-scale-sm rounded-2xl border border-border/80 bg-surface-2/90 p-2" aria-label="Prediction methods">
                <div className="flex flex-col gap-2" role="tablist">
                  {tabs.map((tab) => (
                    <button key={tab.id} type="button" onClick={() => handleTabChange(tab.id)} onKeyDown={(e) => handleTabKeyDown(e, tabs.findIndex(t => t.id === tab.id))} role="tab" aria-selected={activeTab === tab.id} className={`group relative w-full overflow-hidden rounded-xl border px-3 py-3 text-left transition-all hover:-translate-y-0.5 ${activeTab === tab.id ? 'interactive-border bg-[hsl(var(--interactive)/0.12)]' : 'border-border/76 bg-surface-2/96 hover:border-[hsl(var(--interactive)/0.48)]'}`}>
                      <div className={`absolute left-0 top-0 h-full w-1 ${activeTab === tab.id ? 'bg-[hsl(var(--interactive-hover))]' : 'opacity-0 group-hover:opacity-60'}`} />
                      <div className="flex items-start gap-3">
                        <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border ${activeTab === tab.id ? 'border-[hsl(var(--interactive)/0.45)] bg-[hsl(var(--interactive)/0.25)] text-[hsl(var(--success-contrast))]' : 'border-border/78 bg-surface-2 text-text-secondary group-hover:border-[hsl(var(--interactive)/0.42)]'}`}>{tab.icon}</div>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center justify-between"><span className="type-heading text-sm font-semibold text-text-primary">{tab.label}</span><ChevronRight className={`h-3.5 w-3.5 ${activeTab === tab.id ? 'translate-x-0 text-[hsl(var(--interactive-hover))]' : '-translate-x-1 opacity-25 group-hover:translate-x-0'}`} /></div>
                          <p className="type-caption mt-1 line-clamp-2 text-text-secondary">{tab.description}</p>
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              </nav>
              <div>
                <div className="focus-panel-content">
                  <div role="tabpanel" className="tab-panel">
                    <Suspense fallback={<Card><CardHeader><CardTitle>Loading...</CardTitle></CardHeader><CardContent><div className="h-40 animate-pulse rounded-xl bg-surface-2/70" /></CardContent></Card>}>
                      {activeTab === 'raw' && <RawFeaturesTab autoApplyPresetId={autoPresetId} autoApplyPresetToken={autoPresetToken} />}
                      {activeTab === 'batch' && <BatchCsvTab />}
                      {activeTab === 'feast' && <FeastLookupTab />}
                    </Suspense>
                  </div>
                </div>
              </div>
              {isSideRailOpen ? (
                <>
                  {!isDesktop ? (
                    <Sheet open={isSideRailOpen} onOpenChange={setIsSideRailOpen}>
                      <SheetContent side="right" className="w-[min(92vw,360px)] border-border/80 bg-surface-1 lg:hidden">
                        <SheetHeader>
                          <SheetTitle>Context and controls</SheetTitle>
                          <SheetDescription>Quick model context and action shortcuts.</SheetDescription>
                        </SheetHeader>
                        <div className="mt-4">{sideRailContent}</div>
                      </SheetContent>
                    </Sheet>
                  ) : null}
                  {isDesktop ? <aside className="hidden space-y-3 lg:block">{sideRailContent}</aside> : null}
                </>
              ) : null}
            </div>
          </section>
          <footer className="mt-12 border-t border-border/50 py-6">
            <div className="flex flex-col items-center justify-between gap-4 sm:flex-row">
              <div className="text-center sm:text-left">
                <p className="type-kicker text-[hsl(var(--interactive-hover))]">Neural Commerce Intelligence</p>
                <p className="type-heading mt-1 text-base font-semibold text-text-primary sm:text-lg">
                  Cart-to-Purchase Prediction System
                </p>
                <p className="type-caption mt-1 text-text-secondary">
                  Real-time conversion signals for action-ready decisions.
                </p>
              </div>
              <div className="flex items-center gap-2">
                <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-400/30 bg-emerald-500/12 px-3 py-1 text-xs font-semibold text-emerald-200">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-300 shadow-[0_0_10px_rgba(52,211,153,0.9)]" />
                  Operational
                </span>
                <span className="inline-flex items-center rounded-full border border-border/70 bg-surface-2/75 px-2.5 py-1 text-xs font-semibold text-text-primary">
                  v1.1.0
                </span>
              </div>
            </div>
            <div className="mt-3 flex justify-center sm:justify-start">
              <a
                href="https://github.com/TQuang122/Cart-to-Purchase-Conversion-Prediction"
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-2 rounded-lg border border-border/70 bg-surface-2/70 px-3 py-2 text-sm text-text-secondary transition-colors hover:text-text-primary"
                aria-label="Open GitHub repository"
                title="GitHub repository"
              >
                <Github className="h-4 w-4" />
                <span>GitHub</span>
              </a>
            </div>
            <div className="mt-4">
              <FeedbackWidget label="Was this prediction helpful?" placeholder="Share your feedback about the prediction result..." />
            </div>
          </footer>
        </div>
      </main>
      <ProjectIntroOverlay key={introSessionKey} open={isIntroOpen} onClose={handleCloseIntro} onUsePreset={handleUseStarterPreset} />
      <ChatbotWidget />
    </>
  )

  return (
    <AnimatedToastProvider position="top-right" maxToasts={4}>
      <Routes>
        <Route path="/" element={workspaceElement} />
        <Route path="/raw" element={workspaceElement} />
        <Route path="/batch" element={workspaceElement} />
        <Route path="/feast" element={workspaceElement} />
        <Route path="/dashboard" element={<Suspense fallback={<div className="flex h-screen items-center justify-center bg-slate-50"><Loader2 className="h-8 w-8 animate-spin text-blue-600" /></div>}><DatasetStatsPage /></Suspense>} />
        <Route path="/dataset" element={<Navigate to="/dashboard" replace />} />
      </Routes>
      <Analytics />
    </AnimatedToastProvider>
  )
}

export default App

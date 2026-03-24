import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'

import { resolveApiRoot } from '@/lib/api'
import { toast } from '@/lib/toast'
import { ArrowDown, BookOpen, Bot, Copy, Download, ImagePlus, MessageCircle, RefreshCcw, Scissors, Send, Sparkles, Square, Trash2, X } from 'lucide-react'

type ChatRole = 'assistant' | 'user'

interface ChatMessage {
  id: string
  role: ChatRole
  text: string
  imagePreviewUrl?: string
  meta?: {
    confidence?: number | null
    safetyFlags?: string[]
    traceId?: string | null
    model?: string | null
    latencyMs?: number | null
    usedImageFallback?: boolean
    usedChartFallback?: boolean
    groundingMissing?: boolean
  }
}

interface ChartAnalyzeEventPayload {
  chart_type: string
  chart_title?: string
  question: string
  series: Array<Record<string, unknown>>
  context?: Record<string, unknown>
  user_message?: string
  suggested_questions?: string[]
}

interface SavedInsightNote {
  id: string
  text: string
  created_at: string
  trace_id?: string | null
}

interface ParsedSection {
  title: string
  content: string
}

const starterMessages: ChatMessage[] = [
  {
    id: 'm1',
    role: 'assistant',
    text: 'Hi! I am CTP Assistant. Ask me anything about this prediction dashboard.',
  },
]

const SAVED_NOTES_STORAGE_KEY = 'prediction_assistant_saved_notes'

const DEFAULT_PRESET_QUESTIONS_BY_CHART: Record<string, string[]> = {
  score_distribution: [
    'Where are the biggest concentration bands and what campaign action should we prioritize?',
    'Which score bins are risky to auto-approve and should move to manual review?',
  ],
  decision_confidence_bands: [
    'How should we tune threshold or review policy based on the near-threshold segment?',
    'What is the highest-impact action to reduce uncertain decisions this week?',
  ],
  predicted_purchase_by_decile: [
    'Which deciles should we prioritize first for conversion uplift and why?',
    'What budget split would you recommend across top vs mid deciles?',
  ],
  calibration_bins: [
    'Is the model over- or under-confident in specific bins, and what correction should we apply?',
    'Which bins are least reliable for decisions and need guardrails?',
  ],
  filtered_table_view: [
    'What is the strongest action plan for this filtered cohort?',
    'What risks should we flag before operationalizing this filtered set?',
  ],
}

const hasGroundingSignals = (text: string) => {
  const normalized = text.toLowerCase()
  if (/\bgrounding\b/.test(normalized) || /\bsources?\b/.test(normalized)) return true
  if (/\bbased on\b/.test(normalized) || /\bfrom data\b/.test(normalized)) return true
  if (/\bn=\d+\b/.test(normalized)) return true
  if (/\b\d+(?:\.\d+)?%\b/.test(normalized) && /\b(bin|decile|band|row|count|rate|threshold)\b/.test(normalized)) return true
  return false
}

const parseStructuredSections = (text: string): ParsedSection[] => {
  const lines = text.split('\n')
  const sections: ParsedSection[] = []
  let current: ParsedSection | null = null
  const sectionHeaderRegex = /^\s*(insight|why|recommended action|grounding)\s*:?\s*$/i

  for (const line of lines) {
    const trimmed = line.trim()
    const headerMatch = trimmed.match(sectionHeaderRegex)

    if (headerMatch) {
      if (current && current.content.trim()) {
        sections.push({ ...current, content: current.content.trim() })
      }
      current = { title: headerMatch[1], content: '' }
      continue
    }

    if (current) {
      current.content = current.content ? `${current.content}\n${line}` : line
    }
  }

  if (current && current.content.trim()) {
    sections.push({ ...current, content: current.content.trim() })
  }

  return sections
}

function MessageMarkdown({ text, assistant }: { text: string; assistant: boolean }) {
  return (
    <div className={assistant ? 'type-body text-sm text-foreground' : 'type-body text-sm text-[hsl(var(--interactive-contrast))]'}>
      <ReactMarkdown
        components={{
        p: ({ children }) => <p className="mb-2 last:mb-0 leading-6">{children}</p>,
        ul: ({ children }) => <ul className="mb-2 list-disc space-y-1 pl-5 last:mb-0">{children}</ul>,
        ol: ({ children }) => <ol className="mb-2 list-decimal space-y-1 pl-5 last:mb-0">{children}</ol>,
        li: ({ children }) => <li className="leading-6">{children}</li>,
        h1: ({ children }) => <h4 className="mb-2 text-sm font-semibold tracking-tight">{children}</h4>,
        h2: ({ children }) => <h4 className="mb-2 text-sm font-semibold tracking-tight">{children}</h4>,
        h3: ({ children }) => <h5 className="mb-2 text-sm font-semibold tracking-tight">{children}</h5>,
        blockquote: ({ children }) => (
          <blockquote className="mb-2 border-l-2 border-border/70 pl-3 italic text-muted-foreground last:mb-0">
            {children}
          </blockquote>
        ),
        code: ({ className, children }) => {
          const hasLanguage = typeof className === 'string' && className.includes('language-')
          if (hasLanguage) {
            return (
              <pre className="mb-2 overflow-x-auto rounded-lg border border-border/60 bg-background/70 p-3 text-xs last:mb-0">
                <code className={className}>{children}</code>
              </pre>
            )
          }
          return (
            <code className="rounded bg-background/70 px-1 py-0.5 font-mono text-[12px]">
              {children}
            </code>
          )
        },
        a: ({ href, children }) => (
          <a
            href={href}
            target="_blank"
            rel="noreferrer"
            className="font-medium text-[hsl(var(--interactive-hover))] underline underline-offset-2"
          >
            {children}
          </a>
        ),
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  )
}

function AssistantStructuredMessage({ text }: { text: string }) {
  const sections = parseStructuredSections(text)

  if (sections.length < 2) {
    return <MessageMarkdown text={text} assistant={true} />
  }

  return (
    <div className="space-y-2">
      {sections.map((section) => (
        <div key={`${section.title}-${section.content.slice(0, 24)}`} className="rounded-lg border border-border/60 bg-background/40 p-2.5">
          <p className="type-kicker mb-1 text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
            {section.title}
          </p>
          <MessageMarkdown text={section.content} assistant={true} />
        </div>
      ))}
    </div>
  )
}

export function ChatbotWidget() {
  const serverBaseUrl = useMemo(() => resolveApiRoot(), [])
  const chatApiUrl = useMemo(() => `${serverBaseUrl}/chat`, [serverBaseUrl])
  const chatStreamApiUrl = useMemo(() => `${serverBaseUrl}/chat/stream`, [serverBaseUrl])
  const chatImageApiUrl = useMemo(() => `${serverBaseUrl}/chat/image`, [serverBaseUrl])
  const chatChartApiUrl = useMemo(() => `${serverBaseUrl}/chat/chart`, [serverBaseUrl])

  const [open, setOpen] = useState(false)
  const [input, setInput] = useState('')
  const [messages, setMessages] = useState<ChatMessage[]>(starterMessages)
  const [isThinking, setIsThinking] = useState(false)
  const [selectedImageFile, setSelectedImageFile] = useState<File | null>(null)
  const [selectedImagePreview, setSelectedImagePreview] = useState<string | null>(null)
  const [chartEndpointSupport, setChartEndpointSupport] = useState<'supported' | 'fallback' | 'unknown'>('unknown')
  const [chartPresetQuestions, setChartPresetQuestions] = useState<string[]>([])
  const [chartPresetBasePayload, setChartPresetBasePayload] = useState<ChartAnalyzeEventPayload | null>(null)
  const [savedNotesCount, setSavedNotesCount] = useState(0)
  const [savedNotes, setSavedNotes] = useState<SavedInsightNote[]>([])
  const [showSavedNotes, setShowSavedNotes] = useState(false)
  const [responseMode, setResponseMode] = useState<'fast' | 'deep'>('fast')
  const [typingMessageId, setTypingMessageId] = useState<string | null>(null)
  const [expandedMessageIds, setExpandedMessageIds] = useState<Record<string, boolean>>({})
  const [showJumpToLatest, setShowJumpToLatest] = useState(false)
  const listRef = useRef<HTMLDivElement | null>(null)
  const imageInputRef = useRef<HTMLInputElement | null>(null)
  const inFlightRef = useRef(false)
  const animationTimersRef = useRef<number[]>([])
  const abortControllerRef = useRef<AbortController | null>(null)

  const canSend = useMemo(() => input.trim().length > 0, [input])
  const isGenerating = isThinking || typingMessageId !== null

  const applyResponseModeInstruction = useCallback((message: string) => {
    const trimmed = message.trim()
    if (responseMode === 'fast') {
      return `${trimmed}\n\nRespond concisely in at most 120 words.`
    }
    return `${trimmed}\n\nProvide a thorough but practical response in under 280 words with short sections.`
  }, [responseMode])

  const pushAssistantReply = useCallback((
    text: string,
    meta?: {
      confidence?: number | null
      safetyFlags?: string[]
      traceId?: string | null
      model?: string | null
      latencyMs?: number | null
      usedImageFallback?: boolean
      usedChartFallback?: boolean
      groundingMissing?: boolean
    },
    options?: {
      animate?: boolean
    }
  ) => {
    const replyId = `a-${Date.now()}`
    const shouldAnimate = options?.animate === true && text.length > 40

    const reply: ChatMessage = {
      id: replyId,
      role: 'assistant',
      text: shouldAnimate ? '' : text,
      meta,
    }
    setMessages((prev) => [...prev, reply])

    if (shouldAnimate) {
      setTypingMessageId(replyId)
      let currentLength = 0
      const step = responseMode === 'fast' ? 8 : 5

      const tick = () => {
        currentLength = Math.min(currentLength + step, text.length)
        const partial = text.slice(0, currentLength)
        setMessages((prev) => prev.map((item) => (item.id === replyId ? { ...item, text: partial } : item)))

        if (currentLength < text.length) {
          const timerId = window.setTimeout(tick, 16)
          animationTimersRef.current.push(timerId)
        } else {
          setTypingMessageId((id) => (id === replyId ? null : id))
        }
      }

      const timerId = window.setTimeout(tick, 32)
      animationTimersRef.current.push(timerId)
    }

    requestAnimationFrame(() => listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: 'smooth' }))
  }, [responseMode])

  useEffect(() => {
    return () => {
      abortControllerRef.current?.abort()
      for (const timerId of animationTimersRef.current) {
        window.clearTimeout(timerId)
      }
      animationTimersRef.current = []
    }
  }, [])

  const clearSelectedImage = (revokePreview = true) => {
    if (revokePreview && selectedImagePreview) {
      URL.revokeObjectURL(selectedImagePreview)
    }
    setSelectedImagePreview(null)
    setSelectedImageFile(null)
    if (imageInputRef.current) {
      imageInputRef.current.value = ''
    }
  }

  const loadSavedNotes = useCallback((): SavedInsightNote[] => {
    if (typeof window === 'undefined') return []
    try {
      const raw = window.localStorage.getItem(SAVED_NOTES_STORAGE_KEY)
      if (!raw) return []
      const parsed = JSON.parse(raw) as SavedInsightNote[]
      if (!Array.isArray(parsed)) return []
      return parsed
    } catch {
      return []
    }
  }, [])

  const saveNotes = useCallback((notes: SavedInsightNote[]) => {
    if (typeof window === 'undefined') return
    window.localStorage.setItem(SAVED_NOTES_STORAGE_KEY, JSON.stringify(notes))
    setSavedNotesCount(notes.length)
    setSavedNotes(notes)
  }, [])

  const copyInsight = useCallback(async (text: string) => {
    try {
      await navigator.clipboard.writeText(text)
      pushAssistantReply('Insight copied to clipboard.')
    } catch {
      pushAssistantReply('Unable to copy insight. Please copy manually.')
    }
  }, [pushAssistantReply])

  const saveInsightNote = useCallback((message: ChatMessage) => {
    const current = loadSavedNotes()
    const next: SavedInsightNote[] = [
      {
        id: `note_${Date.now()}`,
        text: message.text,
        created_at: new Date().toISOString(),
        trace_id: message.meta?.traceId,
      },
      ...current,
    ].slice(0, 100)
    saveNotes(next)
    pushAssistantReply('Insight saved to notes.')
  }, [loadSavedNotes, pushAssistantReply, saveNotes])

  const deleteSavedNote = useCallback((noteId: string) => {
    const current = loadSavedNotes()
    const next = current.filter((note) => note.id !== noteId)
    saveNotes(next)
  }, [loadSavedNotes, saveNotes])

  const exportSavedNotes = useCallback(() => {
    const notes = loadSavedNotes()
    if (notes.length === 0) {
      pushAssistantReply('No saved notes to export.')
      return
    }

    const blob = new Blob([JSON.stringify(notes, null, 2)], { type: 'application/json;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `prediction_assistant_notes_${new Date().toISOString().slice(0, 10)}.json`
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    URL.revokeObjectURL(url)
  }, [loadSavedNotes, pushAssistantReply])

  const applySavedNoteToInput = useCallback((noteText: string) => {
    setInput(noteText)
  }, [])

  const clearSavedNotes = useCallback(() => {
    saveNotes([])
  }, [saveNotes])

  const handleSelectImage = (file: File) => {
    if (!file.type.startsWith('image/')) {
      pushAssistantReply('Please attach a valid image file (PNG, JPG, or WEBP).')
      return
    }
    if (selectedImagePreview) {
      URL.revokeObjectURL(selectedImagePreview)
    }
    setSelectedImageFile(file)
    setSelectedImagePreview(URL.createObjectURL(file))
  }

  const askGemini = async (question: string, imageFile: File | null) => {
    setIsThinking(true)
    try {
      const promptMessage = applyResponseModeInstruction(question)
      abortControllerRef.current?.abort()
      const requestController = new AbortController()
      abortControllerRef.current = requestController

      if (!imageFile) {
        try {
          const streamResponse = await fetch(chatStreamApiUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ message: promptMessage }),
            signal: requestController.signal,
          })

          const contentType = streamResponse.headers.get('content-type') || ''
          const isEventStream = streamResponse.ok && contentType.includes('text/event-stream')
          if (isEventStream && streamResponse.body) {
            const replyId = `a-${Date.now()}`
            let streamedText = ''
            let streamMeta: ChatMessage['meta'] = {}

            setMessages((prev) => [...prev, { id: replyId, role: 'assistant', text: '', meta: streamMeta }])
            setTypingMessageId(replyId)

            const reader = streamResponse.body.getReader()
            const decoder = new TextDecoder()
            let buffer = ''

            const applyMessageUpdate = (nextText?: string, nextMeta?: ChatMessage['meta']) => {
              setMessages((prev) => prev.map((item) => {
                if (item.id !== replyId) return item
                return {
                  ...item,
                  text: nextText ?? item.text,
                  meta: nextMeta ? { ...(item.meta ?? {}), ...nextMeta } : item.meta,
                }
              }))
            }

            const processFrame = (frame: string) => {
              const lines = frame.split('\n')
              let eventType = ''
              const dataLines: string[] = []

              for (const line of lines) {
                if (line.startsWith('event:')) {
                  eventType = line.slice(6).trim()
                } else if (line.startsWith('data:')) {
                  dataLines.push(line.slice(5).trim())
                }
              }

              const dataText = dataLines.join('\n')

              if (!eventType || !dataText) return

              if (eventType === 'meta') {
                try {
                  const parsed = JSON.parse(dataText) as {
                    confidence?: number | null
                    safety_flags?: string[]
                    trace_id?: string | null
                    model?: string | null
                    latency_ms?: number | null
                  }
                  streamMeta = {
                    confidence: parsed.confidence,
                    safetyFlags: parsed.safety_flags,
                    traceId: parsed.trace_id,
                    model: parsed.model,
                    latencyMs: parsed.latency_ms,
                  }
                  applyMessageUpdate(undefined, streamMeta)
                } catch {
                }
                return
              }

              if (eventType === 'chunk') {
                try {
                  const parsed = JSON.parse(dataText) as { text?: string }
                  if (parsed.text) {
                    streamedText = `${streamedText}${parsed.text}`
                    applyMessageUpdate(streamedText)
                    requestAnimationFrame(() => {
                      listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: 'smooth' })
                    })
                  }
                } catch {
                }
                return
              }

              if (eventType === 'error') {
                try {
                  const parsed = JSON.parse(dataText) as { detail?: string }
                  const errorText = parsed.detail || 'Stream error.'
                  streamedText = streamedText || errorText
                  applyMessageUpdate(streamedText)
                } catch {
                  const errorText = 'Stream error.'
                  streamedText = streamedText || errorText
                  applyMessageUpdate(streamedText)
                }
                setTypingMessageId((current) => (current === replyId ? null : current))
                return
              }

              if (eventType === 'done') {
                setTypingMessageId((current) => (current === replyId ? null : current))
              }
            }

            while (true) {
              const { value, done } = await reader.read()
              if (done) break
              buffer = `${buffer}${decoder.decode(value, { stream: true })}`

              while (buffer.includes('\n\n')) {
                const frameEnd = buffer.indexOf('\n\n')
                const frame = buffer.slice(0, frameEnd).trim()
                buffer = buffer.slice(frameEnd + 2)
                if (frame) {
                  processFrame(frame)
                }
              }
            }

            if (buffer.trim()) {
              processFrame(buffer.trim())
            }

            setTypingMessageId((current) => (current === replyId ? null : current))
            abortControllerRef.current = null
            return
          }
        } catch (streamError) {
          if (streamError instanceof Error && streamError.name === 'AbortError') {
            return
          }
          console.warn('Chat stream unavailable, falling back to buffered response.', streamError)
        }
      }

      let usedImageFallback = false
      let response = imageFile
        ? await fetch(chatImageApiUrl, {
            method: 'POST',
            body: (() => {
              const form = new FormData()
              form.append('message', promptMessage)
              form.append('image', imageFile)
              return form
            })(),
            signal: requestController.signal,
          })
        : await fetch(chatApiUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ message: promptMessage }),
            signal: requestController.signal,
          })

      if (imageFile && response.status === 404) {
        usedImageFallback = true
          response = await fetch(chatApiUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message: `${promptMessage}\n\n[Image attached but /chat/image is unavailable on server.]` }),
          signal: requestController.signal,
        })
      }

      if (!response.ok) {
        let detail = ''
        try {
          const errorPayload = (await response.json()) as { detail?: string }
          detail = errorPayload.detail ?? ''
        } catch {
          detail = ''
        }

        if (detail) {
          pushAssistantReply(`CTP Assistant backend error: ${detail}`)
        } else {
          pushAssistantReply('I could not reach CTP Assistant right now. Please check API server and GEMINI_API_KEY.')
        }
        return
      }

      const data = (await response.json()) as {
        reply?: string
        confidence?: number | null
        safety_flags?: string[]
        trace_id?: string | null
        model?: string | null
        latency_ms?: number | null
      }
      const replyText = data.reply?.trim() || 'I received an empty response from CTP Assistant.'
      pushAssistantReply(replyText, {
        confidence: data.confidence,
        safetyFlags: data.safety_flags,
        traceId: data.trace_id,
        model: data.model,
        latencyMs: data.latency_ms,
        usedImageFallback,
        groundingMissing: replyText.length >= 80 && !hasGroundingSignals(replyText),
      }, { animate: true })
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        return
      }
      pushAssistantReply(`Connection error. Please ensure backend is running at ${serverBaseUrl}.`)
    } finally {
      setIsThinking(false)
      setTypingMessageId(null)
      abortControllerRef.current = null
    }
  }

  const askGeminiChart = useCallback(async (payload: ChartAnalyzeEventPayload) => {
    setIsThinking(true)
    try {
      const modeInstruction = responseMode === 'fast'
        ? 'Keep the answer under 120 words.'
        : 'Keep the answer under 280 words with practical details.'
      const effectivePayload: ChartAnalyzeEventPayload = {
        ...payload,
        question: `${payload.question.trim()}\n${modeInstruction}`,
      }

      let usedChartFallback = false
      let response: Response

      if (chartEndpointSupport === 'supported' || chartEndpointSupport === 'unknown') {
        response = await fetch(chatChartApiUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(effectivePayload),
        })
      } else {
        response = new Response(null, { status: 404 })
      }

      if (response.status === 404) {
        usedChartFallback = true
        setChartEndpointSupport('fallback')
          response = await fetch(chatApiUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            message: `Analyze chart data and provide insights.\n\nChart payload:\n${JSON.stringify(effectivePayload)}`,
          }),
        })
      } else if (response.ok) {
        setChartEndpointSupport('supported')
      }

      if (!response.ok) {
        let detail = ''
        try {
          const errorPayload = (await response.json()) as { detail?: string }
          detail = errorPayload.detail ?? ''
        } catch {
          detail = ''
        }
        pushAssistantReply(detail ? `Chart analysis error: ${detail}` : 'Chart analysis is unavailable right now.')
        return
      }

      const data = (await response.json()) as {
        reply?: string
        confidence?: number | null
        safety_flags?: string[]
        trace_id?: string | null
        model?: string | null
        latency_ms?: number | null
      }
      const replyText = data.reply?.trim() || 'I received an empty chart analysis response.'
      pushAssistantReply(replyText, {
        confidence: data.confidence,
        safetyFlags: data.safety_flags,
        traceId: data.trace_id,
        model: data.model,
        latencyMs: data.latency_ms,
        usedChartFallback,
        groundingMissing: replyText.length >= 80 && !hasGroundingSignals(replyText),
      }, { animate: true })
    } catch {
      pushAssistantReply(`Connection error. Please ensure backend is running at ${serverBaseUrl}.`)
    } finally {
      setIsThinking(false)
    }
  }, [chartEndpointSupport, chatApiUrl, chatChartApiUrl, pushAssistantReply, responseMode, serverBaseUrl])

  const dispatchChartAnalysis = useCallback((payload: ChartAnalyzeEventPayload, userText?: string) => {
    if (!payload.question || inFlightRef.current) return

    inFlightRef.current = true
    setOpen(true)

    const userMessage: ChatMessage = {
      id: `u-${Date.now()}`,
      role: 'user',
      text: userText?.trim() || payload.user_message?.trim() || `Analyze chart: ${payload.chart_title || payload.chart_type}`,
    }
    setMessages((prev) => [...prev, userMessage])
    requestAnimationFrame(() => {
      listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: 'smooth' })
    })

    void askGeminiChart(payload).finally(() => {
      inFlightRef.current = false
    })
  }, [askGeminiChart])

  const runPresetQuestion = useCallback((question: string) => {
    if (!chartPresetBasePayload || inFlightRef.current) return

    const payload: ChartAnalyzeEventPayload = {
      ...chartPresetBasePayload,
      question,
      user_message: `Analyze chart: ${chartPresetBasePayload.chart_title || chartPresetBasePayload.chart_type}`,
    }
    dispatchChartAnalysis(payload, question)
  }, [chartPresetBasePayload, dispatchChartAnalysis])

  const dispatchUserPrompt = useCallback((
    text: string,
    options?: {
      imageFile?: File | null
      imagePreview?: string | null
    }
  ) => {
    const trimmed = text.trim()
    if (!trimmed || inFlightRef.current) return

    inFlightRef.current = true

    const userMessage: ChatMessage = {
      id: `u-${Date.now()}`,
      role: 'user',
      text: trimmed,
      imagePreviewUrl: options?.imagePreview ?? undefined,
    }

    setMessages((prev) => [...prev, userMessage])
    requestAnimationFrame(() => {
      listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: 'smooth' })
    })

    void askGemini(trimmed, options?.imageFile ?? null).finally(() => {
      inFlightRef.current = false
    })
  }, [askGemini])

  const findPreviousUserPrompt = useCallback((assistantMessageId: string) => {
    const index = messages.findIndex((m) => m.id === assistantMessageId)
    if (index <= 0) return null
    for (let i = index - 1; i >= 0; i -= 1) {
      if (messages[i].role === 'user') return messages[i].text
    }
    return null
  }, [messages])

  const handleRegenerate = useCallback((assistantMessageId: string) => {
    const previousPrompt = findPreviousUserPrompt(assistantMessageId)
    if (!previousPrompt) return
    dispatchUserPrompt(previousPrompt)
  }, [dispatchUserPrompt, findPreviousUserPrompt])

  const handleSimplify = useCallback((assistantText: string) => {
    const followUp = `Simplify this answer for a non-technical audience in under 120 words:\n\n${assistantText}`
    dispatchUserPrompt(followUp)
  }, [dispatchUserPrompt])

  const handleShorten = useCallback((assistantText: string) => {
    const followUp = `Shorten this answer into key bullets (max 5 bullets):\n\n${assistantText}`
    dispatchUserPrompt(followUp)
  }, [dispatchUserPrompt])

  const handleStopGenerating = useCallback(() => {
    const hadActiveGeneration = Boolean(typingMessageId || isThinking)
    const activeTypingId = typingMessageId
    abortControllerRef.current?.abort()
    abortControllerRef.current = null
    inFlightRef.current = false
    setIsThinking(false)
    setTypingMessageId(null)

    if (activeTypingId) {
      setMessages((prev) => prev.filter((message) => {
        if (message.id !== activeTypingId || message.role !== 'assistant') return true
        return message.text.trim().length > 0
      }))
    }

    if (hadActiveGeneration) {
      toast.warning('Generation stopped', 2400)
    }
  }, [isThinking, typingMessageId])

  const toggleMessageExpand = useCallback((messageId: string) => {
    setExpandedMessageIds((prev) => ({ ...prev, [messageId]: !prev[messageId] }))
  }, [])

  const handleSend = () => {
    const text = input.trim()
    if (!text || inFlightRef.current) return

    const imageFileToSend = selectedImageFile
    const imagePreviewToShow = selectedImagePreview
    setInput('')
    clearSelectedImage(false)
    dispatchUserPrompt(text, {
      imageFile: imageFileToSend,
      imagePreview: imagePreviewToShow,
    })
  }

  useEffect(() => {
    const notes = loadSavedNotes()
    setSavedNotesCount(notes.length)
    setSavedNotes(notes)

    let cancelled = false

    const probeChartEndpoint = async () => {
      try {
      const response = await fetch(chatChartApiUrl, { method: 'OPTIONS' })
        if (cancelled) return
        if (response.ok) {
          setChartEndpointSupport('supported')
        } else if (response.status === 404) {
          setChartEndpointSupport('fallback')
        } else {
          setChartEndpointSupport('unknown')
        }
      } catch {
        if (!cancelled) {
          setChartEndpointSupport('unknown')
        }
      }
    }

    void probeChartEndpoint()

    const onAnalyzeChart = (event: Event) => {
      const customEvent = event as CustomEvent<ChartAnalyzeEventPayload>
      const payload = customEvent.detail
      if (!payload || !payload.question || inFlightRef.current) return

      setChartPresetBasePayload(payload)
      setChartPresetQuestions(
        payload.suggested_questions && payload.suggested_questions.length > 0
          ? payload.suggested_questions
          : (DEFAULT_PRESET_QUESTIONS_BY_CHART[payload.chart_type] ?? [])
      )

      dispatchChartAnalysis(payload)
    }

    window.addEventListener('chatbot:analyze-chart', onAnalyzeChart as EventListener)
    return () => {
      cancelled = true
      window.removeEventListener('chatbot:analyze-chart', onAnalyzeChart as EventListener)
    }
  }, [chatChartApiUrl, dispatchChartAnalysis, loadSavedNotes])

  useEffect(() => {
    const container = listRef.current
    if (!container) return

    const onScroll = () => {
      const distanceFromBottom = container.scrollHeight - container.scrollTop - container.clientHeight
      setShowJumpToLatest(distanceFromBottom > 80)
    }

    container.addEventListener('scroll', onScroll)
    return () => {
      container.removeEventListener('scroll', onScroll)
    }
  }, [open])

  return (
    <div className="fixed bottom-4 right-4 z-50 sm:bottom-5 sm:right-5">
      {open && (
        <div className="absolute bottom-14 right-0 w-[min(340px,calc(100vw-2rem))] overflow-hidden rounded-2xl border interactive-border-soft bg-[hsl(var(--surface-1)/0.96)] shadow-2xl shadow-[hsl(var(--interactive)/0.2)] backdrop-blur sm:bottom-16">
          <div className="decor-gradient-shell flex items-center justify-between border-b border-border/60 px-4 py-3">
            <div className="flex items-center gap-2">
              <div className="state-badge-info rounded-lg p-1.5">
                <Bot className="h-4 w-4" />
              </div>
              <div>
                <p className="type-heading text-sm font-semibold text-foreground">Prediction Assistant</p>
                <p className="type-caption text-xs text-muted-foreground">
                  {chartEndpointSupport === 'fallback' ? 'Online • Basic mode' : 'Online'}
                  {savedNotesCount > 0 ? ` • Notes ${savedNotesCount}` : ''}
                </p>
              </div>
            </div>
            <button
              onClick={() => setOpen(false)}
              className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-muted/40 hover:text-foreground"
              aria-label="Close chatbot"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          {showSavedNotes ? (
            <div className="border-b border-border/60 bg-background/30 px-3 py-2">
              <div className="mb-2 flex items-center justify-between">
                <p className="type-caption text-xs font-semibold text-foreground/90">Saved Notes</p>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={exportSavedNotes}
                    className="type-caption inline-flex items-center rounded border border-border/70 px-2 py-0.5 text-[10px] text-muted-foreground hover:text-foreground"
                    disabled={savedNotes.length === 0}
                  >
                    <Download className="mr-1 h-3 w-3" /> Export
                  </button>
                  <button
                    type="button"
                    onClick={clearSavedNotes}
                    className="type-caption inline-flex items-center rounded border border-border/70 px-2 py-0.5 text-[10px] text-muted-foreground hover:text-foreground"
                    disabled={savedNotes.length === 0}
                  >
                    <Trash2 className="mr-1 h-3 w-3" /> Clear
                  </button>
                </div>
              </div>
              {savedNotes.length === 0 ? (
                <p className="type-caption text-[11px] text-muted-foreground">No saved notes yet.</p>
              ) : (
                <div className="max-h-36 space-y-1.5 overflow-y-auto pr-1">
                  {savedNotes.slice(0, 12).map((note) => (
                    <div key={note.id} className="rounded-md border border-border/60 bg-card/60 p-2">
                      <p className="type-caption mb-1 line-clamp-2 text-[11px] text-foreground/90">{note.text}</p>
                      <div className="flex items-center justify-between gap-2">
                        <span className="type-caption text-[10px] text-muted-foreground">
                          {new Date(note.created_at).toLocaleString()}
                        </span>
                        <div className="flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => applySavedNoteToInput(note.text)}
                            className="type-caption rounded border border-border/70 px-1.5 py-0.5 text-[10px] text-muted-foreground hover:text-foreground"
                          >
                            Use
                          </button>
                          <button
                            type="button"
                            onClick={() => void copyInsight(note.text)}
                            className="type-caption rounded border border-border/70 px-1.5 py-0.5 text-[10px] text-muted-foreground hover:text-foreground"
                          >
                            <Copy className="h-3 w-3" />
                          </button>
                          <button
                            type="button"
                            onClick={() => deleteSavedNote(note.id)}
                            className="type-caption rounded border border-border/70 px-1.5 py-0.5 text-[10px] text-muted-foreground hover:text-foreground"
                          >
                            <Trash2 className="h-3 w-3" />
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : null}

          <div ref={listRef} className="max-h-[55vh] space-y-3 overflow-y-auto px-4 py-3 sm:max-h-[340px]">
            {messages.map((message) => (
              <div key={message.id} className={message.role === 'user' ? 'flex justify-end' : 'flex justify-start'}>
                <div
                  className={
                    message.role === 'user'
                      ? 'max-w-[90%] rounded-2xl rounded-br-md interactive-bg px-3.5 py-2.5 text-sm shadow-sm'
                      : 'relative max-w-[90%] rounded-2xl rounded-bl-md border border-border/60 bg-card/90 px-3.5 py-2.5 text-sm text-foreground shadow-sm'
                  }
                >
                  {message.role === 'assistant' ? (
                    <>
                      <div className={message.text.length > 480 && !expandedMessageIds[message.id] ? 'max-h-48 overflow-hidden' : ''}>
                        <AssistantStructuredMessage text={message.text} />
                      </div>
                      {message.text.length > 480 ? (
                        <button
                          type="button"
                          onClick={() => toggleMessageExpand(message.id)}
                          className="type-caption mt-2 inline-flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground"
                        >
                          {expandedMessageIds[message.id] ? 'Collapse details' : 'Expand details'}
                        </button>
                      ) : null}
                      {!expandedMessageIds[message.id] && message.text.length > 480 ? (
                        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-8 rounded-b-2xl bg-gradient-to-t from-[hsl(var(--surface-1)/0.95)] to-transparent" />
                      ) : null}
                    </>
                  ) : (
                    <MessageMarkdown text={message.text} assistant={false} />
                  )}
                  {message.imagePreviewUrl ? (
                    <img
                      src={message.imagePreviewUrl}
                      alt="Uploaded preview"
                      className="mt-2 max-h-40 w-auto rounded-lg border border-border/60"
                    />
                  ) : null}
                  {message.role === 'assistant' && message.meta ? (
                    <>
                      {message.meta.usedImageFallback ? (
                        <span className="type-caption mt-2 inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold state-badge-warning">
                          Image fallback mode
                        </span>
                      ) : null}
                      {message.meta.usedChartFallback ? (
                        <span className="type-caption mt-2 inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold state-badge-warning">
                          Chart fallback mode
                        </span>
                      ) : null}
                      {message.meta.groundingMissing ? (
                        <span className="type-caption mt-2 inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold state-badge-warning">
                          Missing explicit grounding
                        </span>
                      ) : null}
                      {((message.meta.safetyFlags && message.meta.safetyFlags.length > 0) || typeof message.meta.confidence === 'number') ? (
                        <p className="type-caption mt-1 text-[11px] text-muted-foreground">
                          {message.meta.safetyFlags && message.meta.safetyFlags.length > 0
                            ? `safety: ${message.meta.safetyFlags.join(', ')}`
                            : ''}
                          {typeof message.meta.confidence === 'number'
                            ? `${message.meta.safetyFlags && message.meta.safetyFlags.length > 0 ? ' | ' : ''}confidence: ${(message.meta.confidence * 100).toFixed(1)}%`
                            : ''}
                        </p>
                      ) : null}
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        <button
                          type="button"
                          onClick={() => void copyInsight(message.text)}
                          className="type-caption inline-flex items-center gap-1 rounded-full border border-border/70 bg-background/55 px-2.5 py-1 text-[10px] text-muted-foreground transition-colors hover:bg-background/80 hover:text-foreground"
                        >
                          <Copy className="h-3 w-3" />
                          Copy insight
                        </button>
                        <button
                          type="button"
                          onClick={() => saveInsightNote(message)}
                          className="type-caption inline-flex items-center gap-1 rounded-full border border-border/70 bg-background/55 px-2.5 py-1 text-[10px] text-muted-foreground transition-colors hover:bg-background/80 hover:text-foreground"
                        >
                          <BookOpen className="h-3 w-3" />
                          Save note
                        </button>
                        <button
                          type="button"
                          onClick={() => applySavedNoteToInput(message.text)}
                          className="type-caption inline-flex items-center gap-1 rounded-full border border-border/70 bg-background/55 px-2.5 py-1 text-[10px] text-muted-foreground transition-colors hover:bg-background/80 hover:text-foreground"
                        >
                          <Send className="h-3 w-3" />
                          Use as prompt
                        </button>
                        <button
                          type="button"
                          onClick={() => handleRegenerate(message.id)}
                          className="type-caption inline-flex items-center gap-1 rounded-full border border-border/70 bg-background/55 px-2.5 py-1 text-[10px] text-muted-foreground transition-colors hover:bg-background/80 hover:text-foreground"
                        >
                          <RefreshCcw className="h-3 w-3" />
                          Regenerate
                        </button>
                        <button
                          type="button"
                          onClick={() => handleSimplify(message.text)}
                          className="type-caption inline-flex items-center gap-1 rounded-full border border-border/70 bg-background/55 px-2.5 py-1 text-[10px] text-muted-foreground transition-colors hover:bg-background/80 hover:text-foreground"
                        >
                          <Sparkles className="h-3 w-3" />
                          Simplify
                        </button>
                        <button
                          type="button"
                          onClick={() => handleShorten(message.text)}
                          className="type-caption inline-flex items-center gap-1 rounded-full border border-border/70 bg-background/55 px-2.5 py-1 text-[10px] text-muted-foreground transition-colors hover:bg-background/80 hover:text-foreground"
                        >
                          <Scissors className="h-3 w-3" />
                          Shorten
                        </button>
                      </div>
                    </>
                  ) : null}
                </div>
              </div>
            ))}
            {typingMessageId && (
              <div className="type-caption text-[10px] text-muted-foreground">Streaming response…</div>
            )}
            {isThinking && !typingMessageId && (
              <div className="flex justify-start">
                <div className="max-w-[90%] rounded-2xl rounded-bl-md border border-border/60 bg-card/90 px-3.5 py-2.5 text-sm text-foreground shadow-sm">
                  <div className="mb-1 flex items-center gap-2 text-xs text-muted-foreground">
                    <Bot className="h-3.5 w-3.5" />
                    CTP Assistant is thinking
                  </div>
                  <div className="flex items-center gap-1">
                    <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[hsl(var(--interactive-hover))]" />
                    <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[hsl(var(--interactive-hover))]" style={{ animationDelay: '120ms' }} />
                    <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[hsl(var(--interactive-hover))]" style={{ animationDelay: '240ms' }} />
                  </div>
                </div>
              </div>
            )}
          </div>

          {showJumpToLatest ? (
            <div className="pointer-events-none absolute bottom-24 right-4">
              <button
                type="button"
                onClick={() => listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: 'smooth' })}
                className="pointer-events-auto type-caption inline-flex items-center gap-1 rounded-full border border-border/70 bg-surface-1/95 px-2.5 py-1 text-[10px] text-muted-foreground shadow hover:text-foreground"
              >
                <ArrowDown className="h-3 w-3" />
                Latest
              </button>
            </div>
          ) : null}

          <div className="border-t border-border/60 p-3">
            <div className="mb-2 flex items-center justify-between gap-2">
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => setResponseMode('fast')}
                  className={`type-caption inline-flex items-center rounded-full border px-2 py-1 text-[10px] transition-colors ${responseMode === 'fast' ? 'border-[hsl(var(--interactive)/0.65)] bg-[hsl(var(--interactive)/0.16)] text-foreground' : 'border-border/70 text-muted-foreground hover:text-foreground'}`}
                >
                  Fast
                </button>
                <button
                  type="button"
                  onClick={() => setResponseMode('deep')}
                  className={`type-caption inline-flex items-center rounded-full border px-2 py-1 text-[10px] transition-colors ${responseMode === 'deep' ? 'border-[hsl(var(--interactive)/0.65)] bg-[hsl(var(--interactive)/0.16)] text-foreground' : 'border-border/70 text-muted-foreground hover:text-foreground'}`}
                >
                  Deep
                </button>
              </div>
              <button
                type="button"
                onClick={() => setShowSavedNotes((prev) => !prev)}
                className="type-caption inline-flex items-center rounded border border-border/70 px-2 py-1 text-[10px] text-muted-foreground hover:text-foreground"
              >
                <BookOpen className="mr-1 h-3.5 w-3.5" />
                {showSavedNotes ? 'Hide notes' : `Saved notes${savedNotesCount > 0 ? ` (${savedNotesCount})` : ''}`}
              </button>
            </div>

            {chartPresetQuestions.length > 0 ? (
              <div className="mb-2">
                <p className="type-caption mb-1 text-[10px] uppercase tracking-wide text-muted-foreground">Quick chart prompts</p>
                <div className="flex gap-1.5 overflow-x-auto pb-1">
                  {chartPresetQuestions.slice(0, 6).map((question) => (
                    <button
                      key={question}
                      type="button"
                      onClick={() => runPresetQuestion(question)}
                      disabled={isGenerating}
                      className="type-caption shrink-0 rounded border border-border/70 bg-background/70 px-2 py-1 text-[10px] text-muted-foreground hover:text-foreground disabled:opacity-50"
                    >
                      {question}
                    </button>
                  ))}
                </div>
              </div>
            ) : null}

            {selectedImagePreview ? (
              <div className="mb-2 flex items-center justify-between gap-2 rounded-lg border border-border/60 bg-background/65 px-2 py-1.5">
                <div className="flex items-center gap-2 overflow-hidden">
                  <img src={selectedImagePreview} alt="Selected" className="h-8 w-8 rounded object-cover" />
                  <span className="type-caption truncate text-xs text-muted-foreground">
                    {selectedImageFile?.name ?? 'Selected image'}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => clearSelectedImage()}
                  className="type-caption rounded px-1.5 py-0.5 text-xs text-muted-foreground hover:text-foreground"
                >
                  Remove
                </button>
              </div>
            ) : null}
            <div className="flex items-center gap-2">
              <input
                ref={imageInputRef}
                type="file"
                accept="image/png,image/jpeg,image/webp"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0]
                  if (!file) return
                  handleSelectImage(file)
                }}
              />
              <button
                type="button"
                onClick={() => imageInputRef.current?.click()}
                className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-border/70 bg-background/80 text-muted-foreground transition-colors hover:text-foreground"
                aria-label="Attach image"
              >
                <ImagePlus className="h-4 w-4" />
              </button>
              <input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.repeat && !e.shiftKey && !e.nativeEvent.isComposing) {
                    e.preventDefault()
                    handleSend()
                  }
                }}
                placeholder="Ask about predictions…"
                name="chatMessage"
                aria-label="Ask prediction assistant"
                autoComplete="off"
                className="h-10 flex-1 rounded-xl border border-border/70 bg-background/80 px-3 text-sm text-foreground outline-none ring-0 placeholder:text-muted-foreground focus:border-[hsl(var(--interactive)/0.6)]"
              />
              {isGenerating ? (
                <button
                  onClick={handleStopGenerating}
                  className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-[hsl(var(--error)/0.5)] bg-[hsl(var(--error)/0.12)] text-[hsl(var(--error))] transition-colors hover:bg-[hsl(var(--error)/0.2)]"
                  aria-label="Stop generating"
                  title="Stop generating"
                >
                  <Square className="h-4 w-4" />
                </button>
              ) : (
                <button
                  onClick={handleSend}
                  disabled={!canSend}
                  className="inline-flex h-10 w-10 items-center justify-center rounded-xl interactive-bg transition-colors hover:bg-[hsl(var(--interactive-hover))] disabled:cursor-not-allowed disabled:opacity-50"
                  aria-label="Send message"
                >
                  <Send className="h-4 w-4" />
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      <button
        onClick={() => setOpen((prev) => !prev)}
        className="decor-gradient-fab group inline-flex h-12 w-12 items-center justify-center rounded-full shadow-lg shadow-[hsl(var(--interactive)/0.3)] transition-transform hover:scale-105 sm:h-14 sm:w-14"
        aria-label="Open chatbot"
      >
        <MessageCircle className="h-5 w-5 sm:h-6 sm:w-6" />
      </button>
    </div>
  )
}

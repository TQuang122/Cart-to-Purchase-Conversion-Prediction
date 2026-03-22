import type {
  ApiErrorResponse,
  BatchPredictionResponse,
  CartInputFeast,
  CartInputRaw,
  CartInputRawLite,
  CartPrediction,
  ServingModel,
} from '@/types/api'

export type ExplainLevel = 'top' | 'full'

const DEFAULT_BASE_URL = 'http://127.0.0.1:8000/predict'

/**
 * Resolves the API root URL (base URL without /predict suffix).
 * Used by components that call non-standard endpoints (e.g. /dataset/*, /model/*, /chat/*).
 */
export const resolveApiRoot = (base?: string): string => {
  const url = base ?? import.meta.env.VITE_API_BASE_URL ?? 'http://127.0.0.1:8000'
  return url.replace(/\/predict\/?$/, '')
}

export class ApiClientError extends Error {
  public readonly status: number

  constructor(message: string, status: number) {
    super(message)
    this.name = 'ApiClientError'
    this.status = status
  }
}

const resolveBaseUrl = (): string => {
  const envBase = import.meta.env.VITE_API_BASE_URL
  if (!envBase) {
    return DEFAULT_BASE_URL
  }
  const normalized = envBase.replace(/\/$/, '') || DEFAULT_BASE_URL
  return normalized.endsWith('/predict') ? normalized : `${normalized}/predict`
}

const API_BASE_URL = resolveBaseUrl()

const appendPredictionQuery = (
  path: string,
  model: ServingModel,
  threshold: number,
  explainLevel: ExplainLevel = 'top'
): string => {
  const separator = path.includes('?') ? '&' : '?'
  const clampedThreshold = Math.min(1, Math.max(0, Number(threshold)))
  return `${path}${separator}model=${encodeURIComponent(model)}&threshold=${clampedThreshold.toFixed(4)}&explain_level=${explainLevel}`
}

const parseErrorMessage = async (response: Response): Promise<string> => {
  try {
    const body = (await response.json()) as ApiErrorResponse
    if (body?.detail) {
      return body.detail
    }
  } catch {
    return response.statusText || 'Unexpected API error'
  }
  return response.statusText || 'Unexpected API error'
}

const requestJson = async <T>(path: string, init: RequestInit): Promise<T> => {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init.headers ?? {}),
    },
  })

  if (!response.ok) {
    throw new ApiClientError(await parseErrorMessage(response), response.status)
  }

  return (await response.json()) as T
}

export const predictRaw = async (
  payload: CartInputRaw,
  model: ServingModel,
  threshold: number,
  explainLevel: ExplainLevel = 'top'
): Promise<CartPrediction> => {
  return requestJson<CartPrediction>(appendPredictionQuery('/raw', model, threshold, explainLevel), {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

export const predictRawLite = async (
  payload: CartInputRawLite,
  model: ServingModel,
  threshold: number,
  explainLevel: ExplainLevel = 'top'
): Promise<CartPrediction> => {
  return requestJson<CartPrediction>(appendPredictionQuery('/raw-lite', model, threshold, explainLevel), {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

export const predictBatch = async (
  payload: CartInputRaw[],
  model: ServingModel,
  threshold: number,
  explainLevel: ExplainLevel = 'top'
): Promise<BatchPredictionResponse> => {
  return requestJson<BatchPredictionResponse>(
    appendPredictionQuery('/raw/batch', model, threshold, explainLevel),
    {
    method: 'POST',
    body: JSON.stringify(payload),
    }
  )
}

export const predictBatchUpload = async (
  file: File,
  model: ServingModel,
  threshold: number,
  explainLevel: ExplainLevel = 'top'
): Promise<BatchPredictionResponse> => {
  const formData = new FormData()
  formData.append('file', file)

  const response = await fetch(
    `${API_BASE_URL}${appendPredictionQuery('/raw/batch/upload', model, threshold, explainLevel)}`,
    {
    method: 'POST',
    body: formData,
    }
  )

  if (!response.ok) {
    throw new ApiClientError(await parseErrorMessage(response), response.status)
  }

  return (await response.json()) as BatchPredictionResponse
}

export const predictFeast = async (
  payload: CartInputFeast,
  model: ServingModel,
  threshold: number,
  explainLevel: ExplainLevel = 'top'
): Promise<CartPrediction> => {
  return requestJson<CartPrediction>(appendPredictionQuery('/feast', model, threshold, explainLevel), {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

export const apiClient = {
  predictRaw,
  predictRawLite,
  predictBatch,
  predictBatchUpload,
  predictFeast,
}

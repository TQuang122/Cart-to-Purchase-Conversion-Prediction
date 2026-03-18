import {
  createContext,
  useContext,
  useMemo,
  useReducer,
  type Dispatch,
  type ReactNode,
} from 'react'

import { apiClient } from '@/lib/api'
import type { ServingModel } from '@/types/api'

interface AppState {
  apiBaseUrl: string
  selectedModel: ServingModel
  selectedThreshold: number
  activeRequests: number
  errorMessage: string | null
}

type AppAction =
  | { type: 'setApiBaseUrl'; payload: string }
  | { type: 'setSelectedModel'; payload: ServingModel }
  | { type: 'setSelectedThreshold'; payload: number }
  | { type: 'startRequest' }
  | { type: 'finishRequest' }
  | { type: 'setError'; payload: string }
  | { type: 'clearError' }

interface AppContextValue {
  state: AppState
  dispatch: Dispatch<AppAction>
  apiClient: typeof apiClient
  isLoading: boolean
}

const DEFAULT_API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL ?? 'http://127.0.0.1:8000/predict'

const initialState: AppState = {
  apiBaseUrl: DEFAULT_API_BASE_URL,
  selectedModel: 'xgboost',
  selectedThreshold: 0.55,
  activeRequests: 0,
  errorMessage: null,
}

const appReducer = (state: AppState, action: AppAction): AppState => {
  switch (action.type) {
    case 'setApiBaseUrl':
      return { ...state, apiBaseUrl: action.payload }
    case 'setSelectedModel':
      return { ...state, selectedModel: action.payload }
    case 'setSelectedThreshold':
      return {
        ...state,
        selectedThreshold: Math.min(1, Math.max(0, Number(action.payload))),
      }
    case 'startRequest':
      return { ...state, activeRequests: state.activeRequests + 1 }
    case 'finishRequest':
      return {
        ...state,
        activeRequests:
          state.activeRequests > 0 ? state.activeRequests - 1 : state.activeRequests,
      }
    case 'setError':
      return { ...state, errorMessage: action.payload }
    case 'clearError':
      return { ...state, errorMessage: null }
    default:
      return state
  }
}

const AppContext = createContext<AppContextValue | null>(null)

export const AppContextProvider = ({ children }: { children: ReactNode }) => {
  const [state, dispatch] = useReducer(appReducer, initialState)

  const value = useMemo<AppContextValue>(
    () => ({
      state,
      dispatch,
      apiClient,
      isLoading: state.activeRequests > 0,
    }),
    [state]
  )

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>
}

export const useAppContext = (): AppContextValue => {
  const context = useContext(AppContext)
  if (!context) {
    throw new Error('useAppContext must be used within AppContextProvider')
  }
  return context
}

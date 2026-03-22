export type ApiServingModel = 'xgboost' | 'lightgbm' | 'catboost'
export type ServingModel = ApiServingModel | 'tabicl'

export interface CartInputRaw {
  price: number
  activity_count: number
  event_weekday: number
  event_hour: number
  user_total_events: number
  user_total_views: number
  user_total_carts: number
  user_total_purchases: number
  user_view_to_cart_rate: number
  user_cart_to_purchase_rate: number
  user_avg_purchase_price: number
  user_unique_products: number
  user_unique_categories: number
  product_total_events: number
  product_total_views: number
  product_total_carts: number
  product_total_purchases: number
  product_view_to_cart_rate: number
  product_cart_to_purchase_rate: number
  product_unique_buyers: number
  brand_purchase_rate: number
  price_vs_user_avg: number
  price_vs_category_avg: number
  brand: string
  category_code_level1: string
  category_code_level2: string
}

export interface CartInputFeast {
  user_id: string
  product_id: string
}

export interface CartInputRawLite {
  price: number
  activity_count: number
  event_weekday: number
  event_hour: number
  user_total_views: number
  user_total_carts: number
  product_total_views: number
  product_total_carts: number
  brand_purchase_rate: number
  price_vs_user_avg: number
  price_vs_category_avg: number
  brand: string
  category_code_level1: string
  category_code_level2: string
}

export interface CartPrediction {
  is_purchased: number
  probability: number | null
  actual_label?: number | null
  decision_threshold?: number
  model_used?: ApiServingModel
  feature_contributions?: FeatureContribution[]
  feature_quality?: FeatureQuality
  explainability?: ExplainabilityPayload
}

export interface FeatureContribution {
  feature: string
  contribution: number
  display_name?: string
}

export interface FeatureQuality {
  score: number
  grade: string
  fallback_ratio: number
  inferred_count: number
  fallback_count: number
}

export interface ExplainabilityPayload {
  method: string
  baseline_score: number
  top_signals: FeatureContribution[]
  notes: string[]
}

export interface ApiErrorResponse {
  detail: string
}

export type BatchPredictionResponse = CartPrediction[]

export type FeatureType = 'number' | 'string'

export interface FeatureConstraint {
  min?: number
  max?: number
}

export interface FeatureMetadata {
  name: keyof CartInputRaw
  type: FeatureType
  constraints?: FeatureConstraint
}

export const CART_RAW_FEATURES: FeatureMetadata[] = [
  { name: 'price', type: 'number' },
  { name: 'activity_count', type: 'number' },
  { name: 'event_weekday', type: 'number', constraints: { min: 0, max: 6 } },
  { name: 'event_hour', type: 'number', constraints: { min: 0, max: 23 } },
  { name: 'user_total_events', type: 'number' },
  { name: 'user_total_views', type: 'number' },
  { name: 'user_total_carts', type: 'number' },
  { name: 'user_total_purchases', type: 'number' },
  {
    name: 'user_view_to_cart_rate',
    type: 'number',
    constraints: { min: 0, max: 1 },
  },
  {
    name: 'user_cart_to_purchase_rate',
    type: 'number',
    constraints: { min: 0, max: 1 },
  },
  { name: 'user_avg_purchase_price', type: 'number' },
  { name: 'user_unique_products', type: 'number' },
  { name: 'user_unique_categories', type: 'number' },
  { name: 'product_total_events', type: 'number' },
  { name: 'product_total_views', type: 'number' },
  { name: 'product_total_carts', type: 'number' },
  { name: 'product_total_purchases', type: 'number' },
  {
    name: 'product_view_to_cart_rate',
    type: 'number',
    constraints: { min: 0, max: 1 },
  },
  {
    name: 'product_cart_to_purchase_rate',
    type: 'number',
    constraints: { min: 0, max: 1 },
  },
  { name: 'product_unique_buyers', type: 'number' },
  {
    name: 'brand_purchase_rate',
    type: 'number',
    constraints: { min: 0, max: 1 },
  },
  { name: 'price_vs_user_avg', type: 'number' },
  { name: 'price_vs_category_avg', type: 'number' },
  { name: 'brand', type: 'string' },
  { name: 'category_code_level1', type: 'string' },
  { name: 'category_code_level2', type: 'string' },
]

// Feature groups for collapsible sections
export const FEATURE_GROUPS: Record<string, (keyof CartInputRaw)[]> = {
  event: ['price', 'activity_count', 'event_weekday', 'event_hour'],
  user: [
    'user_total_events',
    'user_total_views',
    'user_total_carts',
    'user_total_purchases',
    'user_view_to_cart_rate',
    'user_cart_to_purchase_rate',
    'user_avg_purchase_price',
    'user_unique_products',
    'user_unique_categories',
  ],
  product: [
    'product_total_events',
    'product_total_views',
    'product_total_carts',
    'product_total_purchases',
    'product_view_to_cart_rate',
    'product_cart_to_purchase_rate',
    'product_unique_buyers',
    'brand_purchase_rate',
    'price_vs_user_avg',
    'price_vs_category_avg',
  ],
  category: ['brand', 'category_code_level1', 'category_code_level2'],
}

export type FeatureGroup = keyof typeof FEATURE_GROUPS
export const FEATURE_GROUP_LABELS: Record<FeatureGroup, string> = {
  event: 'Event Info',
  user: 'User Features',
  product: 'Product Features',
  category: 'Category & Brand',
}

export interface DatasetColumnProfile {
  column: string
  dtype: string
  missing_count: number
  missing_percent: number
}

export interface DatasetProfileResponse {
  dataset_available: boolean
  dataset_source: string
  rows: number | null
  cols: number | null
  missing_percent: number | null
  duplicate_rows: number | null
  numeric_columns: number
  categorical_columns: number
  target_column: string | null
  last_updated_at: string | null
  columns: DatasetColumnProfile[]
}

export interface HistogramBin {
  label: string
  count: number
}

export interface NumericDistributionSnapshot {
  column: string
  mean: number | null
  median: number | null
  min: number | null
  max: number | null
  bins: HistogramBin[]
}

export interface CategoryCount {
  label: string
  count: number
}

export interface CategoricalDistributionSnapshot {
  column: string
  unique_count: number
  top_values: CategoryCount[]
}

export interface DriftSummaryResponse {
  status: 'available' | 'not_configured'
  message: string
  reference_label: string | null
  monitored_columns: number
  drifted_columns: number
}

export interface DatasetQualityResponse {
  dataset_available: boolean
  dataset_source: string
  duplicate_rows: number | null
  duplicate_percent: number | null
  top_missing_columns: DatasetColumnProfile[]
  numeric_distributions: NumericDistributionSnapshot[]
  categorical_distributions: CategoricalDistributionSnapshot[]
  drift_summary: DriftSummaryResponse
}

export interface BrandConversionRateItem {
  brand: string
  carts: number
  purchases: number | null
  conversion_rate: number
}

export interface DatasetConversionResponse {
  dataset_available: boolean
  dataset_source: string
  views: number | null
  carts: number | null
  purchases: number | null
  brand_conversion_rate: BrandConversionRateItem[]
}

export interface ModelOverviewResponse {
  model_key: ApiServingModel
  model_name: string
  model_alias: string
  champion_version: string | null
  champion_run_id: string | null
  champion_model_uri: string | null
  best_cv_f1: number | null
  current_threshold: number
  model_source: string | null
  last_loaded_at: string | null
  load_error: string | null
}

export interface ModelArchitectureResponse {
  model_key: ApiServingModel
  model_type: string
  model_label: string
  description: string | null
  objective: string | null
  eval_metric: string | string[] | null
  feature_count: number
  numeric_feature_count: number
  categorical_feature_count: number
  train_test_split: number | null
  encoding_strategy: string | null
  training_features: string[]
  numeric_features: string[]
  categorical_features: string[]
}

export interface HyperparameterItem {
  key: string
  value: string
  source: 'mlflow' | 'config'
}

export interface ModelHyperparametersResponse {
  model_key: ApiServingModel
  items: HyperparameterItem[]
}

export interface ModelLineageVersion {
  version: string
  aliases: string[]
  stage: string | null
  status: string | null
  run_id: string | null
  source: string | null
  created_at: string | null
}

export interface ModelLineageResponse {
  model_key: ApiServingModel
  model_name: string
  versions: ModelLineageVersion[]
}

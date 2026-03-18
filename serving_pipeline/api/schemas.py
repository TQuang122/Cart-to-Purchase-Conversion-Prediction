from typing import Any, Literal

from pydantic import BaseModel, Field


ServingModel = Literal["xgboost", "lightgbm", "catboost"]


class CartInputRaw(BaseModel):
    price: float = Field(ge=0)
    activity_count: float = Field(ge=0)
    event_weekday: int = Field(ge=0, le=6)
    event_hour: int = Field(ge=0, le=23)
    user_total_events: float = Field(ge=0)
    user_total_views: float = Field(ge=0)
    user_total_carts: float = Field(ge=0)
    user_total_purchases: float = Field(ge=0)
    user_view_to_cart_rate: float = Field(ge=0, le=1)
    user_cart_to_purchase_rate: float = Field(ge=0, le=1)
    user_avg_purchase_price: float = Field(ge=0)
    user_unique_products: float = Field(ge=0)
    user_unique_categories: float = Field(ge=0)
    product_total_events: float = Field(ge=0)
    product_total_views: float = Field(ge=0)
    product_total_carts: float = Field(ge=0)
    product_total_purchases: float = Field(ge=0)
    product_view_to_cart_rate: float = Field(ge=0, le=1)
    product_cart_to_purchase_rate: float = Field(ge=0, le=1)
    product_unique_buyers: float = Field(ge=0)
    brand_purchase_rate: float = Field(ge=0, le=1)
    price_vs_user_avg: float
    price_vs_category_avg: float
    brand: str
    category_code_level1: str
    category_code_level2: str


class CartInputRawLite(BaseModel):
    price: float = Field(ge=0)
    activity_count: float = Field(ge=0)
    event_weekday: int = Field(ge=0, le=6)
    event_hour: int = Field(ge=0, le=23)
    user_total_views: float = Field(ge=0)
    user_total_carts: float = Field(ge=0)
    product_total_views: float = Field(ge=0)
    product_total_carts: float = Field(ge=0)
    brand_purchase_rate: float = Field(ge=0, le=1)
    price_vs_user_avg: float
    price_vs_category_avg: float
    brand: str
    category_code_level1: str
    category_code_level2: str


class CartInputFeast(BaseModel):
    user_id: str
    product_id: str


class FeatureContribution(BaseModel):
    feature: str
    contribution: float
    display_name: str | None = None


class FeatureQuality(BaseModel):
    score: float
    grade: str
    fallback_ratio: float
    inferred_count: int
    fallback_count: int


class ExplainabilityPayload(BaseModel):
    method: str
    baseline_score: float
    top_signals: list[FeatureContribution]
    notes: list[str] = []


class CartPrediction(BaseModel):
    is_purchased: int
    probability: float | None
    actual_label: int | None = None
    decision_threshold: float | None = None
    model_used: ServingModel | None = None
    feature_contributions: list[FeatureContribution] | None = None
    feature_quality: FeatureQuality | None = None
    explainability: ExplainabilityPayload | None = None


class ChatMessageRequest(BaseModel):
    message: str = Field(min_length=1, max_length=4000)


class ChatMessageResponse(BaseModel):
    reply: str
    confidence: float | None = None
    safety_flags: list[str] = Field(default_factory=list)
    trace_id: str | None = None
    model: str | None = None
    latency_ms: int | None = None


class ChartAnalysisRequest(BaseModel):
    chart_type: str = Field(min_length=1, max_length=128)
    chart_title: str | None = Field(default=None, max_length=256)
    question: str = Field(min_length=1, max_length=2000)
    series: list[dict[str, Any]] = Field(default_factory=list)
    context: dict[str, Any] = Field(default_factory=dict)


class DatasetColumnProfile(BaseModel):
    column: str
    dtype: str
    missing_count: int
    missing_percent: float


class DatasetProfileResponse(BaseModel):
    dataset_available: bool
    dataset_source: str
    rows: int | None = None
    cols: int | None = None
    missing_percent: float | None = None
    duplicate_rows: int | None = None
    numeric_columns: int
    categorical_columns: int
    target_column: str | None = None
    last_updated_at: str | None = None
    columns: list[DatasetColumnProfile] = Field(default_factory=list)


class HistogramBin(BaseModel):
    label: str
    count: int


class NumericDistributionSnapshot(BaseModel):
    column: str
    mean: float | None = None
    median: float | None = None
    min: float | None = None
    max: float | None = None
    bins: list[HistogramBin] = Field(default_factory=list)


class CategoryCount(BaseModel):
    label: str
    count: int


class CategoricalDistributionSnapshot(BaseModel):
    column: str
    unique_count: int
    top_values: list[CategoryCount] = Field(default_factory=list)


class DriftSummaryResponse(BaseModel):
    status: Literal["available", "not_configured"]
    message: str
    reference_label: str | None = None
    monitored_columns: int = 0
    drifted_columns: int = 0


class DatasetQualityResponse(BaseModel):
    dataset_available: bool
    dataset_source: str
    duplicate_rows: int | None = None
    duplicate_percent: float | None = None
    top_missing_columns: list[DatasetColumnProfile] = Field(default_factory=list)
    numeric_distributions: list[NumericDistributionSnapshot] = Field(
        default_factory=list
    )
    categorical_distributions: list[CategoricalDistributionSnapshot] = Field(
        default_factory=list
    )
    drift_summary: DriftSummaryResponse


class BrandConversionRateItem(BaseModel):
    brand: str
    carts: int
    purchases: int | None = None
    conversion_rate: float


class DatasetConversionResponse(BaseModel):
    dataset_available: bool
    dataset_source: str
    views: int | None = None
    carts: int | None = None
    purchases: int | None = None
    brand_conversion_rate: list[BrandConversionRateItem] = Field(default_factory=list)


class ModelOverviewResponse(BaseModel):
    model_key: ServingModel
    model_name: str
    model_alias: str
    champion_version: str | None = None
    champion_run_id: str | None = None
    champion_model_uri: str | None = None
    best_cv_f1: float | None = None
    current_threshold: float
    model_source: str | None = None
    last_loaded_at: str | None = None
    load_error: str | None = None


class ModelArchitectureResponse(BaseModel):
    model_key: ServingModel
    model_type: str
    model_label: str
    description: str | None = None
    objective: str | None = None
    eval_metric: str | list[str] | None = None
    feature_count: int
    numeric_feature_count: int
    categorical_feature_count: int
    train_test_split: float | None = None
    encoding_strategy: str | None = None
    training_features: list[str] = Field(default_factory=list)
    numeric_features: list[str] = Field(default_factory=list)
    categorical_features: list[str] = Field(default_factory=list)


class HyperparameterItem(BaseModel):
    key: str
    value: str
    source: Literal["mlflow", "config"]


class ModelHyperparametersResponse(BaseModel):
    model_key: ServingModel
    items: list[HyperparameterItem] = Field(default_factory=list)


class ModelLineageVersion(BaseModel):
    version: str
    aliases: list[str] = Field(default_factory=list)
    stage: str | None = None
    status: str | None = None
    run_id: str | None = None
    source: str | None = None
    created_at: str | None = None


class ModelLineageResponse(BaseModel):
    model_key: ServingModel
    model_name: str
    versions: list[ModelLineageVersion] = Field(default_factory=list)

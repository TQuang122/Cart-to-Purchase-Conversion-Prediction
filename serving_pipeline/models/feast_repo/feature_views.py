from datetime import timedelta
from feast import FeatureView, Field
from feast.types import Float32, Float64, Int64, String

from entities import user, product
from data_sources import propensity_data_source

cart_context_features = FeatureView(
    name="propensity_features",
    entities=[user, product],
    ttl=timedelta(days=3650),
    schema=[
        # Original V1 features
        Field(name="category_code_level1", dtype=String),
        Field(name="category_code_level2", dtype=String),
        Field(name="brand", dtype=String),
        Field(name="event_weekday", dtype=Int64),
        Field(name="price", dtype=Float64),
        Field(name="activity_count", dtype=Int64),
        # NEW: Hour feature
        Field(name="event_hour", dtype=Int64),
        # NEW: User aggregate features
        Field(name="user_total_events", dtype=Int64),
        Field(name="user_total_views", dtype=Int64),
        Field(name="user_total_carts", dtype=Int64),
        Field(name="user_total_purchases", dtype=Int64),
        Field(name="user_view_to_cart_rate", dtype=Float64),
        Field(name="user_cart_to_purchase_rate", dtype=Float64),
        Field(name="user_avg_purchase_price", dtype=Float64),
        Field(name="user_unique_products", dtype=Int64),
        Field(name="user_unique_categories", dtype=Int64),
        # NEW: Product aggregate features
        Field(name="product_total_events", dtype=Int64),
        Field(name="product_total_views", dtype=Int64),
        Field(name="product_total_carts", dtype=Int64),
        Field(name="product_total_purchases", dtype=Int64),
        Field(name="product_view_to_cart_rate", dtype=Float64),
        Field(name="product_cart_to_purchase_rate", dtype=Float64),
        Field(name="product_unique_buyers", dtype=Int64),
        # NEW: Brand features
        Field(name="brand_purchase_rate", dtype=Float64),
        # NEW: Price comparison features
        Field(name="price_vs_user_avg", dtype=Float64),
        Field(name="price_vs_category_avg", dtype=Float64),
        # Target
        Field(name="is_purchased", dtype=Int64),
    ],
    source=propensity_data_source,
    online=True,
)

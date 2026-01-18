from datetime import timedelta
from feast import FeatureView, Field
from feast.types import Float32, Int64, String

from entities import user, product
from data_sources import propensity_data_source

cart_context_features = FeatureView(
    name="propensity_features",
    entities=[user, product],
    ttl=timedelta(days=3650),
    schema=[
        Field(name="category_code_level1", dtype=String),
        Field(name="category_code_level2", dtype=String),
        Field(name="brand", dtype=String),
        Field(name="event_weekday", dtype=Int64),
        Field(name="price", dtype=Float32),
        Field(name="activity_count", dtype=Int64),
    ],
    source=propensity_data_source,
    online=True,
)
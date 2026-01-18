"""
Feast Data Source for Purchase Propensity Model.

This module defines the data source for the propensity feature store.
"""

import os
from feast import FileSource

# Get the directory where this file is located
_CURRENT_DIR = os.path.dirname(os.path.abspath(__file__))

# Build absolute path to data file
_DATA_PATH = os.path.join(_CURRENT_DIR, "data", "processed_propensity_data.parquet")

propensity_data_source = FileSource(
    name="propensity_data_source",
    path=_DATA_PATH,
    timestamp_field="event_timestamp",
)

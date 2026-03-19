import pandas as pd
import numpy as np
from datetime import datetime, timedelta
import pyarrow as pa
import pyarrow.parquet as pq
import os


def prepare_data_for_feast(
    input_path, output_path="./data/processed_purchase_propensity_data_v1.parquet"
):
    """
    Convert processed purchase propensity data to Feast-compatible format
    """
    # Load your processed data
    df = pd.read_csv(input_path)

    # Convert event_time from CSV to datetime and rename to event_timestamp for Feast
    # The event_time column already exists from PySpark preprocessing (format: "2019-11-17 00:11:39")
    df["event_time"] = pd.to_datetime(df["event_time"])
    df["event_timestamp"] = df["event_time"]  # Feast requires this column name

    # Create created timestamp (when feature was computed)
    df["created_timestamp"] = datetime.now()

    # 3) Ensure types (Feast join keys nên ổn định)
    # Use int64 (not Int64) for compatibility with Feast online store
    df["user_id"] = (
        pd.to_numeric(df["user_id"], errors="coerce").fillna(0).astype("int64")
    )
    df["product_id"] = (
        pd.to_numeric(df["product_id"], errors="coerce").fillna(0).astype("int64")
    )

    # Basic cleanup for categoricals
    df["brand"] = df["brand"].fillna("unknown").astype(str).str.lower()
    df["category_code_level1"] = (
        df["category_code_level1"].fillna("unknown").astype(str).str.lower()
    )
    df["category_code_level2"] = (
        df["category_code_level2"].fillna("unknown").astype(str).str.lower()
    )

    # Map column names to Feast-compatible names
    column_mapping = {
        "Category Code Level 1": "category_code_level1",
        "Category Code Level 2": "category_code_level2",
        "Brand": "brand",
        "Event Weekday": "event_weekday",
        "Price": "price",
        "Activity Count": "activity_count",
        "Is Purchased": "is_purchased",
    }

    # Rename columns
    df = df.rename(columns=column_mapping)

    # Add any missing engineered features
    if "event_weekday" not in df.columns:
        df["event_weekday"] = df["event_time"].dt.weekday

    if "activity_count" not in df.columns:
        df = df.sort_values(["user_session", "event_time"])
        df["activity_count"] = df.groupby("user_session").cumcount() + 1

    # Select and order columns for Feast
    feast_columns = [
        "user_id",
        "product_id",
        "event_timestamp",  # Feast requires this name (matches data_sources.py timestamp_field)
        "created_timestamp",
        "category_code_level1",
        "category_code_level2",
        "brand",
        "event_weekday",
        "price",
        "activity_count",
        "is_purchased",
    ]

    df_feast = df[feast_columns].copy()

    # Save as Parquet (Feast recommended format)
    os.makedirs(os.path.dirname(output_path), exist_ok=True)
    df_feast.to_parquet(output_path, index=False)

    print(f"Data prepared for Feast. Shape: {df_feast.shape}")
    print(f"Saved to: {output_path}")

    return df_feast


if __name__ == "__main__":
    # Use relative path based on this file's location
    _CURRENT_DIR = os.path.dirname(os.path.abspath(__file__))
    # _DATA_PIPELINE_DIR = os.path.abspath(
    #     os.path.join(_CURRENT_DIR, "..", "..", "..", "..")
    # )

    # This file lives at: <project_root>/data_pipeline/propensity_feature_store/propensity_features/feature_repo
    # So project root is 4 levels up from feature_repo
    _PROJECT_ROOT = os.path.abspath(os.path.join(_CURRENT_DIR, "..", "..", "..", ".."))

    # In this repo, processed data is under: <project_root>/data_pipeline/data/processed/
    _DATA_PIPELINE_DIR = os.path.join(_PROJECT_ROOT, "data_pipeline")

    input_file = os.path.join(
        _DATA_PIPELINE_DIR, "data", "processed", "df_processed_pyspark_v1.csv"
    )
    output_file = os.path.join(
        _CURRENT_DIR, "data", "processed_propensity_data.parquet"
    )

    # Helpful debug output + clearer error
    print(f"Project root: {_PROJECT_ROOT}")
    print(f"Data pipeline dir: {_DATA_PIPELINE_DIR}")
    print(f"Input CSV: {input_file}")
    print(f"Output Parquet: {output_file}")

    if not os.path.exists(input_file):
        raise FileNotFoundError(
            f"Input file not found: {input_file}\n"
            f"Expected it under: <project_root>/data_pipeline/data/processed/df_processed_pyspark_v1.csv"
        )

    prepare_data_for_feast(input_file)

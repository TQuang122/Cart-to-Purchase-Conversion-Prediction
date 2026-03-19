"""
Prepare Feast Data V2 - Convert CSV to Feast-compatible Parquet

This script converts the processed CSV from feature_engineering_v2_optimized.py
to a Feast-compatible parquet format.
"""

import pandas as pd
import numpy as np
from datetime import datetime
import os


def prepare_data_for_feast_v2(
    input_path, output_path="./data/processed_purchase_propensity_data_v2.parquet"
):
    """
    Convert processed V2 feature CSV to Feast-compatible parquet format.

    Args:
        input_path: Path to the CSV file from feature_engineering_v2_optimized.py
        output_path: Path for the output parquet file
    """
    print(f"Loading CSV from: {input_path}")
    df = pd.read_csv(input_path)
    print(f"Loaded {len(df):,} rows, {len(df.columns)} columns")

    # Convert event_timestamp to datetime if it's string
    if "event_timestamp" in df.columns:
        df["event_timestamp"] = pd.to_datetime(df["event_timestamp"])

    # Update created_timestamp to current time
    df["created_timestamp"] = datetime.now()

    # Ensure entity key types are correct (int64 for Feast compatibility)
    df["user_id"] = (
        pd.to_numeric(df["user_id"], errors="coerce").fillna(0).astype("int64")
    )
    df["product_id"] = (
        pd.to_numeric(df["product_id"], errors="coerce").fillna(0).astype("int64")
    )

    # Ensure categorical columns are strings
    categorical_cols = ["brand", "category_code_level1", "category_code_level2"]
    for col in categorical_cols:
        if col in df.columns:
            df[col] = df[col].fillna("unknown").astype(str).str.lower()

    # Ensure numeric columns have correct types
    int_columns = [
        "event_weekday",
        "event_hour",
        "activity_count",
        "user_total_events",
        "user_total_views",
        "user_total_carts",
        "user_total_purchases",
        "user_unique_products",
        "user_unique_categories",
        "product_total_events",
        "product_total_views",
        "product_total_carts",
        "product_total_purchases",
        "product_unique_buyers",
        "is_purchased",
    ]

    for col in int_columns:
        if col in df.columns:
            df[col] = pd.to_numeric(df[col], errors="coerce").fillna(0).astype("int64")

    float_columns = [
        "price",
        "user_view_to_cart_rate",
        "user_cart_to_purchase_rate",
        "user_avg_purchase_price",
        "product_view_to_cart_rate",
        "product_cart_to_purchase_rate",
        "brand_purchase_rate",
        "price_vs_user_avg",
        "price_vs_category_avg",
    ]

    for col in float_columns:
        if col in df.columns:
            df[col] = (
                pd.to_numeric(df[col], errors="coerce").fillna(0.0).astype("float64")
            )

    # Select and order columns for Feast V2
    feast_columns = [
        # Entity keys
        "user_id",
        "product_id",
        # Timestamps
        "event_timestamp",
        "created_timestamp",
        # Original features
        "category_code_level1",
        "category_code_level2",
        "brand",
        "event_weekday",
        "price",
        "activity_count",
        # New: Hour feature
        "event_hour",
        # New: User aggregate features
        "user_total_events",
        "user_total_views",
        "user_total_carts",
        "user_total_purchases",
        "user_view_to_cart_rate",
        "user_cart_to_purchase_rate",
        "user_avg_purchase_price",
        "user_unique_products",
        "user_unique_categories",
        # New: Product aggregate features
        "product_total_events",
        "product_total_views",
        "product_total_carts",
        "product_total_purchases",
        "product_view_to_cart_rate",
        "product_cart_to_purchase_rate",
        "product_unique_buyers",
        # New: Brand features
        "brand_purchase_rate",
        # New: Price comparison features
        "price_vs_user_avg",
        "price_vs_category_avg",
        # Target
        "is_purchased",
    ]

    # Filter to only include columns that exist
    available_columns = [col for col in feast_columns if col in df.columns]
    df_feast = df[available_columns].copy()

    # Save as Parquet
    os.makedirs(os.path.dirname(output_path), exist_ok=True)
    df_feast.to_parquet(output_path, index=False)

    print(f"\nData prepared for Feast V2:")
    print(f"  Shape: {df_feast.shape}")
    print(f"  Columns: {len(df_feast.columns)}")
    print(f"  Saved to: {output_path}")

    # Print sample
    print("\nSample data:")
    print(df_feast.head(3))

    # Print target distribution
    print("\nTarget distribution:")
    print(df_feast["is_purchased"].value_counts())

    return df_feast


if __name__ == "__main__":
    # Get directory paths
    _CURRENT_DIR = os.path.dirname(os.path.abspath(__file__))
    _PROJECT_ROOT = os.path.abspath(os.path.join(_CURRENT_DIR, "..", "..", "..", ".."))
    _DATA_PIPELINE_DIR = os.path.join(_PROJECT_ROOT, "data_pipeline")

    # Input: CSV from feature_engineering_v2_optimized.py
    input_file = os.path.join(
        _DATA_PIPELINE_DIR, "data", "processed", "df_processed_fe_optimized_v2.csv"
    )

    # Output: Parquet for Feast
    output_file = os.path.join(
        _CURRENT_DIR, "data", "processed_purchase_propensity_data_v2.parquet"
    )

    # Debug output
    print("=" * 60)
    print("PREPARE FEAST DATA V2")
    print("=" * 60)
    print(f"Project root: {_PROJECT_ROOT}")
    print(f"Data pipeline dir: {_DATA_PIPELINE_DIR}")
    print(f"Input CSV: {input_file}")
    print(f"Output Parquet: {output_file}")
    print()

    if not os.path.exists(input_file):
        raise FileNotFoundError(
            f"Input file not found: {input_file}\n"
            f"Please run feature_engineering_v2_optimized.py first."
        )

    prepare_data_for_feast_v2(input_file, output_file)

    print("\n" + "=" * 60)
    print("COMPLETE!")
    print("=" * 60)

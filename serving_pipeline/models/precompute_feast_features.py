#!/usr/bin/env python3
"""
Precompute user and product aggregates from full training parquet.
Run once locally: python precompute_feast_features.py
Then commit the output .parquet files to the repo.
"""

import pandas as pd
import numpy as np
from pathlib import Path

SRC_PARQUET = (
    Path(__file__).parent.parent
    / "models"
    / "feast_repo"
    / "data"
    / "processed_purchase_propensity_data_v2.parquet"
)
OUT_DIR = Path(__file__).parent


def main():
    print("Loading parquet (2.9M rows)...")
    df = pd.read_parquet(SRC_PARQUET)
    print(f"Loaded {len(df):,} rows")

    # User-level aggregates
    print("Computing user aggregates...")
    user = (
        df.groupby("user_id")
        .agg(
            event_hour=('event_hour', 'first'),
            event_weekday=('event_weekday', 'first'),
            user_total_events=("user_total_events", "first"),
            user_total_views=("user_total_views", "first"),
            user_total_carts=("user_total_carts", "first"),
            user_total_purchases=("user_total_purchases", "first"),
            user_view_to_cart_rate=("user_view_to_cart_rate", "first"),
            user_cart_to_purchase_rate=("user_cart_to_purchase_rate", "first"),
            user_avg_purchase_price=("user_avg_purchase_price", "first"),
            user_unique_products=("user_unique_products", "first"),
            user_unique_categories=("user_unique_categories", "first"),
        )
        .reset_index()
    )
    print(
        f"  Users: {len(user):,} | MB: {user.memory_usage(deep=True).sum() / 1024 / 1024:.1f}"
    )
    user.to_parquet(OUT_DIR / "user_features.parquet", index=False)
    print(f"  Saved to {OUT_DIR / 'user_features.parquet'}")

    # Product-level aggregates
    print("Computing product aggregates...")
    product = (
        df.groupby("product_id")
        .agg(
            price=("price", "mean"),
            product_total_events=("product_total_events", "first"),
            product_total_views=("product_total_views", "first"),
            product_total_carts=("product_total_carts", "first"),
            product_total_purchases=("product_total_purchases", "first"),
            product_view_to_cart_rate=("product_view_to_cart_rate", "first"),
            product_cart_to_purchase_rate=("product_cart_to_purchase_rate", "first"),
            product_unique_buyers=("product_unique_buyers", "first"),
            brand_purchase_rate=("brand_purchase_rate", "first"),
            price_vs_user_avg=("price_vs_user_avg", "first"),
            price_vs_category_avg=("price_vs_category_avg", "first"),
            category_code_level1=(
                "category_code_level1",
                lambda x: x.mode().iloc[0] if len(x.mode()) > 0 else "unknown",
            ),
            category_code_level2=(
                "category_code_level2",
                lambda x: x.mode().iloc[0] if len(x.mode()) > 0 else "unknown",
            ),
            brand=(
                "brand",
                lambda x: x.mode().iloc[0] if len(x.mode()) > 0 else "unknown",
            ),
            activity_count=("activity_count", "mean"),
        )
        .reset_index()
    )
    print(
        f"  Products: {len(product):,} | MB: {product.memory_usage(deep=True).sum() / 1024 / 1024:.1f}"
    )
    product.to_parquet(OUT_DIR / "product_features.parquet", index=False)
    print(f"  Saved to {OUT_DIR / 'product_features.parquet'}")

    print("Done!")


if __name__ == "__main__":
    main()

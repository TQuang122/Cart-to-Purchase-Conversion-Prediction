#!/usr/bin/env python3
"""
Feature Engineering V2 - Optimized for Memory
Customer Purchase Propensity Prediction

Strategy: Pre-aggregate features then join (instead of window functions on full data)
This approach is more memory-efficient for large datasets.
"""

from pyspark.sql import SparkSession
from pyspark.sql import functions as F
from pyspark.sql.types import (
    StructType,
    StructField,
    StringType,
    LongType,
    DoubleType,
    TimestampType,
)
from pathlib import Path
import time


def create_spark_session():
    """Initialize Spark session with optimized settings."""
    spark = (
        SparkSession.builder.appName("Feature Engineering V2 Optimized")
        .config("spark.driver.memory", "10g")
        .config("spark.sql.shuffle.partitions", "100")
        .config("spark.sql.adaptive.enabled", "true")
        .config("spark.sql.adaptive.coalescePartitions.enabled", "true")
        .config("spark.memory.fraction", "0.8")
        .getOrCreate()
    )

    spark.sparkContext.setLogLevel("WARN")
    return spark


def main():
    print("=" * 70)
    print("FEATURE ENGINEERING V2 - OPTIMIZED")
    print("=" * 70)

    start_time = time.time()

    # Paths
    script_dir = Path(__file__).parent
    raw_data_path = script_dir / "../data/raw/2019-Nov.csv.gz"
    v1_parquet_path = (
        script_dir
        / "../propensity_feature_store/propensity_features/feature_repo/data/processed_purchase_propensity_data_v1.parquet"
    )
    # Output CSV file (not parquet folder)
    output_path = script_dir / "../data/processed/df_processed_fe_optimized_v2.csv"

    # Initialize Spark
    print("\n[1/7] Initializing Spark...")
    spark = create_spark_session()
    print(f"Spark version: {spark.version}")

    # Load raw data schema
    schema = StructType(
        [
            StructField("event_time", TimestampType(), True),
            StructField("event_type", StringType(), True),
            StructField("product_id", LongType(), True),
            StructField("category_id", LongType(), True),
            StructField("category_code", StringType(), True),
            StructField("brand", StringType(), True),
            StructField("price", DoubleType(), True),
            StructField("user_id", LongType(), True),
            StructField("user_session", StringType(), True),
        ]
    )

    # Load raw data
    print("\n[2/7] Loading raw data...")
    raw_df = spark.read.csv(str(raw_data_path), schema=schema, header=True)
    print(f"Raw data loaded")

    # ==========================================================================
    # COMPUTE USER-LEVEL AGGREGATE FEATURES (Global aggregates)
    # ==========================================================================
    print("\n[3/7] Computing USER aggregate features...")

    user_agg = raw_df.groupBy("user_id").agg(
        F.count("*").alias("user_total_events"),
        F.sum(F.when(F.col("event_type") == "view", 1).otherwise(0)).alias(
            "user_total_views"
        ),
        F.sum(F.when(F.col("event_type") == "cart", 1).otherwise(0)).alias(
            "user_total_carts"
        ),
        F.sum(F.when(F.col("event_type") == "purchase", 1).otherwise(0)).alias(
            "user_total_purchases"
        ),
        F.avg(F.when(F.col("event_type") == "purchase", F.col("price"))).alias(
            "user_avg_purchase_price"
        ),
        F.countDistinct("product_id").alias("user_unique_products"),
        F.countDistinct(
            F.lower(
                F.coalesce(
                    F.split(F.col("category_code"), "\\.").getItem(0), F.lit("unknown")
                )
            )
        ).alias("user_unique_categories"),
    )

    # Compute conversion rates
    user_agg = user_agg.withColumn(
        "user_view_to_cart_rate",
        F.when(
            F.col("user_total_views") > 0,
            F.col("user_total_carts") / F.col("user_total_views"),
        ).otherwise(0.0),
    )

    user_agg = user_agg.withColumn(
        "user_cart_to_purchase_rate",
        F.when(
            F.col("user_total_carts") > 0,
            F.col("user_total_purchases") / F.col("user_total_carts"),
        ).otherwise(0.0),
    )

    user_agg = user_agg.fillna({"user_avg_purchase_price": 0.0})

    print(f"User features computed: {user_agg.count():,} users")

    # ==========================================================================
    # COMPUTE PRODUCT-LEVEL AGGREGATE FEATURES
    # ==========================================================================
    print("\n[4/7] Computing PRODUCT aggregate features...")

    product_agg = raw_df.groupBy("product_id").agg(
        F.count("*").alias("product_total_events"),
        F.sum(F.when(F.col("event_type") == "view", 1).otherwise(0)).alias(
            "product_total_views"
        ),
        F.sum(F.when(F.col("event_type") == "cart", 1).otherwise(0)).alias(
            "product_total_carts"
        ),
        F.sum(F.when(F.col("event_type") == "purchase", 1).otherwise(0)).alias(
            "product_total_purchases"
        ),
        F.countDistinct(
            F.when(F.col("event_type") == "purchase", F.col("user_id"))
        ).alias("product_unique_buyers"),
    )

    # Compute conversion rates
    product_agg = product_agg.withColumn(
        "product_view_to_cart_rate",
        F.when(
            F.col("product_total_views") > 0,
            F.col("product_total_carts") / F.col("product_total_views"),
        ).otherwise(0.0),
    )

    product_agg = product_agg.withColumn(
        "product_cart_to_purchase_rate",
        F.when(
            F.col("product_total_carts") > 0,
            F.col("product_total_purchases") / F.col("product_total_carts"),
        ).otherwise(0.0),
    )

    print(f"Product features computed: {product_agg.count():,} products")

    # ==========================================================================
    # COMPUTE BRAND-LEVEL AGGREGATE FEATURES
    # ==========================================================================
    print("\n[5/7] Computing BRAND and CATEGORY features...")

    # Normalize brand
    raw_with_brand = raw_df.withColumn(
        "brand_clean", F.lower(F.coalesce(F.col("brand"), F.lit("unknown")))
    )

    brand_agg = raw_with_brand.groupBy("brand_clean").agg(
        F.sum(F.when(F.col("event_type") == "purchase", 1).otherwise(0)).alias(
            "brand_total_purchases"
        ),
        F.sum(F.when(F.col("event_type") == "cart", 1).otherwise(0)).alias(
            "brand_total_carts"
        ),
        F.avg("price").alias("brand_avg_price"),
    )

    brand_agg = brand_agg.withColumn(
        "brand_purchase_rate",
        F.when(
            F.col("brand_total_carts") > 0,
            F.col("brand_total_purchases") / F.col("brand_total_carts"),
        ).otherwise(0.0),
    )

    # Category level aggregate
    raw_with_cat = raw_df.withColumn(
        "_cat_split",
        F.split(F.lower(F.coalesce(F.col("category_code"), F.lit("unknown"))), "\\."),
    ).withColumn(
        "category_level1",
        F.when(F.size("_cat_split") >= 1, F.col("_cat_split").getItem(0)).otherwise(
            "unknown"
        ),
    )

    category_agg = raw_with_cat.groupBy("category_level1").agg(
        F.avg("price").alias("category_avg_price"),
        F.sum(F.when(F.col("event_type") == "purchase", 1).otherwise(0)).alias(
            "category_total_purchases"
        ),
    )

    print(f"Brand features: {brand_agg.count():,} brands")
    print(f"Category features: {category_agg.count():,} categories")

    # ==========================================================================
    # LOAD V1 DATA AND JOIN WITH NEW FEATURES
    # ==========================================================================
    print("\n[6/7] Loading V1 data and joining features...")

    # Load existing v1 parquet with legacy timestamp handling
    # Use pandas to read then convert to spark (handles timestamp nanoseconds)
    import pandas as pd

    v1_pandas = pd.read_parquet(str(v1_parquet_path))
    # Convert timestamps to microseconds (Spark compatible)
    for col in v1_pandas.select_dtypes(include=["datetime64[ns]"]).columns:
        v1_pandas[col] = v1_pandas[col].astype("datetime64[us]")
    v1_df = spark.createDataFrame(v1_pandas)
    print(f"V1 data loaded: {v1_df.count():,} rows")

    # Join user features
    v2_df = v1_df.join(
        user_agg.select(
            "user_id",
            "user_total_events",
            "user_total_views",
            "user_total_carts",
            "user_total_purchases",
            "user_view_to_cart_rate",
            "user_cart_to_purchase_rate",
            "user_avg_purchase_price",
            "user_unique_products",
            "user_unique_categories",
        ),
        on="user_id",
        how="left",
    )

    # Join product features
    v2_df = v2_df.join(
        product_agg.select(
            "product_id",
            "product_total_events",
            "product_total_views",
            "product_total_carts",
            "product_total_purchases",
            "product_view_to_cart_rate",
            "product_cart_to_purchase_rate",
            "product_unique_buyers",
        ),
        on="product_id",
        how="left",
    )

    # Join brand features
    v2_df = v2_df.withColumn(
        "brand_clean", F.lower(F.coalesce(F.col("brand"), F.lit("unknown")))
    )

    v2_df = v2_df.join(
        brand_agg.select("brand_clean", "brand_purchase_rate", "brand_avg_price"),
        on="brand_clean",
        how="left",
    )

    # Join category features
    v2_df = v2_df.join(
        category_agg.select("category_level1", "category_avg_price"),
        v2_df.category_code_level1 == category_agg.category_level1,
        how="left",
    )

    # Compute derived features
    v2_df = v2_df.withColumn(
        "price_vs_user_avg",
        F.when(
            F.col("user_avg_purchase_price") > 0,
            F.col("price") / F.col("user_avg_purchase_price"),
        ).otherwise(1.0),
    )

    v2_df = v2_df.withColumn(
        "price_vs_category_avg",
        F.when(
            F.col("category_avg_price") > 0,
            F.col("price") / F.col("category_avg_price"),
        ).otherwise(1.0),
    )

    # Add hour feature
    v2_df = v2_df.withColumn("event_hour", F.hour(F.col("event_timestamp")))

    # Fill nulls
    v2_df = v2_df.fillna(
        {
            "user_total_events": 0,
            "user_total_views": 0,
            "user_total_carts": 0,
            "user_total_purchases": 0,
            "user_view_to_cart_rate": 0.0,
            "user_cart_to_purchase_rate": 0.0,
            "user_avg_purchase_price": 0.0,
            "user_unique_products": 0,
            "user_unique_categories": 0,
            "product_total_events": 0,
            "product_total_views": 0,
            "product_total_carts": 0,
            "product_total_purchases": 0,
            "product_view_to_cart_rate": 0.0,
            "product_cart_to_purchase_rate": 0.0,
            "product_unique_buyers": 0,
            "brand_purchase_rate": 0.0,
            "brand_avg_price": 0.0,
            "price_vs_user_avg": 1.0,
            "price_vs_category_avg": 1.0,
        }
    )

    # Select final columns
    final_columns = [
        # Entity keys
        "user_id",
        "product_id",
        # Timestamps
        "event_timestamp",
        "created_timestamp",
        # Original V1 features
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

    v2_df = v2_df.select(final_columns)

    # Drop duplicate columns if any
    v2_df = v2_df.dropDuplicates(["user_id", "product_id", "event_timestamp"])

    # ==========================================================================
    # SAVE OUTPUT
    # ==========================================================================
    print("\n[7/7] Saving output...")

    # Show sample
    print("\nSample output:")
    v2_df.show(5, truncate=False)

    final_count = v2_df.count()
    print(f"\nFinal dataset: {final_count:,} rows")

    # Target distribution
    print("\nTarget distribution:")
    v2_df.groupBy("is_purchased").count().show()

    # Print schema
    print("\nNew features added:")
    for col in [
        "user_total_views",
        "user_cart_to_purchase_rate",
        "product_total_views",
        "product_cart_to_purchase_rate",
        "brand_purchase_rate",
        "price_vs_user_avg",
    ]:
        print(f"  - {col}")

    # Save as single CSV file (convert to pandas first)
    output_path.parent.mkdir(parents=True, exist_ok=True)

    # Convert to pandas and save as CSV
    print("Converting to pandas and saving as CSV...")
    v2_pandas = v2_df.toPandas()
    v2_pandas.to_csv(str(output_path), index=False)
    print(f"Saved CSV file: {output_path}")

    elapsed = time.time() - start_time
    print(f"\n{'=' * 70}")
    print(f"FEATURE ENGINEERING V2 COMPLETE!")
    print(f"Total time: {elapsed / 60:.1f} minutes")
    print(f"Output: {output_path}")
    print(f"Total features: {len(final_columns) - 1} (excluding target)")
    print(f"{'=' * 70}")

    spark.stop()


if __name__ == "__main__":
    main()
"""
Split data into train/test ensuring all categorical values appear in train.

Usage:
    python split_train_test.py --input <path> --output-dir <path> [--test-size 0.2] [--random-state 42]
"""

import argparse
from pathlib import Path
import pandas as pd
from sklearn.model_selection import train_test_split
from loguru import logger


def split_with_category_coverage(
    df: pd.DataFrame,
    cat_cols: list[str],
    target_col: str,
    test_size: float = 0.2,
    random_state: int = 42,
) -> tuple[pd.DataFrame, pd.DataFrame]:
    """
    Split data ensuring all unique values in categorical columns appear in train.

    Strategy:
    1. For each unique value in cat_cols, ensure at least 1 sample goes to train
    2. Split remaining data with stratification on target
    3. Combine to get final train/test sets
    """
    logger.info(f"Original data shape: {df.shape}")
    logger.info(f"Categorical columns to ensure coverage: {cat_cols}")

    # Step 1: Get one sample for each unique combination to guarantee coverage
    coverage_samples_idx = set()

    for col in cat_cols:
        unique_values = df[col].unique()
        logger.info(f"  {col}: {len(unique_values)} unique values")

        for val in unique_values:
            # Get first occurrence of this value
            idx = df[df[col] == val].index[0]
            coverage_samples_idx.add(idx)

    logger.info(f"Samples reserved for coverage: {len(coverage_samples_idx)}")

    # Step 2: Split remaining data
    coverage_df = df.loc[list(coverage_samples_idx)]
    remaining_df = df.drop(index=list(coverage_samples_idx))

    logger.info(f"Remaining data for split: {len(remaining_df)}")

    # Calculate adjusted test_size to maintain overall ratio
    total_samples = len(df)
    target_test_samples = int(total_samples * test_size)
    remaining_test_samples = target_test_samples  # All test samples come from remaining

    adjusted_test_size = remaining_test_samples / len(remaining_df)
    adjusted_test_size = min(adjusted_test_size, 0.5)  # Cap at 50%

    logger.info(f"Adjusted test_size for remaining data: {adjusted_test_size:.4f}")

    # Stratified split on remaining data
    train_remaining, test_df = train_test_split(
        remaining_df,
        test_size=adjusted_test_size,
        random_state=random_state,
        stratify=remaining_df[target_col],
    )

    # Step 3: Combine coverage samples with train
    train_df = pd.concat([coverage_df, train_remaining], ignore_index=True)
    test_df = test_df.reset_index(drop=True)

    # Shuffle train to mix coverage samples
    train_df = train_df.sample(frac=1, random_state=random_state).reset_index(drop=True)

    return train_df, test_df


def validate_split(
    train_df: pd.DataFrame,
    test_df: pd.DataFrame,
    cat_cols: list[str],
    target_col: str,
) -> bool:
    """Validate that all categorical values in test exist in train."""
    all_valid = True

    logger.info("=== VALIDATION ===")

    for col in cat_cols:
        train_unique = set(train_df[col].unique())
        test_unique = set(test_df[col].unique())
        unseen = test_unique - train_unique

        if unseen:
            logger.error(f"  {col}: {len(unseen)} unseen values in test!")
            all_valid = False
        else:
            logger.info(f"  {col}: OK (all {len(test_unique)} test values in train)")

    # Class distribution
    train_dist = train_df[target_col].value_counts(normalize=True).to_dict()
    test_dist = test_df[target_col].value_counts(normalize=True).to_dict()

    logger.info(f"Train class distribution: {train_dist}")
    logger.info(f"Test class distribution: {test_dist}")

    return all_valid


def main():
    parser = argparse.ArgumentParser(
        description="Split data with category coverage guarantee"
    )
    parser.add_argument(
        "--input",
        type=str,
        required=True,
        help="Path to input parquet file",
    )
    parser.add_argument(
        "--output-dir",
        type=str,
        required=True,
        help="Directory to save train.parquet and test.parquet",
    )
    parser.add_argument(
        "--test-size",
        type=float,
        default=0.2,
        help="Test set size ratio (default: 0.2)",
    )
    parser.add_argument(
        "--random-state",
        type=int,
        default=42,
        help="Random state for reproducibility (default: 42)",
    )
    parser.add_argument(
        "--target-col",
        type=str,
        default="is_purchased",
        help="Target column name (default: is_purchased)",
    )

    args = parser.parse_args()

    # Categorical columns to ensure coverage
    cat_cols = ["brand", "category_code_level1", "category_code_level2"]

    logger.info("=" * 60)
    logger.info("SPLIT DATA WITH CATEGORY COVERAGE")
    logger.info("=" * 60)
    logger.info(f"Input: {args.input}")
    logger.info(f"Output dir: {args.output_dir}")
    logger.info(f"Test size: {args.test_size}")
    logger.info(f"Random state: {args.random_state}")

    # Load data
    logger.info("Loading data...")
    df = pd.read_parquet(args.input)
    logger.info(f"Loaded {len(df):,} samples with {len(df.columns)} columns")

    # Split
    train_df, test_df = split_with_category_coverage(
        df=df,
        cat_cols=cat_cols,
        target_col=args.target_col,
        test_size=args.test_size,
        random_state=args.random_state,
    )

    logger.info("=" * 60)
    logger.info("SPLIT RESULTS")
    logger.info("=" * 60)
    logger.info(f"Train shape: {train_df.shape} ({len(train_df) / len(df) * 100:.1f}%)")
    logger.info(f"Test shape: {test_df.shape} ({len(test_df) / len(df) * 100:.1f}%)")

    # Validate
    is_valid = validate_split(train_df, test_df, cat_cols, args.target_col)

    if not is_valid:
        logger.error("Validation FAILED! Aborting save.")
        return 1

    # Save
    output_dir = Path(args.output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)

    train_path = output_dir / "train.parquet"
    test_path = output_dir / "test.parquet"

    logger.info(f"Saving train to: {train_path}")
    train_df.to_parquet(train_path, index=False)

    logger.info(f"Saving test to: {test_path}")
    test_df.to_parquet(test_path, index=False)

    logger.info("=" * 60)
    logger.info("COMPLETE")
    logger.info("=" * 60)

    return 0


if __name__ == "__main__":
    exit(main())


# python split_train_test.py \
#   --input "../propensity_feature_store/propensity_features/feature_repo/data/processed_purchase_propensity_data_v2.parquet" \
#   --output-dir "../propensity_feature_store/propensity_features/feature_repo/data" \
#   --test-size 0.2 \
#   --random-state 42
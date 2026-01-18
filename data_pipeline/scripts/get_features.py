"""
Script to query features from Feast Feature Store for Purchase Propensity Model.

This script provides functions to retrieve features for user-product pairs
from the online feature store.
"""

from feast import FeatureStore
import pandas as pd
import os
from typing import Union, List, Tuple

# Path configuration using relative paths
_SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
_PROJECT_ROOT = os.path.dirname(_SCRIPT_DIR)  # data_pipeline/
_REPO_PATH = os.path.join(
    _PROJECT_ROOT,
    "propensity_feature_store",
    "propensity_features",
    "feature_repo",
)

# Features from propensity_features FeatureView
FEATURES = [
    "propensity_features:category_code_level1",
    "propensity_features:category_code_level2",
    "propensity_features:brand",
    "propensity_features:event_weekday",
    "propensity_features:price",
    "propensity_features:activity_count",
]


def get_propensity_features(
    user_id: Union[int, str, List[Union[int, str]]],
    product_id: Union[int, str, List[Union[int, str]]],
) -> pd.DataFrame:
    """
    Get features from feature store for user_id and product_id pairs.

    Args:
        user_id: User ID (int, str) or list of User IDs
        product_id: Product ID (int, str) or list of Product IDs

    Returns:
        DataFrame containing features for each user-product pair

    Example:
        # Single pair
        df = get_propensity_features(user_id=512550662, product_id=12703493)

        # Multiple pairs
        df = get_propensity_features(
            user_id=[512550662, 516301799],
            product_id=[12703493, 12702930]
        )
    """
    store = FeatureStore(repo_path=_REPO_PATH)

    # Convert to lists if single values
    user_ids = [user_id] if not isinstance(user_id, list) else user_id
    product_ids = [product_id] if not isinstance(product_id, list) else product_id

    # Validate equal lengths
    if len(user_ids) != len(product_ids):
        raise ValueError(
            f"user_id and product_id lists must have same length. "
            f"Got {len(user_ids)} user_ids and {len(product_ids)} product_ids."
        )

    # Prepare entity rows (each row needs both user_id and product_id)
    entity_rows = []
    for uid, pid in zip(user_ids, product_ids):
        try:
            uid_int = int(uid)
            pid_int = int(pid)
            entity_rows.append({"user_id": uid_int, "product_id": pid_int})
        except (ValueError, TypeError) as e:
            print(
                f"Warning: Could not convert user_id={uid} or product_id={pid} to int: {e}"
            )
            entity_rows.append({"user_id": uid, "product_id": pid})

    # Get features from online feature store
    df = store.get_online_features(
        entity_rows=entity_rows,
        features=FEATURES,
    ).to_df()

    print(
        f"Retrieved features for {len(entity_rows)} user-product pairs. Shape: {df.shape}"
    )
    return df


def get_propensity_features_batch(
    entity_df: pd.DataFrame,
) -> pd.DataFrame:
    """
    Get features for a batch of user-product pairs using a DataFrame.

    Args:
        entity_df: DataFrame with columns 'user_id' and 'product_id'

    Returns:
        DataFrame with features joined to entity_df
    """
    if "user_id" not in entity_df.columns or "product_id" not in entity_df.columns:
        raise ValueError("entity_df must contain 'user_id' and 'product_id' columns")

    user_ids = entity_df["user_id"].tolist()
    product_ids = entity_df["product_id"].tolist()

    return get_propensity_features(user_id=user_ids, product_id=product_ids)


# Main execution when run as script
if __name__ == "__main__":
    print(f"Feature Store Repository Path: {_REPO_PATH}")
    print(f"Features to retrieve: {FEATURES}")
    print("-" * 60)

    # Example 1: Get features for specific user-product pairs
    # These are sample IDs from the processed data
    sample_user_ids = [512550662, 516301799, 561066382, 551388017]
    sample_product_ids = [12703493, 12702930, 3800966, 26019083]

    print("\nExample 1: Fetching features for sample user-product pairs...")
    try:
        df = get_propensity_features(
            user_id=sample_user_ids,
            product_id=sample_product_ids,
        )
        print("\nRetrieved Features:")
        print(df.to_string())
    except Exception as e:
        print(f"Error fetching features: {e}")
        print("\nNote: Make sure you have:")
        print("  1. Run 'feast apply' in the feature_repo directory")
        print("  2. Run 'feast materialize' to load data into online store")
        print("  3. Redis is running (for online store)")

    print("\n" + "-" * 60)

    # Example 2: Single user-product pair
    print("\nExample 2: Single user-product pair...")
    try:
        df_single = get_propensity_features(
            user_id=515903856,
            product_id=2601552,
        )
        print(df_single)
    except Exception as e:
        print(f"Error: {e}")

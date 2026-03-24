#!/usr/bin/env python3
"""
Benchmark script to compare TabICL, XGBoost, CatBoost, and LightGBM models.

This script trains all 4 models on the same data split and compares:
- Accuracy
- Precision
- Recall
- F1 Score
- AUC-ROC
- Log Loss
- Training Time
"""

import argparse
import gc
import os
import time
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd
import torch
from sklearn.metrics import (
    accuracy_score,
    f1_score,
    log_loss,
    precision_score,
    recall_score,
    roc_auc_score,
)
from sklearn.model_selection import train_test_split

# Add project root to path
PROJECT_ROOT = Path(__file__).resolve().parents[2]
import sys

sys.path.insert(0, str(PROJECT_ROOT / "model_pipeline" / "src"))

from loguru import logger

# Import ML models
from catboost import CatBoostClassifier
from lightgbm import LGBMClassifier
from xgboost import XGBClassifier

# Conditionally import TabICL
try:
    from tabicl import TabICLClassifier

    TABICL_AVAILABLE = True
except ImportError:
    TABICL_AVAILABLE = False
    logger.warning("TabICL not available. Install with: pip install tabicl")


# =============================================================================
# Configuration
# =============================================================================

# Environment setup
os.environ["AWS_ACCESS_KEY_ID"] = "minio"
os.environ["AWS_SECRET_ACCESS_KEY"] = "minio123"
os.environ["AWS_DEFAULT_REGION"] = "us-east-1"
os.environ["MLFLOW_S3_ENDPOINT_URL"] = os.environ.get(
    "MLFLOW_S3_ENDPOINT_URL", "http://minio:9000"
)

# Device selection
if torch.cuda.is_available():
    DEVICE = "cuda"
elif torch.backends.mps.is_available():
    DEVICE = "mps"
else:
    DEVICE = "cpu"


# =============================================================================
# Helper Functions
# =============================================================================


def get_device() -> str:
    """Get the best available device."""
    return DEVICE


def encode_categorical(
    train_df: pd.DataFrame, test_df: pd.DataFrame, categorical_cols: list[str]
) -> tuple[pd.DataFrame, pd.DataFrame]:
    """Encode categorical columns using label encoding."""
    train_encoded = train_df.copy()
    test_encoded = test_df.copy()

    for col in categorical_cols:
        if col in train_df.columns:
            categories = pd.Index(
                train_encoded[col].astype(str).fillna("__missing__").unique()
            )
            mapping = {value: idx for idx, value in enumerate(categories)}

            train_encoded[col] = (
                train_encoded[col].astype(str).fillna("__missing__").map(mapping)
            )
            test_encoded[col] = (
                test_encoded[col]
                .astype(str)
                .fillna("__missing__")
                .map(mapping)
                .fillna(-1)
            )

    return train_encoded, test_encoded


def prepare_data(
    data_path: str,
    target_col: str = "is_purchased",
    sample_size: int | None = None,
    test_size: float = 0.2,
    random_state: int = 42,
) -> dict[str, Any]:
    """
    Load and prepare data for benchmarking.

    Returns:
        Dictionary containing train/test splits for different models
    """
    logger.info(f"Loading data from: {data_path}")
    data_path = Path(data_path)

    if data_path.suffix.lower() == ".csv":
        data = pd.read_csv(data_path)
    elif data_path.suffix.lower() in [".parquet", ".pq"]:
        data = pd.read_parquet(data_path)
    else:
        raise ValueError(f"Unsupported file format: {data_path.suffix}")

    logger.info(f"Full dataset shape: {data.shape}")

    # Sample if needed
    if sample_size and sample_size < len(data):
        logger.info(f"Sampling {sample_size:,} rows from {len(data):,} rows")
        data = data.sample(n=sample_size, random_state=random_state).reset_index(
            drop=True
        )
        logger.info(f"Sampled dataset shape: {data.shape}")

    # Remove non-feature columns
    exclude_cols = [
        target_col,
        "event_time",
        "user_id",
        "product_id",
        "category_code",
    ]
    feature_cols = [col for col in data.columns if col not in exclude_cols]

    # Remove datetime columns - handle pandas version differences
    datetime_cols = []
    for col in feature_cols:
        if "datetime" in str(data[col].dtype):
            datetime_cols.append(col)
    feature_cols = [col for col in feature_cols if col not in datetime_cols]

    logger.info(f"Removed datetime columns: {datetime_cols}")
    logger.info(f"Using {len(feature_cols)} features")

    # Get categorical columns
    X_raw = data[feature_cols].copy()
    y = data[target_col].astype(int).to_numpy()

    # Get categorical columns - handle pandas version differences
    cat_cols = []
    for col in X_raw.columns:
        dtype_str = str(X_raw[col].dtype)
        if dtype_str == "object" or dtype_str.startswith("category"):
            cat_cols.append(col)
    num_cols = [col for col in X_raw.columns if col not in cat_cols]

    logger.info(f"Features: {len(num_cols)} numeric, {len(cat_cols)} categorical")

    # Create shared train/test split
    X_train_raw, X_test_raw, y_train, y_test = train_test_split(
        X_raw, y, test_size=test_size, random_state=random_state, stratify=y
    )

    logger.info(f"Train shape: {X_train_raw.shape}, Test shape: {X_test_raw.shape}")
    logger.info(
        f"Target distribution - Train: {np.bincount(y_train)}, Test: {np.bincount(y_test)}"
    )

    # Create encoded version for gradient boosting models
    X_train_encoded, X_test_encoded = encode_categorical(
        X_train_raw, X_test_raw, cat_cols
    )

    return {
        "X_train_raw": X_train_raw,
        "X_test_raw": X_test_raw,
        "X_train_encoded": X_train_encoded,
        "X_test_encoded": X_test_encoded,
        "y_train": y_train,
        "y_test": y_test,
        "feature_names": feature_cols,
        "cat_cols": cat_cols,
        "num_cols": num_cols,
    }


def calculate_metrics(
    y_true: np.ndarray, y_pred: np.ndarray, y_prob: np.ndarray
) -> dict[str, float]:
    """Calculate all evaluation metrics."""
    return {
        "accuracy": accuracy_score(y_true, y_pred),
        "precision": precision_score(y_true, y_pred, zero_division=0),
        "recall": recall_score(y_true, y_pred, zero_division=0),
        "f1": f1_score(y_true, y_pred, zero_division=0),
        "auc_roc": roc_auc_score(y_true, y_prob),
        "log_loss": log_loss(y_true, y_prob),
    }


# =============================================================================
# Model Training Functions
# =============================================================================


def train_xgboost(
    X_train: pd.DataFrame, X_test: pd.DataFrame, y_train: np.ndarray, y_test: np.ndarray
) -> tuple[Any, dict[str, float], float]:
    """Train and evaluate XGBoost model."""
    logger.info("Training XGBoost...")

    params = {
        "objective": "binary:logistic",
        "eval_metric": ["auc", "logloss"],
        "max_depth": 6,
        "eta": 0.1,
        "subsample": 0.8,
        "colsample_bytree": 0.8,
        "tree_method": "hist",
        "device": "cuda" if DEVICE == "cuda" else "cpu",
        "random_state": 42,
    }

    start_time = time.time()
    model = XGBClassifier(**params, n_estimators=200)
    model.fit(
        X_train,
        y_train,
        eval_set=[(X_test, y_test)],
        verbose=False,
    )
    train_time = time.time() - start_time

    y_prob = model.predict_proba(X_test)[:, 1]
    y_pred = (y_prob >= 0.5).astype(int)

    metrics = calculate_metrics(y_test, y_pred, y_prob)
    metrics["train_time_seconds"] = train_time

    logger.info(
        f"XGBoost - Accuracy: {metrics['accuracy']:.4f}, AUC: {metrics['auc_roc']:.4f}, Time: {train_time:.2f}s"
    )

    return model, metrics, train_time


def train_lightgbm(
    X_train: pd.DataFrame, X_test: pd.DataFrame, y_train: np.ndarray, y_test: np.ndarray
) -> tuple[Any, dict[str, float], float]:
    """Train and evaluate LightGBM model."""
    logger.info("Training LightGBM...")

    params = {
        "objective": "binary",
        "metric": ["auc", "binary_logloss"],
        "max_depth": 6,
        "learning_rate": 0.1,
        "n_estimators": 200,
        "subsample": 0.8,
        "colsample_bytree": 0.8,
        "random_state": 42,
        "verbose": -1,
    }

    start_time = time.time()
    model = LGBMClassifier(**params)
    model.fit(
        X_train,
        y_train,
        eval_set=[(X_test, y_test)],
    )
    train_time = time.time() - start_time

    y_prob = model.predict_proba(X_test)[:, 1]
    y_pred = (y_prob >= 0.5).astype(int)

    metrics = calculate_metrics(y_test, y_pred, y_prob)
    metrics["train_time_seconds"] = train_time

    logger.info(
        f"LightGBM - Accuracy: {metrics['accuracy']:.4f}, AUC: {metrics['auc_roc']:.4f}, Time: {train_time:.2f}s"
    )

    return model, metrics, train_time


def train_catboost(
    X_train: pd.DataFrame,
    X_test: pd.DataFrame,
    y_train: np.ndarray,
    y_test: np.ndarray,
    cat_cols: list[str],
) -> tuple[Any, dict[str, float], float]:
    """Train and evaluate CatBoost model."""
    logger.info("Training CatBoost...")

    # Get categorical column indices
    cat_indices = [
        X_train.columns.get_loc(col) for col in cat_cols if col in X_train.columns
    ]

    params = {
        "iterations": 200,
        "depth": 6,
        "learning_rate": 0.1,
        "loss_function": "Logloss",
        "eval_metric": "AUC",
        "random_seed": 42,
        "verbose": False,
        "cat_features": cat_indices,
    }

    start_time = time.time()
    model = CatBoostClassifier(**params)
    model.fit(
        X_train,
        y_train,
        eval_set=(X_test, y_test),
        early_stopping_rounds=50,
    )
    train_time = time.time() - start_time

    y_prob = model.predict_proba(X_test)[:, 1]
    y_pred = (y_prob >= 0.5).astype(int)

    metrics = calculate_metrics(y_test, y_pred, y_prob)
    metrics["train_time_seconds"] = train_time

    logger.info(
        f"CatBoost - Accuracy: {metrics['accuracy']:.4f}, AUC: {metrics['auc_roc']:.4f}, Time: {train_time:.2f}s"
    )

    return model, metrics, train_time


def train_tabicl(
    X_train: pd.DataFrame,
    X_test: pd.DataFrame,
    y_train: np.ndarray,
    y_test: np.ndarray,
    device: str | None = None,
) -> tuple[Any, dict[str, float], float]:
    """Train and evaluate TabICL model."""
    if not TABICL_AVAILABLE:
        raise ImportError("TabICL is not installed. Install with: pip install tabicl")

    logger.info("Training TabICL...")

    # Determine device and settings
    if device is None:
        # TabICL on CPU with disk offloading for safety
        device = "cpu"

    # For large datasets, use more conservative settings
    offload_dir = Path("./tabicl_offload")
    offload_dir.mkdir(parents=True, exist_ok=True)

    # Configure TabICL
    params = {
        "device": device,
        "n_estimators": 8,  # Ensemble size
        "batch_size": 4,
        "offload_mode": "disk" if device == "cpu" else "auto",
        "disk_offload_dir": str(offload_dir.resolve()) if device == "cpu" else None,
        "kv_cache": False,  # Disable for first run
        "verbose": True,
    }

    # Use lighter settings for CPU
    if device == "cpu":
        params.update(
            {
                "n_estimators": 4,
                "batch_size": 2,
            }
        )

    start_time = time.time()
    model = TabICLClassifier(**params)
    model.fit(X_train, y_train)
    train_time = time.time() - start_time

    y_prob = model.predict_proba(X_test)[:, 1]
    y_pred = model.predict(X_test)

    # Ensure y_pred is numpy array
    if hasattr(y_pred, "numpy"):
        y_pred = y_pred.numpy()
    y_pred = y_pred.astype(int)

    metrics = calculate_metrics(y_test, y_pred, y_prob)
    metrics["train_time_seconds"] = train_time

    logger.info(
        f"TabICL - Accuracy: {metrics['accuracy']:.4f}, AUC: {metrics['auc_roc']:.4f}, Time: {train_time:.2f}s"
    )

    # Cleanup
    del model
    gc.collect()

    return None, metrics, train_time


# =============================================================================
# Main Benchmark Function
# =============================================================================


def run_benchmark(
    data_path: str,
    sample_size: int | None = None,
    target_col: str = "is_purchased",
    include_tabicl: bool = True,
    output_path: str | None = None,
) -> dict[str, dict[str, float]]:
    """
    Run complete benchmark comparison.

    Args:
        data_path: Path to training data (CSV or Parquet)
        sample_size: Number of rows to sample (None = use full data)
        target_col: Name of target column
        include_tabicl: Whether to include TabICL in benchmark
        output_path: Path to save results JSON

    Returns:
        Dictionary mapping model names to their metrics
    """
    logger.info("=" * 70)
    logger.info("Starting Model Benchmark")
    logger.info(f"Device: {DEVICE}")
    logger.info(f"Data path: {data_path}")
    logger.info(f"Sample size: {sample_size or 'Full dataset'}")
    logger.info("=" * 70)

    # Prepare data
    data = prepare_data(
        data_path=data_path,
        target_col=target_col,
        sample_size=sample_size,
    )

    results = {}

    # Train XGBoost
    logger.info("\n" + "=" * 50)
    logger.info("Training XGBoost")
    logger.info("=" * 50)
    _, xgb_metrics, _ = train_xgboost(
        data["X_train_encoded"],
        data["X_test_encoded"],
        data["y_train"],
        data["y_test"],
    )
    results["xgboost"] = xgb_metrics

    # Train LightGBM
    logger.info("\n" + "=" * 50)
    logger.info("Training LightGBM")
    logger.info("=" * 50)
    _, lgb_metrics, _ = train_lightgbm(
        data["X_train_encoded"],
        data["X_test_encoded"],
        data["y_train"],
        data["y_test"],
    )
    results["lightgbm"] = lgb_metrics

    # Train CatBoost (uses raw data with categorical support)
    logger.info("\n" + "=" * 50)
    logger.info("Training CatBoost")
    logger.info("=" * 50)
    _, cat_metrics, _ = train_catboost(
        data["X_train_raw"],
        data["X_test_raw"],
        data["y_train"],
        data["y_test"],
        data["cat_cols"],
    )
    results["catboost"] = cat_metrics

    # Train TabICL (uses raw data, handles categoricals automatically)
    if include_tabicl and TABICL_AVAILABLE:
        logger.info("\n" + "=" * 50)
        logger.info("Training TabICL")
        logger.info("=" * 50)

        # Determine device for TabICL
        tabicl_device = "cuda" if DEVICE == "cuda" else "cpu"

        try:
            _, tabicl_metrics, _ = train_tabicl(
                data["X_train_raw"],
                data["X_test_raw"],
                data["y_train"],
                data["y_test"],
                device=tabicl_device,
            )
            results["tabicl"] = tabicl_metrics
        except Exception as e:
            logger.error(f"TabICL training failed: {e}")
            results["tabicl"] = {"error": str(e)}
    elif include_tabicl and not TABICL_AVAILABLE:
        logger.warning("TabICL requested but not available")

    # Print summary
    print_benchmark_summary(results)

    # Save results
    if output_path:
        import json

        output_path = Path(output_path)
        output_path.parent.mkdir(parents=True, exist_ok=True)
        with open(output_path, "w") as f:
            json.dump(results, f, indent=2)
        logger.info(f"Results saved to: {output_path}")

    return results


def print_benchmark_summary(results: dict[str, dict[str, float]]):
    """Print a formatted benchmark summary table."""
    print("\n" + "=" * 90)
    print("BENCHMARK RESULTS SUMMARY")
    print("=" * 90)
    print(
        f"{'Model':<15} {'Accuracy':<10} {'Precision':<10} {'Recall':<10} {'F1':<10} {'AUC-ROC':<10} {'Log Loss':<10} {'Time(s)':<10}"
    )
    print("-" * 90)

    for model_name, metrics in results.items():
        if "error" in metrics:
            print(f"{model_name:<15} ERROR: {metrics['error']}")
            continue

        print(
            f"{model_name:<15} "
            f"{metrics.get('accuracy', 0):.4f}     "
            f"{metrics.get('precision', 0):.4f}     "
            f"{metrics.get('recall', 0):.4f}     "
            f"{metrics.get('f1', 0):.4f}     "
            f"{metrics.get('auc_roc', 0):.4f}     "
            f"{metrics.get('log_loss', 0):.4f}     "
            f"{metrics.get('train_time_seconds', 0):.2f}"
        )

    print("=" * 90)


# =============================================================================
# CLI Entry Point
# =============================================================================


def main():
    parser = argparse.ArgumentParser(
        description="Benchmark TabICL vs XGBoost vs CatBoost vs LightGBM"
    )
    parser.add_argument(
        "--data-path",
        type=str,
        required=True,
        help="Path to training data (CSV or Parquet)",
    )
    parser.add_argument(
        "--sample-size",
        type=int,
        default=None,
        help="Number of rows to sample (default: use full data)",
    )
    parser.add_argument(
        "--target-col",
        type=str,
        default="is_purchased",
        help="Target column name",
    )
    parser.add_argument(
        "--no-tabicl",
        action="store_true",
        help="Skip TabICL in benchmark",
    )
    parser.add_argument(
        "--output",
        type=str,
        default=None,
        help="Path to save results JSON",
    )

    args = parser.parse_args()

    run_benchmark(
        data_path=args.data_path,
        sample_size=args.sample_size,
        target_col=args.target_col,
        include_tabicl=not args.no_tabicl,
        output_path=args.output,
    )


if __name__ == "__main__":
    main()

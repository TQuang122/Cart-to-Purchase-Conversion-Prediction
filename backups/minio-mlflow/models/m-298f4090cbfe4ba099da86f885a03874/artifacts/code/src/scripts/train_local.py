"""
Train XGBoost model from 2019-Nov.csv.gz and export artifacts.
Run: python model_pipeline/src/scripts/train_local.py
"""

import gzip
import json
import os
import pickle
import sys
import warnings
from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.model_selection import train_test_split
from xgboost import XGBClassifier

warnings.filterwarnings("ignore")

# ── Config ──────────────────────────────────────────────────────────────────
SAMPLE_SIZE = 200_000  # rows to sample for fast training
TEST_SIZE = 0.2
RANDOM_STATE = 42
TARGET_THRESHOLD = 0.525  # tuned threshold for v8

NUMERICAL_FEATURES = [
    "price",
    "activity_count",
    "event_weekday",
    "event_hour",
    "user_total_events",
    "user_total_views",
    "user_total_carts",
    "user_total_purchases",
    "user_view_to_cart_rate",
    "user_cart_to_purchase_rate",
    "user_avg_purchase_price",
    "user_unique_products",
    "user_unique_categories",
    "product_total_events",
    "product_total_views",
    "product_total_carts",
    "product_total_purchases",
    "product_view_to_cart_rate",
    "product_cart_to_purchase_rate",
    "product_unique_buyers",
    "brand_purchase_rate",
    "price_vs_user_avg",
    "price_vs_category_avg",
]
CATEGORICAL_FEATURES = ["brand", "category_code_level1", "category_code_level2"]
ALL_FEATURES = NUMERICAL_FEATURES + CATEGORICAL_FEATURES

# ── Paths ───────────────────────────────────────────────────────────────────
# Navigate: train_local.py → scripts/ → src/ → model_pipeline/ → project root
WORKDIR   = Path(__file__).resolve().parents[2]            # model_pipeline/
DATA_PATH = WORKDIR.parent / "data_pipeline" / "data" / "raw" / "2019-Nov.csv.gz"
OUT_DIR   = WORKDIR.parent / "serving_pipeline" / "models"
OUT_DIR.mkdir(parents=True, exist_ok=True)


def parse_category_code(cc):
    """Split 'electronics.smartphone' → level1='electronics', level2='smartphone'"""
    if pd.isna(cc) or str(cc).strip() == "":
        return "unknown", "unknown"
    parts = str(cc).strip().split(".", 1)
    l1 = parts[0] if parts[0] else "unknown"
    l2 = parts[1] if len(parts) > 1 else "unknown"
    return l1.lower(), l2.lower()


def build_cart_level(df: pd.DataFrame) -> pd.DataFrame:
    """Build cart-level rows: one row per user+product when a cart event occurs.
    Target: was the same product purchased by the same user in the same session?
    """
    print(f"[Preprocessing] Input rows: {len(df):,}")

    # Parse datetime
    df = df.copy()
    df["event_time"] = pd.to_datetime(df["event_time"], utc=True, errors="coerce")
    df["event_weekday"] = df["event_time"].dt.dayofweek.fillna(0).astype(int)
    df["event_hour"] = df["event_time"].dt.hour.fillna(12).astype(int)

    # Parse category
    parsed = df["category_code"].apply(parse_category_code)
    df["category_code_level1"] = parsed.apply(lambda x: x[0])
    df["category_code_level2"] = parsed.apply(lambda x: x[1])

    # Clean brand
    df["brand"] = df["brand"].fillna("unknown").str.lower().str.strip()

    # ── Step 1: Build purchase lookup (session-level) ──────────────────────
    purchases = (
        df[df["event_type"] == "purchase"]
        .groupby(["user_id", "user_session", "product_id"])
        .size()
        .reset_index(name="num_purchases")
    )
    purchases["did_purchase"] = 1

    # ── Step 2: Get cart events + merge purchase flag ──────────────────────
    carts = df[df["event_type"] == "cart"].copy()
    carts = carts.merge(
        purchases[["user_id", "user_session", "product_id", "did_purchase"]],
        on=["user_id", "user_session", "product_id"],
        how="left",
    )
    carts["did_purchase"] = carts["did_purchase"].fillna(0).astype(int)

    print(f"[Preprocessing] Cart rows: {len(carts):,}")
    print(f"[Preprocessing] Purchase rate: {carts['did_purchase'].mean():.4f}")

    # ── Step 3: Feature aggregation ────────────────────────────────────────
    uid_event = (
        df.groupby("user_id")
        .agg(
            user_total_events=("event_type", "count"),
            user_total_views=("event_type", lambda x: (x == "view").sum()),
            user_total_carts=("event_type", lambda x: (x == "cart").sum()),
            user_total_purchases=("event_type", lambda x: (x == "purchase").sum()),
            user_unique_products=("product_id", "nunique"),
            user_unique_categories=("category_code_level1", "nunique"),
        )
        .reset_index()
    )

    uid_event["user_view_to_cart_rate"] = (
        uid_event["user_total_carts"] / uid_event["user_total_views"].clip(lower=1)
    ).clip(upper=1.0)
    uid_event["user_cart_to_purchase_rate"] = (
        uid_event["user_total_purchases"] / uid_event["user_total_carts"].clip(lower=1)
    ).clip(upper=1.0)

    uid_price = (
        df[df["event_type"] == "purchase"]
        .groupby("user_id")["price"]
        .mean()
        .reset_index()
        .rename(columns={"price": "user_avg_purchase_price"})
    )

    pid_event = (
        df.groupby("product_id")
        .agg(
            product_total_events=("event_type", "count"),
            product_total_views=("event_type", lambda x: (x == "view").sum()),
            product_total_carts=("event_type", lambda x: (x == "cart").sum()),
            product_total_purchases=("event_type", lambda x: (x == "purchase").sum()),
            product_unique_buyers=("user_id", "nunique"),
        )
        .reset_index()
    )

    pid_event["product_view_to_cart_rate"] = (
        pid_event["product_total_carts"]
        / pid_event["product_total_views"].clip(lower=1)
    ).clip(upper=1.0)
    pid_event["product_cart_to_purchase_rate"] = (
        pid_event["product_total_purchases"]
        / pid_event["product_total_carts"].clip(lower=1)
    ).clip(upper=1.0)

    # brand purchase rate
    brand_stats = (
        df.groupby("brand")
        .agg(
            brand_purchases=("event_type", lambda x: (x == "purchase").sum()),
            brand_carts=("event_type", lambda x: (x == "cart").sum()),
        )
        .reset_index()
    )
    brand_stats["brand_purchase_rate"] = (
        brand_stats["brand_purchases"] / brand_stats["brand_carts"].clip(lower=1)
    ).clip(upper=1.0)

    # ── Step 4: Merge all into cart rows ───────────────────────────────────
    result = carts.merge(uid_event, on="user_id", how="left")
    result = result.merge(uid_price, on="user_id", how="left")
    result = result.merge(pid_event, on="product_id", how="left")
    result = result.merge(
        brand_stats[["brand", "brand_purchase_rate"]], on="brand", how="left"
    )

    # Derived
    result["activity_count"] = result["product_total_events"]
    result["price_vs_user_avg"] = result["price"] / result[
        "user_avg_purchase_price"
    ].clip(lower=0.01)
    result["price_vs_category_avg"] = 1.0  # simplified (no category avg needed)

    # Fill NaN
    for col in NUMERICAL_FEATURES:
        if col in result.columns:
            result[col] = result[col].fillna(0)

    # Filter: keep only rows with valid features
    result = result.dropna(subset=["price"])
    result["user_avg_purchase_price"] = result["user_avg_purchase_price"].fillna(
        result["price"]
    )

    # Rename target
    result["is_purchased"] = result["did_purchase"]

    print(f"[Preprocessing] Final cart-level rows: {len(result):,}")
    print(f"[Preprocessing] Columns: {result.columns.tolist()}")

    return result


def target_encode(df: pd.DataFrame, target_col: str, cats: list[str]) -> tuple:
    """Apply smoothed target encoding to categorical columns."""
    global_mean = df[target_col].mean()
    SMOOTHING = 20
    encoders = {}

    for col in cats:
        if col not in df.columns:
            df[col] = "unknown"
        df[col] = df[col].fillna("unknown").astype(str)
        stats = df.groupby(col)[target_col].agg(["mean", "count"])
        smoothed = (stats["count"] * stats["mean"] + SMOOTHING * global_mean) / (
            stats["count"] + SMOOTHING
        )
        df[col] = df[col].map(smoothed).fillna(global_mean)
        encoders[col] = {
            "mapping": smoothed.to_dict(),
            "global_mean": float(global_mean),
        }

    return df, encoders


def main():
    print("=" * 60)
    print("Cart-to-Purchase Model Training (Local Export)")
    print("=" * 60)

    # ── 1. Load data ───────────────────────────────────────────────────────
    print(f"\n[1] Loading data from {DATA_PATH} ...")
    chunks = []
    for chunk in pd.read_csv(
        DATA_PATH,
        usecols=[
            "event_time",
            "event_type",
            "product_id",
            "category_id",
            "category_code",
            "brand",
            "price",
            "user_id",
            "user_session",
        ],
        dtype={"price": "float32"},
        chunksize=1_000_000,
        compression="gzip",
    ):
        chunks.append(chunk)
        if sum(len(c) for c in chunks) >= SAMPLE_SIZE * 2:
            break

    raw = pd.concat(chunks, ignore_index=True)
    if len(raw) > SAMPLE_SIZE:
        raw = raw.sample(n=SAMPLE_SIZE, random_state=RANDOM_STATE).reset_index(
            drop=True
        )
    print(f"[1] Loaded {len(raw):,} rows")

    # ── 2. Build cart-level dataset ─────────────────────────────────────────
    print("\n[2] Building cart-level features ...")
    df = build_cart_level(raw)
    del raw

    if len(df) < 1000:
        print("ERROR: Too few cart-level rows. Need more data.")
        sys.exit(1)

    # ── 3. Train/test split ────────────────────────────────────────────────
    print("\n[3] Preparing train/test split ...")
    feature_df = df[ALL_FEATURES + ["is_purchased"]].copy()

    X = feature_df[ALL_FEATURES]
    y = feature_df["is_purchased"]

    X_train, X_test, y_train, y_test = train_test_split(
        X, y, test_size=TEST_SIZE, random_state=RANDOM_STATE, stratify=y
    )
    print(f"[3] Train: {len(X_train):,}, Test: {len(X_test):,}")
    print(f"[3] Class balance - Train: {y_train.mean():.4f}, Test: {y_test.mean():.4f}")

    # ── 4. Target encoding ────────────────────────────────────────────────
    print("\n[4] Target encoding categoricals ...")
    train_df = X_train.copy()
    train_df["is_purchased"] = y_train.values
    train_enc, encoders = target_encode(train_df, "is_purchased", CATEGORICAL_FEATURES)
    X_train_enc = train_enc[ALL_FEATURES]

    test_df = X_test.copy()
    test_df["is_purchased"] = y_test.values
    test_enc, _ = target_encode(test_df, "is_purchased", CATEGORICAL_FEATURES)
    X_test_enc = test_enc[ALL_FEATURES]

    # ── 5. Train XGBoost ──────────────────────────────────────────────────
    print("\n[5] Training XGBoost ...")
    pos_weight = (y_train == 0).sum() / max((y_train == 1).sum(), 1)
    model = XGBClassifier(
        n_estimators=200,
        max_depth=6,
        learning_rate=0.1,
        min_child_weight=1,
        subsample=0.8,
        colsample_bytree=0.8,
        objective="binary:logistic",
        eval_metric=["auc", "logloss"],
        scale_pos_weight=pos_weight,
        n_jobs=-1,
        random_state=RANDOM_STATE,
        verbosity=1,
    )
    model.fit(X_train_enc, y_train, eval_set=[(X_test_enc, y_test)], verbose=20)

    # ── 6. Evaluate ───────────────────────────────────────────────────────
    print("\n[6] Evaluating ...")
    from sklearn.metrics import accuracy_score, f1_score, roc_auc_score

    proba_test = model.predict_proba(X_test_enc)[:, 1]
    preds_test = (proba_test >= TARGET_THRESHOLD).astype(int)

    auc = roc_auc_score(y_test, proba_test)
    acc = accuracy_score(y_test, preds_test)
    f1 = f1_score(y_test, preds_test)

    print(f"[6] AUC: {auc:.4f}")
    print(f"[6] Accuracy: {acc:.4f}")
    print(f"[6] F1 (threshold={TARGET_THRESHOLD}): {f1:.4f}")

    # ── 7. Save artifacts ────────────────────────────────────────────────
    print("\n[7] Saving artifacts ...")

    # Save model (plain XGBoost - no cloudpickle)
    model_path = OUT_DIR / "xgboost_model.joblib"
    with open(model_path, "wb") as f:
        pickle.dump(model, f)
    print(f"[7] Model saved: {model_path} ({model_path.stat().st_size / 1024:.0f} KB)")

    # Save encoders
    enc_path = OUT_DIR / "encoders.json"
    with open(enc_path, "w") as f:
        json.dump(encoders, f, indent=2)
    print(f"[7] Encoders saved: {enc_path} ({enc_path.stat().st_size / 1024:.0f} KB)")

    # Save metadata
    meta = {
        "model_type": "xgboost",
        "feature_names": ALL_FEATURES,
        "numerical_features": NUMERICAL_FEATURES,
        "categorical_features": CATEGORICAL_FEATURES,
        "threshold": TARGET_THRESHOLD,
        "metrics": {
            "auc": round(auc, 4),
            "accuracy": round(acc, 4),
            "f1": round(f1, 4),
        },
        "training_samples": int(len(X_train)),
        "test_samples": int(len(X_test)),
        "class_balance_train": round(float(y_train.mean()), 4),
    }
    meta_path = OUT_DIR / "model_metadata.json"
    with open(meta_path, "w") as f:
        json.dump(meta, f, indent=2)
    print(f"[7] Metadata saved: {meta_path}")

    print("\n" + "=" * 60)
    print("TRAINING COMPLETE ✅")
    print(f"Model: {model_path}")
    print(f"AUC: {auc:.4f} | F1: {f1:.4f} | Acc: {acc:.4f}")
    print("=" * 60)


if __name__ == "__main__":
    main()

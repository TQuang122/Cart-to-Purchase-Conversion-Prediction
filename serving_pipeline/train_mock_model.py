"""
Train a quick XGBoost model with realistic synthetic data and push to MLflow.
Features match exactly what predict.py uses (26 features from xgboost.yaml).
"""

import os
import numpy as np
import pandas as pd
import mlflow
import mlflow.sklearn
from sklearn.preprocessing import LabelEncoder
from xgboost import XGBClassifier
from sklearn.model_selection import train_test_split
from sklearn.metrics import accuracy_score, roc_auc_score

# ─────────────────────────────────────────────
# MLflow config  (pointing to local Docker stack)
# ─────────────────────────────────────────────
os.environ["AWS_ACCESS_KEY_ID"] = "minio"
os.environ["AWS_SECRET_ACCESS_KEY"] = "minio123"
os.environ["AWS_DEFAULT_REGION"] = "us-east-1"
os.environ["MLFLOW_S3_ENDPOINT_URL"] = "http://localhost:9000"

MLFLOW_URI = "http://localhost:5000"
EXPERIMENT_NAME = "cart_purchase_mock_v1"
MODEL_NAME = "xgboost_ctp"

# Feature columns in exact training order
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
TARGET = "is_purchased"

BRANDS = ["samsung", "apple", "xiaomi", "huawei", "sony", "lg", "unknown"]
CAT_L1 = ["electronics", "apparel", "appliances", "computers", "sport", "unknown"]
CAT_L2 = ["smartphone", "audio", "laptop", "tablet", "camera", "clothing", "unknown"]


def generate_synthetic_data(n: int = 20_000, seed: int = 42) -> pd.DataFrame:
    """
    Generate synthetic data with realistic correlations.
    High-intent users (more carts, purchases, active brand) → more likely to buy.
    """
    rng = np.random.default_rng(seed)

    # User engagement level: 0=low, 1=high
    engagement = rng.choice([0, 1], size=n, p=[0.55, 0.45])

    price = rng.exponential(scale=200, size=n).clip(1, 5000)
    activity_count = np.where(engagement, rng.integers(3, 30, n), rng.integers(1, 5, n))
    event_weekday = rng.integers(0, 7, n)
    event_hour = rng.integers(0, 24, n)

    user_total_views = np.where(
        engagement, rng.integers(50, 500, n), rng.integers(1, 30, n)
    ).astype(float)
    user_total_carts = np.where(
        engagement, rng.integers(10, 80, n), rng.integers(0, 5, n)
    ).astype(float)
    user_total_purchases = (
        (user_total_carts * rng.uniform(0.3, 0.7, n)).astype(int).astype(float)
    )
    user_total_events = user_total_views + user_total_carts + user_total_purchases

    user_view_to_cart_rate = (user_total_carts / user_total_views.clip(1)).clip(0, 1)
    user_cart_to_purchase_rate = (user_total_purchases / user_total_carts.clip(1)).clip(
        0, 1
    )
    user_avg_purchase_price = price * rng.uniform(0.6, 1.4, n)
    user_unique_products = np.where(
        engagement, rng.integers(5, 50, n), rng.integers(1, 8, n)
    ).astype(float)
    user_unique_categories = np.where(
        engagement, rng.integers(2, 8, n), rng.integers(1, 3, n)
    ).astype(float)

    product_total_views = rng.integers(100, 10000, n).astype(float)
    product_total_carts = (
        (product_total_views * rng.uniform(0.05, 0.25, n)).astype(int).astype(float)
    )
    product_total_purchases = (
        (product_total_carts * rng.uniform(0.2, 0.6, n)).astype(int).astype(float)
    )
    product_total_events = (
        product_total_views + product_total_carts + product_total_purchases
    )

    product_view_to_cart_rate = (
        product_total_carts / product_total_views.clip(1)
    ).clip(0, 1)
    product_cart_to_purchase_rate = (
        product_total_purchases / product_total_carts.clip(1)
    ).clip(0, 1)
    product_unique_buyers = rng.integers(10, 500, n).astype(float)

    brand_purchase_rate = np.where(
        engagement, rng.uniform(0.3, 0.9, n), rng.uniform(0.0, 0.4, n)
    )
    price_vs_user_avg = price / user_avg_purchase_price.clip(1)
    price_vs_category_avg = rng.uniform(0.5, 2.0, n)

    brand = rng.choice(BRANDS, n)
    category_code_level1 = rng.choice(CAT_L1, n)
    category_code_level2 = rng.choice(CAT_L2, n)

    # Target: high-engagement + high brand_purchase_rate + good cart rates → purchase
    purchase_score = (
        0.35 * user_cart_to_purchase_rate
        + 0.25 * brand_purchase_rate
        + 0.20 * product_cart_to_purchase_rate
        + 0.10 * (activity_count / 30).clip(0, 1)
        + 0.05 * user_view_to_cart_rate
        + 0.05 * (1 - (price_vs_user_avg - 1).clip(0, 1))
    )
    noise = rng.uniform(-0.15, 0.15, n)
    is_purchased = (purchase_score + noise >= 0.35).astype(int)

    df = pd.DataFrame(
        {
            "price": price,
            "activity_count": activity_count.astype(float),
            "event_weekday": event_weekday.astype(float),
            "event_hour": event_hour.astype(float),
            "user_total_events": user_total_events,
            "user_total_views": user_total_views,
            "user_total_carts": user_total_carts,
            "user_total_purchases": user_total_purchases,
            "user_view_to_cart_rate": user_view_to_cart_rate,
            "user_cart_to_purchase_rate": user_cart_to_purchase_rate,
            "user_avg_purchase_price": user_avg_purchase_price,
            "user_unique_products": user_unique_products,
            "user_unique_categories": user_unique_categories,
            "product_total_events": product_total_events,
            "product_total_views": product_total_views,
            "product_total_carts": product_total_carts,
            "product_total_purchases": product_total_purchases,
            "product_view_to_cart_rate": product_view_to_cart_rate,
            "product_cart_to_purchase_rate": product_cart_to_purchase_rate,
            "product_unique_buyers": product_unique_buyers,
            "brand_purchase_rate": brand_purchase_rate,
            "price_vs_user_avg": price_vs_user_avg,
            "price_vs_category_avg": price_vs_category_avg,
            "brand": brand,
            "category_code_level1": category_code_level1,
            "category_code_level2": category_code_level2,
            "is_purchased": is_purchased,
        }
    )
    return df


def main():
    print("Generating synthetic training data...")
    df = generate_synthetic_data(n=20_000)
    print(f"Dataset shape: {df.shape}")
    print(f"Purchase rate: {df['is_purchased'].mean():.2%}")

    # Encode categoricals
    encoders: dict[str, LabelEncoder] = {}
    for col in CATEGORICAL_FEATURES:
        le = LabelEncoder()
        df[col] = le.fit_transform(df[col].astype(str))
        encoders[col] = le

    X = df[ALL_FEATURES]
    y = df[TARGET]
    X_train, X_test, y_train, y_test = train_test_split(
        X, y, test_size=0.2, random_state=42, stratify=y
    )

    # ─── MLflow ───────────────────────────────
    mlflow.set_tracking_uri(MLFLOW_URI)
    mlflow.set_experiment(EXPERIMENT_NAME)

    print(f"\nConnecting to MLflow at {MLFLOW_URI} ...")

    with mlflow.start_run(run_name="xgboost_mock_v1") as run:
        run_id = run.info.run_id
        print(f"Run ID: {run_id}")

        params = {
            "n_estimators": 200,
            "max_depth": 6,
            "learning_rate": 0.1,
            "subsample": 0.8,
            "colsample_bytree": 0.8,
            "objective": "binary:logistic",
            "eval_metric": "logloss",
            "n_jobs": -1,
            "random_state": 42,
        }
        mlflow.log_params(params)
        mlflow.log_param("feature_count", len(ALL_FEATURES))
        mlflow.log_param("training_samples", len(X_train))

        print("Training XGBoost...")
        model = XGBClassifier(**params)
        model.fit(
            X_train,
            y_train,
            eval_set=[(X_test, y_test)],
            verbose=False,
        )

        # Metrics
        y_pred = model.predict(X_test)
        y_prob = model.predict_proba(X_test)[:, 1]
        acc = accuracy_score(y_test, y_pred)
        auc = roc_auc_score(y_test, y_prob)
        print(f"Accuracy: {acc:.4f}  AUC: {auc:.4f}")

        mlflow.log_metric("accuracy", acc)
        mlflow.log_metric("auc", auc)

        # Save metadata for loader
        mlflow.log_dict(
            {
                "feature_names": ALL_FEATURES,
                "categorical_features": CATEGORICAL_FEATURES,
            },
            "feature_metadata.json",
        )
        # Save encoder classes for each categorical
        encoder_meta = {col: list(le.classes_) for col, le in encoders.items()}
        mlflow.log_dict(encoder_meta, "encoder_classes.json")

        # Log model
        input_example = X_train.head(3)
        mlflow.sklearn.log_model(
            sk_model=model,
            artifact_path="model",
            input_example=input_example,
            registered_model_name=MODEL_NAME,
        )

        print(f"\nModel registered as '{MODEL_NAME}'")
        print(f"Run ID: {run_id}")

    # Set alias champion on version 1
    client = mlflow.MlflowClient(tracking_uri=MLFLOW_URI)
    client.set_registered_model_alias(MODEL_NAME, "champion", "1")
    print(f"Alias 'champion' set on version 1 of '{MODEL_NAME}'")
    print("\nDone! You can now restart the FastAPI backend.")


if __name__ == "__main__":
    main()

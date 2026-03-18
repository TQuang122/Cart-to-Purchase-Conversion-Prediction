# """
# Prediction router — loads a real XGBoost model from MLflow Registry.
# No random, no MD5 hashing. All predictions are deterministic.
# """
#
import os
import json
import tempfile
from datetime import datetime
from io import BytesIO
from pathlib import Path
from typing import Any, Literal

import numpy as np
import pandas as pd
from fastapi import APIRouter, File, HTTPException, Query, Response, UploadFile
from sklearn.preprocessing import LabelEncoder

from api.schemas import (
    CartInputFeast,
    CartInputRaw,
    CartInputRawLite,
    CartPrediction,
    ExplainabilityPayload,
    FeatureContribution,
    FeatureQuality,
    ServingModel,
)

# ─────────────────────────────────────────────────────────────────
# MLflow / S3 environment  (must be set before importing mlflow)
# ─────────────────────────────────────────────────────────────────
os.environ.setdefault("AWS_ACCESS_KEY_ID", "minio")
os.environ.setdefault("AWS_SECRET_ACCESS_KEY", "minio123")
os.environ.setdefault("AWS_DEFAULT_REGION", "us-east-1")
os.environ.setdefault("MLFLOW_S3_ENDPOINT_URL", "http://localhost:9000")

try:
    import mlflow  # noqa: E402  (must be after env vars)
except Exception as exc:  # pragma: no cover - runtime environment dependent
    mlflow = None
    _mlflow_import_error = str(exc)
else:
    _mlflow_import_error = None

MLFLOW_URI = os.getenv("MLFLOW_TRACKING_URI", "http://localhost:5000")
DEFAULT_MODEL_KEY: ServingModel = os.getenv("DEFAULT_SERVING_MODEL", "xgboost")  # type: ignore[assignment]
DEFAULT_MODEL_ALIAS = os.getenv("MLFLOW_MODEL_ALIAS", "champion")

MODEL_REGISTRY_NAMES: dict[ServingModel, str] = {
    "xgboost": os.getenv("MLFLOW_MODEL_NAME_XGBOOST", "xgboost_ctp"),
    "lightgbm": os.getenv("MLFLOW_MODEL_NAME_LIGHTGBM", "lightgbm_ctp"),
    "catboost": os.getenv("MLFLOW_MODEL_NAME_CATBOOST", "catboost_ctp"),
}

MODEL_ALIASES: dict[ServingModel, str] = {
    "xgboost": os.getenv("MLFLOW_MODEL_ALIAS_XGBOOST", DEFAULT_MODEL_ALIAS),
    "lightgbm": os.getenv("MLFLOW_MODEL_ALIAS_LIGHTGBM", DEFAULT_MODEL_ALIAS),
    "catboost": os.getenv("MLFLOW_MODEL_ALIAS_CATBOOST", DEFAULT_MODEL_ALIAS),
}

VALID_MODELS: tuple[ServingModel, ...] = ("xgboost", "lightgbm", "catboost")
if DEFAULT_MODEL_KEY not in VALID_MODELS:
    DEFAULT_MODEL_KEY = "xgboost"

# Feature column order (must match training order exactly)
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

FEAST_FEATURE_REFS = [
    f"propensity_features:{feature_name}" for feature_name in ALL_FEATURES
]
FEAST_REPO_PATH = os.getenv(
    "FEAST_REPO_PATH",
    str(
        Path(__file__).resolve().parents[3]
        / "data_pipeline"
        / "propensity_feature_store"
        / "propensity_features"
        / "feature_repo"
    ),
)

FEATURE_COLUMNS_LITE = [
    "price",
    "activity_count",
    "event_weekday",
    "event_hour",
    "user_total_views",
    "user_total_carts",
    "product_total_views",
    "product_total_carts",
    "brand_purchase_rate",
    "price_vs_user_avg",
    "price_vs_category_avg",
    "brand",
    "category_code_level1",
    "category_code_level2",
]

# ─────────────────────────────────────────────────────────────────
# Model loading (done once at import time)
# ─────────────────────────────────────────────────────────────────

ModelBundle = dict[str, Any]
_model_bundles: dict[ServingModel, ModelBundle] = {}
_feast_store = None
_feast_init_error: str | None = None
_predict_threshold: float = float(
    os.getenv("PREDICT_THRESHOLD", "0.55")
)  # tuned for v7 (scale_pos_weight model)


def _resolve_model_version(client: Any, model_key: ServingModel) -> Any:
    model_name = MODEL_REGISTRY_NAMES[model_key]
    alias = MODEL_ALIASES[model_key]
    try:
        return client.get_model_version_by_alias(model_name, alias)
    except Exception:
        versions = client.search_model_versions(f"name='{model_name}'")
        if not versions:
            raise RuntimeError(f"No model versions found for '{model_name}'")
        return max(versions, key=lambda item: int(item.version))


def _resolve_model_artifact_uri(
    client: Any, model_name: str, run_id: str, fallback_uri: str
) -> str:
    """
    Resolve a loadable model URI in MLflow 3.x where registered model `source`
    can still point to runs:/<run_id>/model while actual artifacts are under
    model-centric paths (s3://.../models/m-<id>/artifacts).
    """
    try:
        experiment_ids = [exp.experiment_id for exp in client.search_experiments()]
        page_token = None
        while True:
            response = client.search_logged_models(
                experiment_ids=experiment_ids,
                max_results=500,
                page_token=page_token,
            )
            for logged_model in response:
                if (
                    logged_model.source_run_id == run_id
                    and logged_model.name == model_name
                    and logged_model.artifact_location
                ):
                    return logged_model.artifact_location

            page_token = response.token
            if not page_token:
                break
    except Exception:
        pass

    return fallback_uri


def _load_model_bundle(model_key: ServingModel) -> ModelBundle:
    """Load one model bundle (model + encoders + metadata) from MLflow registry."""
    import sys
    from pathlib import Path

    # Add model_pipeline/ (parent of src/) to sys.path so 'src.*' imports resolve.
    # cloudpickle serialized BinaryClassifierWrapper with __module__='src.model.xgboost_trainer'.
    # parents[3] = project root (serving_pipeline/api/routers/predict.py -> 3 levels up).
    _project_root = Path(__file__).resolve().parents[3]
    _model_pipeline_root = str(_project_root / "model_pipeline")
    if _model_pipeline_root not in sys.path:
        sys.path.insert(0, _model_pipeline_root)

    bundle: ModelBundle = {
        "model": None,
        "encoders": {},
        "model_uri": None,
        "run_id": None,
        "model_source": "heuristic_fallback",
        "model_load_error": None,
        "last_checked_at": datetime.now().isoformat(),
        "last_loaded_at": None,
    }

    if mlflow is None:
        bundle["model_load_error"] = (
            "mlflow package is not installed in current Python environment. "
            f"Import error: {_mlflow_import_error}"
        )
        return bundle

    try:
        mlflow.set_tracking_uri(MLFLOW_URI)
        client = mlflow.MlflowClient(tracking_uri=MLFLOW_URI)

        # Resolve alias if possible; otherwise fallback to latest model version.
        mv = _resolve_model_version(client, model_key)
        run_id = mv.run_id
        model_name = MODEL_REGISTRY_NAMES[model_key]
        registry_uri = f"models:/{model_name}/{mv.version}"
        model_uri = _resolve_model_artifact_uri(
            client, model_name, run_id, registry_uri
        )

        encoders: dict[str, Any] = {}

        # Load encoder classes - support both legacy (list) and target encoding (dict) formats
        tmp = tempfile.mkdtemp()
        try:
            enc_path = client.download_artifacts(run_id, "encoder_classes.json", tmp)
            with open(enc_path) as f:
                encoder_data = json.load(f)

            # Handle both formats:
            # - Legacy: {col: ["class1", "class2", ...]}
            # - Target encoding: {col: {"mapping": {cat: mean, ...}, "global_mean": float}}
            for col, enc_info in encoder_data.items():
                if isinstance(enc_info, dict) and "mapping" in enc_info:
                    encoders[col] = enc_info
                else:
                    le = LabelEncoder()
                    le.classes_ = np.array(enc_info)
                    encoders[col] = le
        except Exception:
            encoders = {}

        print(f"[predict] Using model_uri for {model_key}: {model_uri}")
        # cloudpickle serialized BinaryClassifierWrapper as 'src.model.xgboost_trainer'.
        # model_pipeline/ is now in sys.path, so 'src' package is importable directly.
        pyfunc_model = mlflow.pyfunc.load_model(model_uri)
        model = pyfunc_model.unwrap_python_model().model

        bundle["model"] = model
        bundle["encoders"] = encoders
        bundle["model_uri"] = model_uri
        bundle["run_id"] = run_id
        bundle["model_source"] = "mlflow"
        bundle["last_loaded_at"] = datetime.now().isoformat()
        print(f"[predict] Model loaded for {model_key}: {model_uri} (run_id={run_id})")

    except Exception as exc:
        bundle["model_load_error"] = str(exc)
        print(
            f"[predict] WARNING: Failed to load {model_key} model from MLflow — {exc}"
        )
        print(f"[predict] Falling back to heuristic scoring for {model_key}.")

    return bundle


def _load_models() -> None:
    global _model_bundles
    _model_bundles = {
        model_key: _load_model_bundle(model_key) for model_key in VALID_MODELS
    }


# Load at startup
_load_models()

# ─────────────────────────────────────────────────────────────────
# Stats tracking
# ─────────────────────────────────────────────────────────────────

_prediction_stats = {
    "total_predictions": 0,
    "successful_predictions": 0,
    "failed_predictions": 0,
    "by_model": {
        model_key: {"total": 0, "success": 0, "failed": 0} for model_key in VALID_MODELS
    },
    "start_time": datetime.now().isoformat(),
}
_quality_history: list[dict] = []

router = APIRouter(prefix="/predict", tags=["predict"])


def _track_prediction(success: bool, model_key: ServingModel, count: int = 1) -> None:
    _prediction_stats["total_predictions"] += count
    if success:
        _prediction_stats["successful_predictions"] += count
    else:
        _prediction_stats["failed_predictions"] += count

    _prediction_stats["by_model"][model_key]["total"] += count
    if success:
        _prediction_stats["by_model"][model_key]["success"] += count
    else:
        _prediction_stats["by_model"][model_key]["failed"] += count


def _get_feast_store() -> Any:
    global _feast_store, _feast_init_error

    if _feast_store is not None:
        return _feast_store

    if _feast_init_error is not None:
        raise RuntimeError(_feast_init_error)

    if not Path(FEAST_REPO_PATH).exists():
        _feast_init_error = f"Feast repo path does not exist: {FEAST_REPO_PATH}"
        raise RuntimeError(_feast_init_error)

    try:
        from feast import FeatureStore

        _feast_store = FeatureStore(repo_path=FEAST_REPO_PATH)
        return _feast_store
    except Exception as exc:
        _feast_init_error = str(exc)
        raise RuntimeError(_feast_init_error) from exc


def _resolve_entity_key(raw_value: str) -> int | str:
    value = raw_value.strip()
    if not value:
        return value
    try:
        return int(value)
    except ValueError:
        return value


def _resolve_feature_value(row: dict[str, Any], feature_name: str) -> Any:
    candidates = (
        feature_name,
        f"propensity_features__{feature_name}",
        f"propensity_features:{feature_name}",
        f"propensity_features.{feature_name}",
    )
    for key in candidates:
        if key in row and not pd.isna(row[key]):
            return row[key]
    return None


def _to_float(value: Any, default: float = 0.0) -> float:
    if value is None:
        return default
    try:
        if pd.isna(value):
            return default
    except TypeError:
        pass
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


def _to_int(value: Any, default: int = 0) -> int:
    if value is None:
        return default
    try:
        if pd.isna(value):
            return default
    except TypeError:
        pass
    try:
        return int(float(value))
    except (TypeError, ValueError):
        return default


def _to_str(value: Any, default: str = "unknown") -> str:
    if value is None:
        return default
    try:
        if pd.isna(value):
            return default
    except TypeError:
        pass
    text = str(value).strip()
    return text if text else default


def _fetch_raw_from_feast(payload: CartInputFeast) -> CartInputRaw:
    store = _get_feast_store()

    entity_row = {
        "user_id": _resolve_entity_key(payload.user_id),
        "product_id": _resolve_entity_key(payload.product_id),
    }

    online_df = store.get_online_features(
        entity_rows=[entity_row],
        features=FEAST_FEATURE_REFS,
    ).to_df()

    if online_df.empty:
        raise HTTPException(
            status_code=404,
            detail=(
                f"No Feast online features found for user_id={payload.user_id}, "
                f"product_id={payload.product_id}."
            ),
        )

    row = online_df.iloc[0].to_dict()

    return CartInputRaw(
        price=_to_float(_resolve_feature_value(row, "price")),
        activity_count=_to_float(_resolve_feature_value(row, "activity_count")),
        event_weekday=_to_int(_resolve_feature_value(row, "event_weekday")),
        event_hour=_to_int(_resolve_feature_value(row, "event_hour")),
        user_total_events=_to_float(_resolve_feature_value(row, "user_total_events")),
        user_total_views=_to_float(_resolve_feature_value(row, "user_total_views")),
        user_total_carts=_to_float(_resolve_feature_value(row, "user_total_carts")),
        user_total_purchases=_to_float(
            _resolve_feature_value(row, "user_total_purchases")
        ),
        user_view_to_cart_rate=_to_float(
            _resolve_feature_value(row, "user_view_to_cart_rate")
        ),
        user_cart_to_purchase_rate=_to_float(
            _resolve_feature_value(row, "user_cart_to_purchase_rate")
        ),
        user_avg_purchase_price=_to_float(
            _resolve_feature_value(row, "user_avg_purchase_price")
        ),
        user_unique_products=_to_float(
            _resolve_feature_value(row, "user_unique_products")
        ),
        user_unique_categories=_to_float(
            _resolve_feature_value(row, "user_unique_categories")
        ),
        product_total_events=_to_float(
            _resolve_feature_value(row, "product_total_events")
        ),
        product_total_views=_to_float(
            _resolve_feature_value(row, "product_total_views")
        ),
        product_total_carts=_to_float(
            _resolve_feature_value(row, "product_total_carts")
        ),
        product_total_purchases=_to_float(
            _resolve_feature_value(row, "product_total_purchases")
        ),
        product_view_to_cart_rate=_to_float(
            _resolve_feature_value(row, "product_view_to_cart_rate")
        ),
        product_cart_to_purchase_rate=_to_float(
            _resolve_feature_value(row, "product_cart_to_purchase_rate")
        ),
        product_unique_buyers=_to_float(
            _resolve_feature_value(row, "product_unique_buyers")
        ),
        brand_purchase_rate=_to_float(
            _resolve_feature_value(row, "brand_purchase_rate")
        ),
        price_vs_user_avg=_to_float(_resolve_feature_value(row, "price_vs_user_avg")),
        price_vs_category_avg=_to_float(
            _resolve_feature_value(row, "price_vs_category_avg")
        ),
        brand=_to_str(_resolve_feature_value(row, "brand")),
        category_code_level1=_to_str(
            _resolve_feature_value(row, "category_code_level1")
        ),
        category_code_level2=_to_str(
            _resolve_feature_value(row, "category_code_level2")
        ),
    )


def _record_quality(quality: FeatureQuality) -> None:
    _quality_history.append(
        {
            "timestamp": datetime.now().isoformat(),
            "score": quality.score,
            "grade": quality.grade,
            "fallback_ratio": quality.fallback_ratio,
        }
    )


def _resolve_threshold(threshold: float | None) -> float:
    if threshold is None:
        return _predict_threshold
    return min(1.0, max(0.0, float(threshold)))


def _resolve_actual_label(raw_value: Any) -> int | None:
    if raw_value is None:
        return None
    try:
        if pd.isna(raw_value):
            return None
    except TypeError:
        pass

    try:
        label = int(float(raw_value))
    except (TypeError, ValueError):
        return None

    if label in (0, 1):
        return label
    return None


def _normalize_csv_columns(df: pd.DataFrame) -> pd.DataFrame:
    normalized_df = df.copy()
    normalized_df.columns = (
        normalized_df.columns.astype(str)
        .str.replace("\ufeff", "", regex=False)
        .str.strip()
        .str.lower()
    )
    return normalized_df


def _extract_feature_contributions(
    model: Any, encoded_df: pd.DataFrame
) -> tuple[list[FeatureContribution], float]:
    baseline_score = 0.0

    try:
        if hasattr(model, "get_booster"):
            booster = model.get_booster()
            matrix = np.asarray(encoded_df[ALL_FEATURES], dtype=float)
            contrib_matrix = booster.predict(matrix, pred_contribs=True)
            row_contrib = contrib_matrix[0]
            baseline_score = float(row_contrib[-1])
            raw_values = row_contrib[:-1]
            feature_order = booster.feature_names or ALL_FEATURES
            contribution_map = {
                feature_name: float(value)
                for feature_name, value in zip(feature_order, raw_values)
            }
            return [
                FeatureContribution(
                    feature=feature_name,
                    contribution=round(contribution_map.get(feature_name, 0.0), 6),
                    display_name=feature_name.replace("_", " ").title(),
                )
                for feature_name in ALL_FEATURES
            ], baseline_score
    except Exception:
        pass

    importances = None
    if hasattr(model, "feature_importances_"):
        importances = np.asarray(model.feature_importances_, dtype=float)
    elif hasattr(model, "coef_"):
        coef = np.asarray(model.coef_, dtype=float)
        importances = np.abs(coef[0] if coef.ndim > 1 else coef)

    if importances is None or importances.size == 0:
        return [], baseline_score

    if importances.size != len(ALL_FEATURES):
        size = min(importances.size, len(ALL_FEATURES))
        aligned = np.zeros(len(ALL_FEATURES), dtype=float)
        aligned[:size] = importances[:size]
        importances = aligned

    row_values = np.asarray(encoded_df[ALL_FEATURES].iloc[0], dtype=float)
    scale = float(np.sum(np.abs(row_values))) or 1.0
    signed_contrib = (row_values / scale) * importances

    return [
        FeatureContribution(
            feature=feature_name,
            contribution=round(float(value), 6),
            display_name=feature_name.replace("_", " ").title(),
        )
        for feature_name, value in zip(ALL_FEATURES, signed_contrib)
    ], baseline_score


# ─────────────────────────────────────────────────────────────────
# Feature encoding helpers
# ─────────────────────────────────────────────────────────────────


def _encode_categorical(df: pd.DataFrame, encoders: dict[str, Any]) -> pd.DataFrame:
    """
    Label-encode categorical columns using the fitted encoders.
    Supports both target encoding (dict with 'mapping') and legacy LabelEncoder format.
    Unknown values are mapped to global mean (target encoding) or 0 (LabelEncoder).
    """
    df = df.copy()
    for col in CATEGORICAL_FEATURES:
        if col not in df.columns:
            df[col] = 0.0
            continue
        encoder = encoders.get(col)
        if encoder is None:
            df[col] = 0.0
            continue

        # Check if this is target encoding (dict with 'mapping') or legacy LabelEncoder
        if isinstance(encoder, dict) and "mapping" in encoder:
            # Target encoding: map category to target mean
            mapping = encoder["mapping"]
            global_mean = encoder.get("global_mean", 0.26)

            def target_encode(val: str) -> float:
                # Keep original case - mapping keys stored as-is from training
                s = str(val).strip()
                return mapping.get(s, global_mean)

            df[col] = df[col].apply(target_encode)
        elif hasattr(encoder, "classes_") and hasattr(encoder, "transform"):
            # Legacy LabelEncoder: map category to integer index
            classes = list(getattr(encoder, "classes_", []))

            def label_encode(val: str) -> int:
                s = str(val).lower().strip()
                if s in classes:
                    return int(getattr(encoder, "transform")([s])[0])
                if "unknown" in classes:
                    return int(getattr(encoder, "transform")(["unknown"])[0])
                return 0

            df[col] = df[col].apply(label_encode)
        else:
            df[col] = 0.0
    return df


# ─────────────────────────────────────────────────────────────────
# Core prediction
# ─────────────────────────────────────────────────────────────────


def _predict_from_raw(
    payload: CartInputRaw,
    model_key: ServingModel,
    threshold: float | None = None,
    actual_label: int | None = None,
    explain_level: Literal["top", "full"] = "top",
) -> CartPrediction:
    """Run inference with one selected model family."""
    model_bundle = _model_bundles.get(model_key)
    if model_bundle is None:
        raise HTTPException(status_code=400, detail=f"Unsupported model '{model_key}'")

    effective_threshold = _resolve_threshold(threshold)
    model = model_bundle["model"]
    encoders = model_bundle["encoders"]

    row = {col: getattr(payload, col, 0) for col in ALL_FEATURES}
    df = pd.DataFrame([row])
    df = _encode_categorical(df, encoders)
    df = df[ALL_FEATURES]

    if model is not None:
        proba = float(model.predict_proba(df)[0, 1])
        is_purchased = 1 if proba >= effective_threshold else 0
        feature_contributions, baseline_score = _extract_feature_contributions(
            model, df
        )
    else:
        # Deterministic heuristic fallback (no random)
        u_c2p = payload.user_cart_to_purchase_rate
        p_c2p = payload.product_cart_to_purchase_rate
        brand_r = payload.brand_purchase_rate
        u_v2c = payload.user_view_to_cart_rate
        price_ratio = max(0.0, 1.0 - max(0.0, payload.price_vs_user_avg - 1.0))
        score = (
            0.35 * u_c2p
            + 0.25 * brand_r
            + 0.20 * p_c2p
            + 0.10 * min(1.0, payload.activity_count / 20.0)
            + 0.05 * u_v2c
            + 0.05 * price_ratio
        )
        proba = round(float(score), 4)
        is_purchased = 1 if proba >= effective_threshold else 0
        heuristic_contrib_map = {
            "user_cart_to_purchase_rate": 0.35 * u_c2p,
            "brand_purchase_rate": 0.25 * brand_r,
            "product_cart_to_purchase_rate": 0.20 * p_c2p,
            "activity_count": 0.10 * min(1.0, payload.activity_count / 20.0),
            "user_view_to_cart_rate": 0.05 * u_v2c,
            "price_vs_user_avg": 0.05 * price_ratio,
        }
        feature_contributions = [
            FeatureContribution(
                feature=feature_name,
                contribution=round(
                    float(heuristic_contrib_map.get(feature_name, 0.0)), 6
                ),
                display_name=feature_name.replace("_", " ").title(),
            )
            for feature_name in ALL_FEATURES
        ]
        baseline_score = 0.0

    top_signals = sorted(
        feature_contributions,
        key=lambda item: abs(item.contribution),
        reverse=True,
    )[:3]

    returned_contributions = (
        feature_contributions if explain_level == "full" else top_signals
    )

    explainability = None
    if top_signals:
        explainability = ExplainabilityPayload(
            method="tree_contrib" if model is not None else "heuristic",
            baseline_score=round(float(baseline_score), 6),
            top_signals=top_signals,
            notes=[
                "Contributions reflect feature-level impact for this prediction row."
                f" Response level: {explain_level}."
            ],
        )

    return CartPrediction(
        is_purchased=is_purchased,
        probability=round(proba, 4),
        actual_label=actual_label,
        decision_threshold=round(effective_threshold, 4),
        model_used=model_key,
        feature_contributions=returned_contributions or None,
        explainability=explainability,
    )


# ─────────────────────────────────────────────────────────────────
# Lite preprocessing  (deterministic — no random)
# ─────────────────────────────────────────────────────────────────


def _preprocess_raw_lite(
    payload: CartInputRawLite,
) -> tuple[CartInputRaw, FeatureQuality]:
    """
    Derive the full CartInputRaw from a lite payload.
    All derived fields use deterministic formulas.
    """
    views = max(payload.user_total_views, 1.0)
    carts = payload.user_total_carts
    p_views = max(payload.product_total_views, 1.0)
    p_carts = payload.product_total_carts

    user_v2c = min(carts / views, 1.0)
    product_v2c = min(p_carts / p_views, 1.0)

    # Estimated purchases: assume cart-to-purchase rate of 40% (mid-range default)
    # Using a fixed ratio keeps results deterministic
    DEFAULT_C2P = 0.4
    user_purchases = round(carts * DEFAULT_C2P)
    product_purchases = round(p_carts * DEFAULT_C2P)

    user_c2p = min(user_purchases / max(carts, 1), 1.0)
    product_c2p = min(product_purchases / max(p_carts, 1), 1.0)

    full = CartInputRaw(
        price=payload.price,
        activity_count=payload.activity_count,
        event_weekday=payload.event_weekday,
        event_hour=payload.event_hour,
        user_total_events=views + carts + user_purchases,
        user_total_views=views,
        user_total_carts=carts,
        user_total_purchases=float(user_purchases),
        user_view_to_cart_rate=user_v2c,
        user_cart_to_purchase_rate=user_c2p,
        user_avg_purchase_price=payload.price,  # best single-item estimate
        user_unique_products=max(1.0, carts * 0.5),  # conservative estimate
        user_unique_categories=max(1.0, carts * 0.1),
        product_total_events=p_views + p_carts + product_purchases,
        product_total_views=p_views,
        product_total_carts=p_carts,
        product_total_purchases=float(product_purchases),
        product_view_to_cart_rate=product_v2c,
        product_cart_to_purchase_rate=product_c2p,
        product_unique_buyers=max(1.0, p_carts * DEFAULT_C2P),
        brand_purchase_rate=payload.brand_purchase_rate,
        price_vs_user_avg=payload.price_vs_user_avg,
        price_vs_category_avg=payload.price_vs_category_avg,
        brand=payload.brand,
        category_code_level1=payload.category_code_level1,
        category_code_level2=payload.category_code_level2,
    )

    # Feature quality: how complete is the input?
    # Lite input is missing 12 of 26 features (inferred)
    TOTAL_FEATURES = len(ALL_FEATURES)
    LITE_PROVIDED = len(FEATURE_COLUMNS_LITE)
    INFERRED = TOTAL_FEATURES - LITE_PROVIDED
    fallback_count = 0  # no fallbacks needed with deterministic formula
    fallback_ratio = fallback_count / TOTAL_FEATURES

    # Score: coverage bonus + rate quality
    coverage = LITE_PROVIDED / TOTAL_FEATURES
    rate_quality = (user_v2c + product_v2c + payload.brand_purchase_rate) / 3
    raw_score = coverage * 0.6 + rate_quality * 0.4
    score = round(raw_score * 100, 1)

    if score >= 80:
        grade = "A"
    elif score >= 60:
        grade = "B"
    elif score >= 40:
        grade = "C"
    else:
        grade = "D"

    quality = FeatureQuality(
        score=score,
        grade=grade,
        fallback_ratio=fallback_ratio,
        inferred_count=INFERRED,
        fallback_count=fallback_count,
    )

    return full, quality


# ─────────────────────────────────────────────────────────────────
# CORS OPTIONS handlers
# ─────────────────────────────────────────────────────────────────


@router.options("/raw")
def predict_raw_options() -> Response:
    return Response(status_code=200)


@router.options("/raw-lite")
def predict_raw_lite_options() -> Response:
    return Response(status_code=200)


# ─────────────────────────────────────────────────────────────────
# Endpoints
# ─────────────────────────────────────────────────────────────────


@router.post("/raw", response_model=CartPrediction)
def predict_raw(
    payload: CartInputRaw,
    model: ServingModel = Query(default=DEFAULT_MODEL_KEY),
    threshold: float | None = Query(default=None, ge=0.0, le=1.0),
    explain_level: Literal["top", "full"] = Query(default="top"),
) -> CartPrediction:
    result = _predict_from_raw(payload, model, threshold, explain_level=explain_level)
    _track_prediction(True, model)
    return result


@router.post("/raw-lite", response_model=CartPrediction)
def predict_raw_lite(
    payload: CartInputRawLite,
    model: ServingModel = Query(default=DEFAULT_MODEL_KEY),
    threshold: float | None = Query(default=None, ge=0.0, le=1.0),
    explain_level: Literal["top", "full"] = Query(default="top"),
) -> CartPrediction:
    full_payload, quality = _preprocess_raw_lite(payload)
    result = _predict_from_raw(
        full_payload,
        model,
        threshold,
        explain_level=explain_level,
    )
    result.feature_quality = quality
    _track_prediction(True, model)
    _record_quality(quality)
    return result


@router.post("/raw/batch", response_model=list[CartPrediction])
def predict_raw_batch(
    data_list: list[CartInputRaw],
    model: ServingModel = Query(default=DEFAULT_MODEL_KEY),
    threshold: float | None = Query(default=None, ge=0.0, le=1.0),
    explain_level: Literal["top", "full"] = Query(default="top"),
) -> list[CartPrediction]:
    if len(data_list) > 1000:
        raise HTTPException(status_code=400, detail="Batch size exceeds 1000 rows.")
    results = [
        _predict_from_raw(item, model, threshold, explain_level=explain_level)
        for item in data_list
    ]
    _track_prediction(True, model, len(results))
    return results


@router.post("/raw/batch/upload", response_model=list[CartPrediction])
async def predict_raw_batch_upload(
    file: UploadFile = File(...),
    model: ServingModel = Query(default=DEFAULT_MODEL_KEY),
    threshold: float | None = Query(default=None, ge=0.0, le=1.0),
    explain_level: Literal["top", "full"] = Query(default="top"),
) -> list[CartPrediction]:
    filename = file.filename or ""
    if not filename.lower().endswith(".csv"):
        raise HTTPException(status_code=400, detail="Only .csv files are supported.")

    content = await file.read()
    if not content:
        raise HTTPException(status_code=400, detail="Uploaded CSV is empty.")

    try:
        cleaned_content = content.replace(b"\xef\xbb\xbf", b"")
        df = pd.read_csv(BytesIO(cleaned_content))
        df = _normalize_csv_columns(df)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Invalid CSV: {exc}") from exc

    has_full = all(c in df.columns for c in ALL_FEATURES)
    has_lite = all(c in df.columns for c in FEATURE_COLUMNS_LITE)

    label_column = next(
        (
            name
            for name in ("actual_label", "label", "target", "y_true")
            if name in df.columns
        ),
        None,
    )

    if has_full:
        results = []
        for row in df.to_dict(orient="records"):
            actual_label = (
                _resolve_actual_label(row.get(label_column)) if label_column else None
            )
            item = CartInputRaw(**row)
            results.append(
                _predict_from_raw(
                    item,
                    model,
                    threshold,
                    actual_label=actual_label,
                    explain_level=explain_level,
                )
            )
    elif has_lite:
        results = []
        for row in df.to_dict(orient="records"):
            actual_label = (
                _resolve_actual_label(row.get(label_column)) if label_column else None
            )
            lite = CartInputRawLite(**row)
            full, quality = _preprocess_raw_lite(lite)
            result = _predict_from_raw(
                full,
                model,
                threshold,
                actual_label=actual_label,
                explain_level=explain_level,
            )
            result.feature_quality = quality
            results.append(result)
    else:
        missing_full = [c for c in ALL_FEATURES if c not in df.columns]
        missing_lite = [c for c in FEATURE_COLUMNS_LITE if c not in df.columns]
        available_columns = sorted(df.columns.tolist())
        raise HTTPException(
            status_code=400,
            detail=(
                "CSV missing required columns. Need either full or lite feature set. "
                f"Missing from full ({len(missing_full)}): {missing_full[:8]}. "
                f"Missing from lite ({len(missing_lite)}): {missing_lite[:8]}. "
                f"Detected columns ({len(available_columns)}): {available_columns[:12]}."
            ),
        )

    _track_prediction(True, model, len(results))
    return results


@router.post("/feast", response_model=CartPrediction)
def predict_feast(
    payload: CartInputFeast,
    model: ServingModel = Query(default=DEFAULT_MODEL_KEY),
    threshold: float | None = Query(default=None, ge=0.0, le=1.0),
    explain_level: Literal["top", "full"] = Query(default="top"),
) -> CartPrediction:
    try:
        full_payload = _fetch_raw_from_feast(payload)
        result = _predict_from_raw(
            full_payload,
            model,
            threshold,
            explain_level=explain_level,
        )
        _track_prediction(True, model)
        return result
    except HTTPException:
        _track_prediction(False, model)
        raise
    except Exception as exc:
        _track_prediction(False, model)
        raise HTTPException(
            status_code=500,
            detail=(
                "Failed to run Feast lookup prediction. "
                f"user_id={payload.user_id}, product_id={payload.product_id}, error={exc}"
            ),
        ) from exc


@router.get("/stats")
def get_stats() -> dict:
    total = _prediction_stats["total_predictions"]
    success = _prediction_stats["successful_predictions"]
    success_rate = round(success / total * 100, 1) if total > 0 else 0
    loaded_model_count = sum(
        1
        for model_bundle in _model_bundles.values()
        if model_bundle["model"] is not None
    )
    usable_model_count = sum(
        1
        for model_bundle in _model_bundles.values()
        if model_bundle["model"] is not None
        or model_bundle["model_source"] == "heuristic_fallback"
    )
    model_sources = {
        model_key: model_bundle["model_source"]
        for model_key, model_bundle in _model_bundles.items()
    }
    model_errors = {
        model_key: model_bundle["model_load_error"]
        for model_key, model_bundle in _model_bundles.items()
    }
    model_health = {
        model_key: {
            "loaded": model_bundle["model"] is not None,
            "usable": model_bundle["model"] is not None
            or model_bundle["model_source"] == "heuristic_fallback",
            "source": model_bundle["model_source"],
            "run_id": model_bundle["run_id"],
            "model_uri": model_bundle["model_uri"],
            "last_checked_at": model_bundle["last_checked_at"],
            "last_loaded_at": model_bundle["last_loaded_at"],
            "load_error": model_bundle["model_load_error"],
        }
        for model_key, model_bundle in _model_bundles.items()
    }
    return {
        **_prediction_stats,
        "success_rate": success_rate,
        "recent_activity": total,
        "models_active": loaded_model_count,
        "models_loaded": loaded_model_count,
        "models_usable": usable_model_count,
        "model_health": model_health,
        "model_sources": model_sources,
        "model_load_errors": model_errors,
        "default_model": DEFAULT_MODEL_KEY,
        "supported_models": list(VALID_MODELS),
        "predict_threshold": _predict_threshold,
    }


@router.get("/monitoring/fallback-ratio")
def get_fallback_ratio() -> dict:
    if not _quality_history:
        return {"fallback_ratio": 0.0, "sample_size": 0}
    avg_fallback = sum(q["fallback_ratio"] for q in _quality_history) / len(
        _quality_history
    )
    return {"fallback_ratio": avg_fallback, "sample_size": len(_quality_history)}

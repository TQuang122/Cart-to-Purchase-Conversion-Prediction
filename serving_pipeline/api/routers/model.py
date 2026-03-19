from __future__ import annotations

import os
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from fastapi import APIRouter, Query

from api.schemas import (
    HyperparameterItem,
    ModelArchitectureResponse,
    ModelHyperparametersResponse,
    ModelLineageResponse,
    ModelLineageVersion,
    ModelOverviewResponse,
    ServingModel,
)

os.environ.setdefault("AWS_ACCESS_KEY_ID", "minio")
os.environ.setdefault("AWS_SECRET_ACCESS_KEY", "minio123")
os.environ.setdefault("AWS_DEFAULT_REGION", "us-east-1")
os.environ.setdefault("MLFLOW_S3_ENDPOINT_URL", "http://localhost:9000")

try:
    import mlflow
except Exception as exc:
    mlflow = None
    _mlflow_import_error = str(exc)
else:
    _mlflow_import_error = None

try:
    import yaml  # type: ignore
except Exception:
    yaml = None

import os
os.environ.setdefault("MLFLOW_REQUEST_TIMEOUT", "3")
router = APIRouter(prefix="/model", tags=["model"])

PROJECT_ROOT = Path(__file__).resolve().parents[3]
MODEL_PIPELINE_ROOT = PROJECT_ROOT / "model_pipeline"
if str(MODEL_PIPELINE_ROOT) not in sys.path:
    sys.path.insert(0, str(MODEL_PIPELINE_ROOT))

MLFLOW_URI = os.getenv("MLFLOW_TRACKING_URI", "http://localhost:5000")
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
CONFIG_PATHS: dict[ServingModel, Path] = {
    "xgboost": MODEL_PIPELINE_ROOT / "src" / "config" / "xgboost.yaml",
    "lightgbm": MODEL_PIPELINE_ROOT / "src" / "config" / "lightgbm.yaml",
    "catboost": MODEL_PIPELINE_ROOT / "src" / "config" / "catboost.yaml",
}
PREDICT_THRESHOLD = float(os.getenv("PREDICT_THRESHOLD", "0.55"))


def _iso_from_timestamp(timestamp_ms: int | None) -> str | None:
    if not timestamp_ms:
        return None
    return datetime.fromtimestamp(timestamp_ms / 1000, tz=timezone.utc).isoformat()


def _load_config(model: ServingModel) -> dict[str, Any]:
    config_path = CONFIG_PATHS[model]
    if yaml is None or not config_path.exists():
        return {}
    with open(config_path, "r", encoding="utf-8") as handle:
        return yaml.safe_load(handle) or {}


def _get_mlflow_client() -> Any | None:
    if mlflow is None:
        return None
    mlflow.set_tracking_uri(MLFLOW_URI)
    return mlflow.MlflowClient(tracking_uri=MLFLOW_URI)


def _get_model_version(client: Any, model: ServingModel) -> Any | None:
    model_name = MODEL_REGISTRY_NAMES[model]
    alias = MODEL_ALIASES[model]
    try:
        return client.get_model_version_by_alias(model_name, alias)
    except Exception:
        try:
            versions = client.search_model_versions(f"name='{model_name}'")
        except Exception:
            return None
        if not versions:
            return None
        return max(versions, key=lambda item: int(item.version))


def _get_best_hpo_run(client: Any) -> tuple[float | None, dict[str, Any] | None]:
    if mlflow is None:
        return None, None
    try:
        runs = mlflow.search_runs(
            experiment_ids=None,
            filter_string="tags.hpo_study = 'true'",
            output_format="pandas",
            max_results=50,
            order_by=["metrics.best_cv_f1 DESC"],
            search_all_experiments=True,
        )
    except TypeError:
        try:
            runs = mlflow.search_runs(
                filter_string="tags.hpo_study = 'true'",
                output_format="pandas",
                max_results=50,
                order_by=["metrics.best_cv_f1 DESC"],
                search_all_experiments=True,
            )
        except Exception:
            return None, None
    except Exception:
        return None, None

    if runs is None or len(runs) == 0:
        return None, None

    best_row = runs.iloc[0].to_dict()
    best_value = best_row.get("metrics.best_cv_f1")
    return float(best_value) if best_value is not None else None, best_row


def _stringify_param(value: Any) -> str:
    if isinstance(value, float):
        return f"{value:.6g}"
    return str(value)


@router.get("/overview", response_model=ModelOverviewResponse)
def get_model_overview(
    model: ServingModel = Query(default="xgboost"),
) -> ModelOverviewResponse:
    config = _load_config(model)
    client = _get_mlflow_client()
    model_name = MODEL_REGISTRY_NAMES[model]
    model_alias = MODEL_ALIASES[model]

    champion_version = None
    champion_run_id = None
    champion_model_uri = None
    model_source = "config"
    last_loaded_at = None
    load_error = _mlflow_import_error

    if client is not None:
        mv = _get_model_version(client, model)
        if mv is not None:
            champion_version = str(mv.version)
            champion_run_id = getattr(mv, "run_id", None)
            source = getattr(mv, "source", None)
            champion_model_uri = source
            model_source = "mlflow"
            load_error = None
            created_at = getattr(mv, "creation_timestamp", None)
            last_loaded_at = _iso_from_timestamp(created_at)

    best_cv_f1, _best_hpo = (
        _get_best_hpo_run(client) if client is not None else (None, None)
    )

    return ModelOverviewResponse(
        model_key=model,
        model_name=model_name,
        model_alias=model_alias,
        champion_version=champion_version,
        champion_run_id=champion_run_id,
        champion_model_uri=champion_model_uri,
        best_cv_f1=best_cv_f1,
        current_threshold=PREDICT_THRESHOLD,
        model_source=model_source,
        last_loaded_at=last_loaded_at,
        load_error=load_error,
    )


@router.get("/architecture", response_model=ModelArchitectureResponse)
def get_model_architecture(
    model: ServingModel = Query(default="xgboost"),
) -> ModelArchitectureResponse:
    config = _load_config(model)
    model_config = config.get("model", {})
    features_config = config.get("features", {})
    training_features = list(features_config.get("training_features", []))
    categorical_features = [
        feature
        for feature in training_features
        if feature in {"brand", "category_code_level1", "category_code_level2"}
    ]
    numeric_features = [
        feature for feature in training_features if feature not in categorical_features
    ]

    return ModelArchitectureResponse(
        model_key=model,
        model_type=str(model_config.get("model_type", model)),
        model_label=str(model_config.get("name", MODEL_REGISTRY_NAMES[model])),
        description=model_config.get("description"),
        objective=model_config.get("parameters", {}).get("objective"),
        eval_metric=model_config.get("parameters", {}).get("eval_metric"),
        feature_count=len(training_features),
        numeric_feature_count=len(numeric_features),
        categorical_feature_count=len(categorical_features),
        train_test_split=model_config.get("train_test_split"),
        encoding_strategy="Target encoding for categoricals, native numeric pass-through",
        training_features=training_features,
        numeric_features=numeric_features,
        categorical_features=categorical_features,
    )


@router.get("/hyperparameters", response_model=ModelHyperparametersResponse)
def get_model_hyperparameters(
    model: ServingModel = Query(default="xgboost"),
) -> ModelHyperparametersResponse:
    config = _load_config(model)
    items: list[HyperparameterItem] = []
    source = "config"
    params: dict[str, Any] = dict(config.get("model", {}).get("parameters", {}))

    client = _get_mlflow_client()
    if client is not None:
        mv = _get_model_version(client, model)
        if mv is not None and getattr(mv, "run_id", None):
            try:
                run = client.get_run(mv.run_id)
            except Exception:
                run = None
            if run is not None and run.data.params:
                params = dict(run.data.params)
                source = "mlflow"

    for key, value in sorted(params.items()):
        items.append(
            HyperparameterItem(key=key, value=_stringify_param(value), source=source)
        )

    return ModelHyperparametersResponse(model_key=model, items=items)


@router.get("/lineage", response_model=ModelLineageResponse)
def get_model_lineage(
    model: ServingModel = Query(default="xgboost"),
) -> ModelLineageResponse:
    client = _get_mlflow_client()
    model_name = MODEL_REGISTRY_NAMES[model]
    versions: list[ModelLineageVersion] = []

    if client is None:
        return ModelLineageResponse(model_key=model, model_name=model_name, versions=[])

    try:
        raw_versions = client.search_model_versions(f"name='{model_name}'")
    except Exception:
        raw_versions = []

    for version in sorted(
        raw_versions, key=lambda item: int(item.version), reverse=True
    ):
        aliases = list(getattr(version, "aliases", []) or [])
        versions.append(
            ModelLineageVersion(
                version=str(version.version),
                aliases=aliases,
                stage=getattr(version, "current_stage", None),
                status=getattr(version, "status", None),
                run_id=getattr(version, "run_id", None),
                source=getattr(version, "source", None),
                created_at=_iso_from_timestamp(
                    getattr(version, "creation_timestamp", None)
                ),
            )
        )

    return ModelLineageResponse(
        model_key=model, model_name=model_name, versions=versions
    )

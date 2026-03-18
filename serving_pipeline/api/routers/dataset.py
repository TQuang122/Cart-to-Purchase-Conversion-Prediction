from __future__ import annotations

import os
from io import BytesIO
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

import numpy as np
import pandas as pd
from fastapi import APIRouter

try:
    import boto3
except Exception:
    boto3 = None

from api.schemas import (
    BrandConversionRateItem,
    CategoryCount,
    CategoricalDistributionSnapshot,
    DatasetConversionResponse,
    DatasetColumnProfile,
    DatasetProfileResponse,
    DatasetQualityResponse,
    DriftSummaryResponse,
    HistogramBin,
    NumericDistributionSnapshot,
)

try:
    import yaml  # type: ignore
except Exception:
    yaml = None

router = APIRouter(prefix="/dataset", tags=["dataset"])

os.environ.setdefault("AWS_ACCESS_KEY_ID", "minio")
os.environ.setdefault("AWS_SECRET_ACCESS_KEY", "minio123")
os.environ.setdefault("AWS_DEFAULT_REGION", "us-east-1")
os.environ.setdefault("MLFLOW_S3_ENDPOINT_URL", "http://localhost:9000")

PROJECT_ROOT = Path(__file__).resolve().parents[3]
XGBOOST_CONFIG_PATH = (
    PROJECT_ROOT / "model_pipeline" / "src" / "config" / "xgboost.yaml"
)
S3_DATASET_CANDIDATES = [
    os.getenv("DATASET_PROFILE_S3_URI"),
    os.getenv("TRAINING_DATA_S3_URI"),
    "s3://mlflow/datasets/train.parquet",
    "s3://mlflow/data/train.parquet",
    "s3://mlflow/feature_repo/data/train.parquet",
]
DATASET_CANDIDATES = [
    Path(os.getenv("DATASET_PROFILE_PATH", ""))
    if os.getenv("DATASET_PROFILE_PATH")
    else None,
    PROJECT_ROOT
    / "data_pipeline"
    / "propensity_feature_store"
    / "propensity_features"
    / "feature_repo"
    / "data"
    / "train.parquet",
    PROJECT_ROOT / "model_pipeline" / "src" / "data" / "training_data.csv",
]


def _load_config() -> dict[str, Any]:
    if yaml is None or not XGBOOST_CONFIG_PATH.exists():
        return {}
    with open(XGBOOST_CONFIG_PATH, "r", encoding="utf-8") as handle:
        return yaml.safe_load(handle) or {}


def _resolve_dataset_path() -> Path | None:
    for candidate in DATASET_CANDIDATES:
        if candidate and candidate.exists():
            return candidate
    return None


def _get_s3_client() -> Any | None:
    if boto3 is None:
        return None
    endpoint_url = os.getenv("DATASET_S3_ENDPOINT_URL") or os.getenv(
        "MLFLOW_S3_ENDPOINT_URL"
    )
    return boto3.client(
        "s3",
        endpoint_url=endpoint_url,
        aws_access_key_id=os.getenv("AWS_ACCESS_KEY_ID"),
        aws_secret_access_key=os.getenv("AWS_SECRET_ACCESS_KEY"),
        region_name=os.getenv("AWS_DEFAULT_REGION", "us-east-1"),
    )


def _parse_s3_uri(uri: str) -> tuple[str, str]:
    parsed = urlparse(uri)
    bucket = parsed.netloc
    key = parsed.path.lstrip("/")
    return bucket, key


def _load_dataset_from_s3() -> tuple[pd.DataFrame | None, str | None, str | None]:
    client = _get_s3_client()
    if client is None:
        return None, None, None

    for uri in S3_DATASET_CANDIDATES:
        if not uri:
            continue
        try:
            bucket, key = _parse_s3_uri(uri)
            response = client.get_object(Bucket=bucket, Key=key)
            payload = response["Body"].read()
            last_modified = response.get("LastModified")
            if key.lower().endswith((".parquet", ".pq")):
                frame = pd.read_parquet(BytesIO(payload))
            else:
                frame = pd.read_csv(BytesIO(payload))
            updated_at = (
                last_modified.astimezone(timezone.utc).isoformat()
                if last_modified
                else None
            )
            return frame, uri, updated_at
        except Exception:
            continue

    return None, None, None


def _load_dataset() -> tuple[pd.DataFrame | None, str, str | None]:
    s3_frame, s3_source, s3_updated_at = _load_dataset_from_s3()
    if s3_frame is not None and s3_source is not None:
        return s3_frame, s3_source, s3_updated_at

    dataset_path = _resolve_dataset_path()
    if dataset_path is None:
        return None, "config fallback", None
    if dataset_path.suffix.lower() in {".parquet", ".pq"}:
        return (
            pd.read_parquet(dataset_path),
            str(dataset_path),
            _iso_from_mtime(dataset_path),
        )
    return pd.read_csv(dataset_path), str(dataset_path), _iso_from_mtime(dataset_path)


def _iso_from_mtime(path: Path | None) -> str | None:
    if path is None or not path.exists():
        return None
    return datetime.fromtimestamp(path.stat().st_mtime, tz=timezone.utc).isoformat()


def _column_profiles(frame: pd.DataFrame) -> list[DatasetColumnProfile]:
    profiles: list[DatasetColumnProfile] = []
    total_rows = max(len(frame), 1)
    for column in frame.columns:
        missing_count = int(frame[column].isna().sum())
        profiles.append(
            DatasetColumnProfile(
                column=column,
                dtype=str(frame[column].dtype),
                missing_count=missing_count,
                missing_percent=(missing_count / total_rows) * 100,
            )
        )
    return profiles


def _build_numeric_distribution(
    frame: pd.DataFrame, column: str, bins: int = 8
) -> NumericDistributionSnapshot:
    series = pd.to_numeric(frame[column], errors="coerce").dropna()
    if series.empty:
        return NumericDistributionSnapshot(column=column)

    counts, edges = np.histogram(
        series.to_numpy(dtype=float), bins=min(bins, max(1, int(series.nunique())))
    )
    histogram_bins = [
        HistogramBin(
            label=f"{edges[idx]:.2f}-{edges[idx + 1]:.2f}", count=int(counts[idx])
        )
        for idx in range(len(counts))
    ]
    return NumericDistributionSnapshot(
        column=column,
        mean=float(series.mean()),
        median=float(series.median()),
        min=float(series.min()),
        max=float(series.max()),
        bins=histogram_bins,
    )


def _build_categorical_distribution(
    frame: pd.DataFrame, column: str, limit: int = 6
) -> CategoricalDistributionSnapshot:
    series = frame[column].fillna("<missing>").astype(str)
    top_counts = series.value_counts().head(limit)
    return CategoricalDistributionSnapshot(
        column=column,
        unique_count=int(series.nunique()),
        top_values=[
            CategoryCount(label=index, count=int(value))
            for index, value in top_counts.items()
        ],
    )


@router.get("/profile", response_model=DatasetProfileResponse)
def get_dataset_profile() -> DatasetProfileResponse:
    frame, dataset_source, dataset_updated_at = _load_dataset()
    config = _load_config()
    training_features = list(config.get("features", {}).get("training_features", []))
    categorical_features = [
        feature
        for feature in training_features
        if feature in {"brand", "category_code_level1", "category_code_level2"}
    ]
    numeric_features = [
        feature for feature in training_features if feature not in categorical_features
    ]
    if frame is None:
        return DatasetProfileResponse(
            dataset_available=False,
            dataset_source=dataset_source,
            rows=None,
            cols=len(training_features) if training_features else None,
            missing_percent=None,
            duplicate_rows=None,
            numeric_columns=len(numeric_features),
            categorical_columns=len(categorical_features),
            target_column=config.get("features", {}).get("target_column"),
            last_updated_at=dataset_updated_at,
            columns=[
                DatasetColumnProfile(
                    column=feature,
                    dtype="configured",
                    missing_count=0,
                    missing_percent=0,
                )
                for feature in training_features
            ],
        )

    missing_percent = float(
        frame.isna().sum().sum() / max(frame.shape[0] * max(frame.shape[1], 1), 1) * 100
    )
    duplicate_rows = int(frame.duplicated().sum())
    numeric_columns = int(frame.select_dtypes(include=[np.number]).shape[1])
    categorical_columns = int(frame.shape[1] - numeric_columns)

    return DatasetProfileResponse(
        dataset_available=True,
        dataset_source=dataset_source,
        rows=int(frame.shape[0]),
        cols=int(frame.shape[1]),
        missing_percent=missing_percent,
        duplicate_rows=duplicate_rows,
        numeric_columns=numeric_columns,
        categorical_columns=categorical_columns,
        target_column=config.get("features", {}).get("target_column"),
        last_updated_at=dataset_updated_at,
        columns=_column_profiles(frame),
    )


@router.get("/quality", response_model=DatasetQualityResponse)
def get_dataset_quality() -> DatasetQualityResponse:
    frame, dataset_source, _dataset_updated_at = _load_dataset()

    if frame is None:
        return DatasetQualityResponse(
            dataset_available=False,
            dataset_source=dataset_source,
            duplicate_rows=None,
            duplicate_percent=None,
            top_missing_columns=[],
            numeric_distributions=[],
            categorical_distributions=[],
            drift_summary=DriftSummaryResponse(
                status="not_configured",
                message="Reference dataset is not configured yet, so drift cannot be computed.",
                reference_label=None,
                monitored_columns=0,
                drifted_columns=0,
            ),
        )

    profiles = sorted(
        _column_profiles(frame), key=lambda item: item.missing_percent, reverse=True
    )
    total_rows = max(len(frame), 1)
    duplicate_rows = int(frame.duplicated().sum())
    numeric_columns = frame.select_dtypes(include=[np.number]).columns.tolist()[:4]
    categorical_columns = [
        column
        for column in [
            "brand",
            "category_code_level1",
            "category_code_level2",
            "event_weekday",
        ]
        if column in frame.columns
    ][:4]

    return DatasetQualityResponse(
        dataset_available=True,
        dataset_source=dataset_source,
        duplicate_rows=duplicate_rows,
        duplicate_percent=(duplicate_rows / total_rows) * 100,
        top_missing_columns=profiles[:8],
        numeric_distributions=[
            _build_numeric_distribution(frame, column) for column in numeric_columns
        ],
        categorical_distributions=[
            _build_categorical_distribution(frame, column)
            for column in categorical_columns
        ],
        drift_summary=DriftSummaryResponse(
            status="not_configured",
            message="Dataset drift baseline is not configured yet. Add a reference dataset to enable PSI or KS monitoring.",
            reference_label="Training baseline pending",
            monitored_columns=len(numeric_columns) + len(categorical_columns),
            drifted_columns=0,
        ),
    )


@router.get("/conversion", response_model=DatasetConversionResponse)
def get_dataset_conversion() -> DatasetConversionResponse:
    frame, dataset_source, _dataset_updated_at = _load_dataset()

    if frame is None:
        return DatasetConversionResponse(
            dataset_available=False,
            dataset_source=dataset_source,
            views=None,
            carts=None,
            purchases=None,
            brand_conversion_rate=[],
        )

    def _sum_int_column(name: str) -> int:
        if name not in frame.columns:
            return 0
        return int(pd.to_numeric(frame[name], errors="coerce").fillna(0).sum())

    event_col = "event_type" if "event_type" in frame.columns else None
    target_col = "is_purchased" if "is_purchased" in frame.columns else None

    if event_col is not None:
        event_series = frame[event_col].astype(str).str.lower().str.strip()
        views = int((event_series == "view").sum())
        carts = int((event_series == "cart").sum())
        purchases = int((event_series == "purchase").sum())
    else:
        views = _sum_int_column("product_total_views")
        carts = int(len(frame))
        if target_col is not None:
            target_series = pd.to_numeric(frame[target_col], errors="coerce").fillna(0)
            purchases = int((target_series > 0).sum())
        else:
            purchases = _sum_int_column("product_total_purchases")

    brand_items: list[BrandConversionRateItem] = []
    if "brand" in frame.columns:
        working = frame.copy()
        working["brand"] = working["brand"].fillna("unknown").astype(str)

        grouped = working.groupby("brand", dropna=False)
        for brand, group in grouped:
            brand_carts = int(len(group))
            if target_col is not None:
                target_series = pd.to_numeric(
                    group[target_col], errors="coerce"
                ).fillna(0)
                brand_purchases = int((target_series > 0).sum())
            else:
                purchase_rate_series = pd.to_numeric(
                    group.get("brand_purchase_rate", pd.Series([0] * len(group))),
                    errors="coerce",
                ).fillna(0)
                avg_rate = (
                    float(purchase_rate_series.mean())
                    if not purchase_rate_series.empty
                    else 0.0
                )
                brand_purchases = int(round(brand_carts * avg_rate))

            conversion_rate = (
                (brand_purchases / brand_carts) if brand_carts > 0 else 0.0
            )
            brand_items.append(
                BrandConversionRateItem(
                    brand=str(brand),
                    carts=brand_carts,
                    purchases=brand_purchases,
                    conversion_rate=conversion_rate,
                )
            )

        brand_items.sort(key=lambda item: item.carts, reverse=True)
        brand_items = brand_items[:10]

    return DatasetConversionResponse(
        dataset_available=True,
        dataset_source=dataset_source,
        views=views,
        carts=carts,
        purchases=purchases,
        brand_conversion_rate=brand_items,
    )

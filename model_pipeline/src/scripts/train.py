"""
Docstring for model_pipeline.src.scripts.train
Supports: XGBoost, LightGBM, CatBoost, TabICL
"""

from pathlib import Path
import argparse
import json
import os
import tempfile

import pandas as pd
from loguru import logger

import mlflow

from src.mlflow_utils.experiment_tracker import ExperimentTracker
from src.model.xgboost_trainer import GenericBinaryClassifierTrainer, TABICL_AVAILABLE
from src.utility.helper import load_config

#YQ|os.environ["AWS_ACCESS_KEY_ID"] = "minio"
#BY|os.environ["AWS_SECRET_ACCESS_KEY"] = "minio123"
#WH|os.environ["AWS_DEFAULT_REGION"] = "us-east-1"
#SM|os.environ["MLFLOW_S3_ENDPOINT_URL"] = os.environ.get(
#RW|    "MLFLOW_S3_ENDPOINT_URL",
#SZ|    "http://minio:9000",
#TK|)
#HQ|os.environ["MLFLOW_TRACKING_URI"] = os.environ.get(
#YQ|    "MLFLOW_TRACKING_URI",
#NV|    "http://localhost:5000",
#MX|)
#TX|
#KW|def main():
    parser = argparse.ArgumentParser(description="Train ML model")
    parser.add_argument(
        "--config",
        type=str,
        help="Path to config file",
    )

    parser.add_argument(
        "--training-data-path",
        type=str,
        default="data/training_data.csv",
        help="Path to training data",
    )

    parser.add_argument(
        "--experiment-name",
        type=str,
        default=None,
        help="MLflow experiment name",
    )

    parser.add_argument(
        "--run-name",
        type=str,
        default=None,
        help="MLflow run name",
    )

    parser.add_argument(
        "--best-params-path",
        type=str,
        default=None,
        help="Path to HPO best params JSON file",
    )

    parser.add_argument(
        "--sample-size",
        type=int,
        default=None,
        help="Number of rows to sample (for TabICL - recommended: 50K-75K)",
    )

    args = parser.parse_args()

    logger.info("Loading configuration...")
    config = load_config(args.config)

    model_type = config["model"]["model_type"]

    # Check TabICL availability
    if model_type == "tabicl" and not TABICL_AVAILABLE:
        raise ImportError("TabICL is not installed. Install with: pip install tabicl")

    # Load HPO best params if provided (skip for TabICL - no HPO needed)
    if args.best_params_path and model_type != "tabicl":
        best_params_path = Path(args.best_params_path)
        if best_params_path.exists():
            with open(best_params_path) as f:
                best_params = json.load(f)
            config["model"]["parameters"].update(best_params)
            logger.info(
                f"Loaded HPO best params from {args.best_params_path}: {best_params}"
            )

    if args.experiment_name:
        config["mlflow"]["experiment_name"] = args.experiment_name

    logger.info(f"Experiment name: {config['mlflow']['experiment_name']}")
    logger.info(f"Model type: {model_type}")

    logger.info("Initializing MLflow experiment tracker...")
    tracker = ExperimentTracker(
        tracking_uri=config["mlflow"]["tracking_uri"],
        experiment_name=config["mlflow"]["experiment_name"],
        artifact_location=config["mlflow"].get("artifact_location"),
    )

    logger.info(f"Loading training data from {args.training_data_path=}")
    data_path = Path(args.training_data_path)

    if data_path.suffix.lower() == ".csv":
        data = pd.read_csv(data_path)
    elif data_path.suffix.lower() in [".parquet", ".pq"]:
        data = pd.read_parquet(data_path)
    else:
        supported_formats = [".csv", ".parquet", ".pq"]
        raise ValueError(
            f"Unsupported file format: {data_path.suffix}. "
            f"Supported formats are: {supported_formats}"
        )
    logger.info(f"Loaded {len(data)} samples with {len(data.columns)} features")

    # Sample data if specified (recommended for TabICL)
    if args.sample_size and args.sample_size < len(data):
        logger.info(f"Sampling {args.sample_size:,} rows from {len(data):,} rows")
        data = data.sample(n=args.sample_size, random_state=42).reset_index(drop=True)
        logger.info(f"Sampled dataset shape: {data.shape}")

    raw_data = data.copy()

    # TabICL handles categorical features automatically - no target encoding needed
    # For other models, use target encoding
    if model_type == "tabicl":
        # TabICL: no encoding needed, keep raw data
        target_col = config["features"]["target_column"]
        feature_cols = config["features"]["training_features"]
        encoders = {}
        # Remove datetime columns
        datetime_cols = []
        for col in feature_cols:
            if "datetime" in str(data[col].dtype):
                datetime_cols.append(col)
        feature_cols = [col for col in feature_cols if col not in datetime_cols]
        logger.info(f"Removed datetime columns: {datetime_cols}")
    else:
        # XGBoost/LightGBM/CatBoost: target encoding
        target_col = config["features"]["target_column"]
        feature_cols = config["features"]["training_features"]

        # Handle datetime columns
        datetime_cols = []
        for col in feature_cols:
            if col in data.columns and "datetime" in str(data[col].dtype):
                datetime_cols.append(col)
        feature_cols = [col for col in feature_cols if col not in datetime_cols]

        cols_to_encode = (
            data[feature_cols]
            .select_dtypes(include=["object", "category"])
            .columns.tolist()
        )
        global_mean = data[target_col].mean() if target_col in data.columns else 0.26
        SMOOTHING = 20

        encoders = {}
        for col in cols_to_encode:
            logger.info(f"Target encoding column: {col}")
            group_stats = data.groupby(col)[target_col].agg(["mean", "count"])
            smoothed_means = (
                group_stats["count"] * group_stats["mean"] + SMOOTHING * global_mean
            ) / (group_stats["count"] + SMOOTHING)
            data[col] = data[col].map(smoothed_means).fillna(global_mean)
            encoders[col] = {
                "mapping": smoothed_means.to_dict(),
                "global_mean": global_mean,
            }

    target_encoder = None
    feature_encoders = encoders

    trainer = GenericBinaryClassifierTrainer(
        config=config["model"],
        experiment_tracker=tracker,
        model_type=model_type,
    )

    tags: dict = config["mlflow"]["tags"]
    with tracker.start_run(
        run_name=args.run_name,
        tags=tags,
    ) as run:
        logger.info(f"Started MLflow run: {run.info.run_id}")

        dtrain, dval, y_train, y_val = trainer.prepare_data(
            data=data,
            target_col=target_col,
            feature_cols=feature_cols,
            test_size=config["model"]["train_test_split"],
            random_state=config["model"]["random_state"],
        )

        train_params = config["model"]["parameters"]

        # Auto-detect device for TabICL: fall back to CPU if CUDA unavailable
        if model_type == "tabicl" and train_params.get("device") == "cuda":
            try:
                import torch
                if not torch.cuda.is_available():
                    logger.warning("CUDA not available, falling back to device='cpu' for TabICL")
                    train_params["device"] = "cpu"
            except ImportError:
                logger.warning("PyTorch not found, falling back to device='cpu' for TabICL")
                train_params["device"] = "cpu"

        logger.info(f"Training with params: {train_params}")
        trainer.train(
            X_train=dtrain,
            y_train=y_train,
            X_test=dval,
            y_test=y_val,
            params=train_params,
        )

        trainer.save_model(
            model_name=config["model"]["name"],
            input_example=raw_data[feature_cols].head(5),
            label_encoder=target_encoder,
            feature_encoders=feature_encoders,
        )

        # Log encoder classes as artifact so serving can rebuild TargetEncoders
        encoder_classes = {}
        for col, encoder_info in feature_encoders.items():
            if isinstance(encoder_info, dict) and "mapping" in encoder_info:
                encoder_classes[col] = encoder_info
            else:
                encoder_classes[col] = {
                    "classes": encoder_info.classes_.tolist()
                    if hasattr(encoder_info, "classes_")
                    else []
                }

        with tempfile.TemporaryDirectory() as tmpdir:
            named_path = os.path.join(tmpdir, "encoder_classes.json")
            with open(named_path, "w") as f:
                json.dump(encoder_classes, f)
            mlflow.log_artifact(named_path, artifact_path="")

        logger.info("=" * 60)
        logger.info("TRAINING COMPLETE")
        logger.info(f"Run ID: {run.info.run_id}")


if __name__ == "__main__":
    main()

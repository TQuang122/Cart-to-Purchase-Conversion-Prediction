"""
Docstring for model_pipeline.src.scripts.train
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
from src.model.xgboost_trainer import GenericBinaryClassifierTrainer
from src.utility.helper import load_config

os.environ["AWS_ACCESS_KEY_ID"] = "minio"
os.environ["AWS_SECRET_ACCESS_KEY"] = "minio123"
os.environ["AWS_DEFAULT_REGION"] = "us-east-1"
os.environ["MLFLOW_S3_ENDPOINT_URL"] = os.environ.get(
    "MLFLOW_S3_ENDPOINT_URL",
    "http://minio:9000",
)


def main():
    parser = argparse.ArgumentParser(description="Train XGBoost model")
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

    args = parser.parse_args()

    logger.info("Loading configuration...")
    config = load_config(args.config)

    # Load HPO best params if provided
    if args.best_params_path:
        best_params_path = Path(args.best_params_path)
        if best_params_path.exists():
            with open(best_params_path) as f:
                best_params = json.load(f)
            # Merge with config parameters
            config["model"]["parameters"].update(best_params)
            logger.info(
                f"Loaded HPO best params from {args.best_params_path}: {best_params}"
            )

    if args.experiment_name:
        config["mlflow"]["experiment_name"] = args.experiment_name

    logger.info(f"Experiment name: {config['mlflow']['experiment_name']}")

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

    raw_data = data.copy()

    # Target encoding for categorical columns
    target_col = config["features"]["target_column"]
    feature_cols = config["features"]["training_features"]
    cols_to_encode = data.select_dtypes(include=["object", "category"]).columns.tolist()
    global_mean = data[target_col].mean() if target_col in data.columns else 0.26
    SMOOTHING = 20  # smoothing factor for target encoding

    # Initialize encoders dict for target encoding
    encoders = {}

    # Target encoding: encode categorical by mean of target (purchase rate)
    # This captures brand affinity better than ordinal LabelEncoder
    for col in cols_to_encode:
        logger.info(f"Target encoding column: {col}")
        # Calculate target mean per category with smoothing
        group_stats = data.groupby(col)[target_col].agg(["mean", "count"])
        smoothed_means = (
            group_stats["count"] * group_stats["mean"] + SMOOTHING * global_mean
        ) / (group_stats["count"] + SMOOTHING)
        # Encode with smoothed target mean (float)
        data[col] = data[col].map(smoothed_means).fillna(global_mean)
        # Store mapping for serving (category -> target_mean)
        encoders[col] = {
            "mapping": smoothed_means.to_dict(),
            "global_mean": global_mean,
        }

    target_encoder = None  # target column not used for features
    feature_encoders = encoders

    trainer = GenericBinaryClassifierTrainer(
        config=config["model"],
        experiment_tracker=tracker,
        model_type=config["model"]["model_type"],
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
        # feature_encoders now contains: {col: {'mapping': {category: target_mean}, 'global_mean': float}}
        encoder_classes = {}
        for col, encoder_info in feature_encoders.items():
            if isinstance(encoder_info, dict) and "mapping" in encoder_info:
                encoder_classes[col] = encoder_info
            else:
                # Fallback for legacy LabelEncoder format
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

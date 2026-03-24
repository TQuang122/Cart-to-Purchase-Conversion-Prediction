"""
Optuna hyperparameter optimisation for XGBoost cart-to-purchase model.

Usage (standalone):
    python hpo.py --config ../config/xgboost.yaml \
                  --training-data-path ../../data_pipeline/.../train.parquet \
                  --n-trials 50 \
                  --output-params-path /tmp/best_params.json

The script:
  1. Loads a stratified sub-sample of training data (fast objective function).
  2. Runs N Optuna trials; each trial is logged as an MLflow child run.
  3. Writes best hyperparams to --output-params-path (JSON).
  4. Logs best params + best F1 on the parent MLflow run so the DAG can track it.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

import mlflow
import numpy as np
import optuna
import pandas as pd
from loguru import logger
from sklearn.metrics import f1_score
from sklearn.model_selection import StratifiedKFold
from sklearn.preprocessing import LabelEncoder
from xgboost import XGBClassifier

from src.utility.helper import load_config

# ── env defaults (same as train.py) ──────────────────────────────────────────
os.environ.setdefault("AWS_ACCESS_KEY_ID", "minio")
os.environ.setdefault("AWS_SECRET_ACCESS_KEY", "minio123")
os.environ.setdefault("AWS_DEFAULT_REGION", "us-east-1")
os.environ.setdefault("MLFLOW_S3_ENDPOINT_URL", "http://minio:9000")

# ── constants ─────────────────────────────────────────────────────────────────
# Sub-sample size for HPO trials. Using 1M rows for better approximation.
# 1M rows with 5-fold CV gives robust estimation while keeping reasonable runtime.
HPO_SAMPLE_SIZE = 1_000_000
CV_FOLDS = 5          # stratified k-fold folds per trial
RANDOM_STATE = 42


# ── search space ─────────────────────────────────────────────────────────────
def _suggest_params(trial: optuna.Trial) -> dict:
    """Define the Optuna search space for XGBoost."""
    n_estimators = trial.suggest_int("n_estimators", 100, 600, step=50)
    max_depth = trial.suggest_int("max_depth", 3, 10)
    learning_rate = trial.suggest_float("learning_rate", 0.01, 0.3, log=True)
    subsample = trial.suggest_float("subsample", 0.5, 1.0)
    colsample_bytree = trial.suggest_float("colsample_bytree", 0.4, 1.0)
    min_child_weight = trial.suggest_int("min_child_weight", 1, 20)
    gamma = trial.suggest_float("gamma", 0.0, 2.0)
    reg_alpha = trial.suggest_float("reg_alpha", 1e-4, 10.0, log=True)
    reg_lambda = trial.suggest_float("reg_lambda", 1e-4, 10.0, log=True)
    scale_pos_weight = trial.suggest_float("scale_pos_weight", 1.0, 10.0)

    return {
        "n_estimators": n_estimators,
        "max_depth": max_depth,
        "learning_rate": learning_rate,
        "subsample": subsample,
        "colsample_bytree": colsample_bytree,
        "min_child_weight": min_child_weight,
        "gamma": gamma,
        "reg_alpha": reg_alpha,
        "reg_lambda": reg_lambda,
        "scale_pos_weight": scale_pos_weight,
        "objective": "binary:logistic",
        "eval_metric": "logloss",
        "n_jobs": -1,
        "random_state": RANDOM_STATE,
        "use_label_encoder": False,
    }


# ── objective ────────────────────────────────────────────────────────────────
def _make_objective(
    X: np.ndarray,
    y: np.ndarray,
    parent_run_id: str,
    tracking_uri: str,
    experiment_name: str,
):
    """Return an Optuna objective closure over the dataset."""

    def objective(trial: optuna.Trial) -> float:
        params = _suggest_params(trial)

        # Log each trial as an MLflow nested run
        mlflow.set_tracking_uri(tracking_uri)
        with mlflow.start_run(
            run_name=f"hpo_trial_{trial.number:03d}",
            nested=True,
            tags={"hpo": "true", "trial": str(trial.number)},
        ):
            mlflow.log_params(params)

            skf = StratifiedKFold(n_splits=CV_FOLDS, shuffle=True, random_state=RANDOM_STATE)
            fold_f1s: list[float] = []

            for fold_idx, (train_idx, val_idx) in enumerate(skf.split(X, y)):
                X_tr, X_val = X[train_idx], X[val_idx]
                y_tr, y_val = y[train_idx], y[val_idx]

                clf = XGBClassifier(**params)
                clf.fit(
                    X_tr,
                    y_tr,
                    eval_set=[(X_val, y_val)],
                    verbose=False,
                )
                preds = clf.predict(X_val)
                fold_f1 = f1_score(y_val, preds, average="binary")
                fold_f1s.append(fold_f1)
                mlflow.log_metric(f"fold_{fold_idx}_f1", fold_f1, step=fold_idx)

                # Pruning: report intermediate value after each fold
                trial.report(float(np.mean(fold_f1s)), step=fold_idx)
                if trial.should_prune():
                    raise optuna.exceptions.TrialPruned()

            mean_f1 = float(np.mean(fold_f1s))
            mlflow.log_metric("cv_mean_f1", mean_f1)
            mlflow.log_metric("cv_std_f1", float(np.std(fold_f1s)))

        return mean_f1

    return objective


# ── data loading + encoding ───────────────────────────────────────────────────
def _load_and_encode(data_path: Path, feature_cols: list[str], target_col: str) -> tuple:
    """Load parquet/csv, encode categoricals, return (X, y) as numpy arrays."""
    logger.info(f"Loading data from {data_path} ...")
    if data_path.suffix.lower() in (".parquet", ".pq"):
        data = pd.read_parquet(data_path)
    else:
        data = pd.read_csv(data_path)

    logger.info(f"Loaded {len(data):,} rows")

    # Stratified sub-sample for fast HPO
    if len(data) > HPO_SAMPLE_SIZE:
        logger.info(f"Sub-sampling to {HPO_SAMPLE_SIZE:,} rows (stratified) ...")
        from sklearn.model_selection import train_test_split

        _, data = train_test_split(
            data,
            test_size=HPO_SAMPLE_SIZE / len(data),
            stratify=data[target_col],
            random_state=RANDOM_STATE,
        )
        logger.info(f"Sub-sample size: {len(data):,}")

    # Encode categoricals
    cat_cols = data[feature_cols].select_dtypes(include=["object", "category"]).columns.tolist()
    for col in cat_cols:
        le = LabelEncoder()
        data[col] = le.fit_transform(data[col].astype(str))

    X = data[feature_cols].to_numpy(dtype=np.float32)
    y = data[target_col].to_numpy(dtype=np.int32)
    logger.info(f"Class distribution: {dict(zip(*np.unique(y, return_counts=True)))}")
    return X, y


# ── main ──────────────────────────────────────────────────────────────────────
def main():
    parser = argparse.ArgumentParser(description="Optuna HPO for XGBoost CTP model")
    parser.add_argument("--config", type=str, required=True, help="Path to xgboost.yaml")
    parser.add_argument("--training-data-path", type=str, required=True, help="Path to train parquet/csv")
    parser.add_argument("--n-trials", type=int, default=50, help="Number of Optuna trials")
    parser.add_argument(
        "--output-params-path",
        type=str,
        required=True,
        help="Path to write best_params JSON (read by train.py)",
    )
    parser.add_argument(
        "--experiment-name",
        type=str,
        default=None,
        help="MLflow experiment name (overrides config)",
    )
    parser.add_argument(
        "--timeout",
        type=int,
        default=None,
        help="Optuna study timeout in seconds (None = no limit)",
    )
    args = parser.parse_args()

    config = load_config(args.config)
    tracking_uri = config["mlflow"]["tracking_uri"]
    experiment_name = args.experiment_name or config["mlflow"]["experiment_name"]
    target_col: str = config["features"]["target_column"]
    feature_cols: list[str] = config["features"]["training_features"]

    mlflow.set_tracking_uri(tracking_uri)
    mlflow.set_experiment(experiment_name)

    X, y = _load_and_encode(Path(args.training_data_path), feature_cols, target_col)

    # ── parent MLflow run wrapping the whole HPO study ────────────────────────
    with mlflow.start_run(run_name="hpo_optuna_study", tags={"hpo_study": "true"}) as parent_run:
        parent_run_id = parent_run.info.run_id
        mlflow.log_param("n_trials", args.n_trials)
        mlflow.log_param("sample_size", len(X))
        mlflow.log_param("cv_folds", CV_FOLDS)

        # Optuna: MedianPruner removes clearly bad trials early
        sampler = optuna.samplers.TPESampler(seed=RANDOM_STATE)
        pruner = optuna.pruners.MedianPruner(n_startup_trials=5, n_warmup_steps=1)
        study = optuna.create_study(
            direction="maximize",
            sampler=sampler,
            pruner=pruner,
            study_name=f"xgboost_ctp_hpo_{parent_run_id[:8]}",
        )

        objective = _make_objective(X, y, parent_run_id, tracking_uri, experiment_name)

        logger.info(f"Starting Optuna HPO: {args.n_trials} trials, timeout={args.timeout}s")
        study.optimize(
            objective,
            n_trials=args.n_trials,
            timeout=args.timeout,
            show_progress_bar=True,
            callbacks=[],
        )

        best_trial = study.best_trial
        best_params = best_trial.params
        # Add fixed params that are not tuned
        best_params["objective"] = "binary:logistic"
        best_params["eval_metric"] = "logloss"
        best_params["n_jobs"] = -1
        best_params["random_state"] = RANDOM_STATE
        best_params["use_label_encoder"] = False

        logger.info(f"Best trial: #{best_trial.number}  F1={best_trial.value:.4f}")
        logger.info(f"Best params: {best_params}")

        # Log best results on parent run
        mlflow.log_metric("best_cv_f1", best_trial.value)
        mlflow.log_params({f"best_{k}": v for k, v in best_trial.params.items()})

        # Write JSON for train.py to consume
        out_path = Path(args.output_params_path)
        out_path.parent.mkdir(parents=True, exist_ok=True)
        with open(out_path, "w") as f:
            json.dump(best_params, f, indent=2)
        logger.info(f"Best params written to {out_path}")

        # Also log the JSON as MLflow artifact
        mlflow.log_artifact(str(out_path), artifact_path="hpo")

        logger.info("=" * 60)
        logger.info("HPO COMPLETE")
        logger.info(f"Best F1 (CV): {best_trial.value:.4f}")
        logger.info(f"Trials completed: {len(study.trials)}")
        logger.info(f"Pruned trials: {len([t for t in study.trials if t.state == optuna.trial.TrialState.PRUNED])}")
        logger.info(f"Output: {out_path}")


if __name__ == "__main__":
    main()

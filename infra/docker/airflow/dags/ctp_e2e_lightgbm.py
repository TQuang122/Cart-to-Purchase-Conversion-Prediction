"""
End-to-end Airflow DAG for cart-to-purchase pipeline - LightGBM.
Manual trigger only. LightGBM training + evaluation + registry promotion.

Repo path in container: /opt/airflow
"""

from __future__ import annotations

from datetime import datetime
import re
import os
import subprocess
from pathlib import Path

from airflow import DAG
from airflow.providers.standard.operators.bash import BashOperator
from airflow.providers.standard.operators.empty import EmptyOperator
from airflow.providers.standard.operators.python import (
    BranchPythonOperator,
    PythonOperator,
)


REPO_ROOT = "/opt/airflow"
DATA_DIR = f"{REPO_ROOT}/data_pipeline/propensity_feature_store/propensity_features/feature_repo/data"
DATA_PIPELINE_DIR = f"{REPO_ROOT}/data_pipeline/scripts"
MODEL_PIPELINE_DIR = f"{REPO_ROOT}/model_pipeline"
MODEL_SCRIPTS_DIR = f"{MODEL_PIPELINE_DIR}/src/scripts"
MODEL_CONFIG = f"{MODEL_PIPELINE_DIR}/src/config/lightgbm.yaml"

TRAIN_DATA = f"{DATA_DIR}/train.parquet"
TEST_DATA = f"{DATA_DIR}/test.parquet"
FULL_DATA = f"{DATA_DIR}/processed_purchase_propensity_data_v2.parquet"

PREDICTION_OUTPUT = f"{MODEL_PIPELINE_DIR}/prediction_folder/predictions.csv"

MODEL_NAME = "lightgbm_ctp"
ALIAS_NAME = "staging"


DEFAULT_ENV = {
    "AWS_ACCESS_KEY_ID": "minio",
    "AWS_SECRET_ACCESS_KEY": "minio123",
    "AWS_DEFAULT_REGION": "us-east-1",
    "MLFLOW_S3_ENDPOINT_URL": "http://minio:9000",
    "MLFLOW_TRACKING_URI": "http://mlflow_server:5000",
    "PYTHONPATH": MODEL_PIPELINE_DIR,
    "JAVA_HOME": "/usr/lib/jvm/java-17-openjdk",
    "SPARK_DRIVER_MEMORY": "4g",
    "SPARK_SHUFFLE_PARTITIONS": "50",
    "SPARK_MAX_RESULT_SIZE": "2g",
}


def _extract_run_id_from_output(output_path: str, **context):
    """Parse run_id from train log file and push to XCom."""
    run_id = None
    log_path = Path(output_path)
    if not log_path.exists():
        raise FileNotFoundError(f"Training log not found: {output_path}")

    for line in log_path.read_text().splitlines():
        if "Run ID:" in line:
            run_id = line.split("Run ID:", 1)[1].strip()
            break

        match = re.search(r"/runs/([a-f0-9]{32})", line)
        if match:
            run_id = match.group(1)
            break

    if not run_id:
        raise RuntimeError("Failed to parse run_id from training output")

    context["ti"].xcom_push(key="run_id", value=run_id)


def _fetch_latest_version(**context):
    """Fetch latest model version using search_model_versions (MLflow 3.x compatible)."""
    import mlflow

    mlflow.set_tracking_uri(DEFAULT_ENV["MLFLOW_TRACKING_URI"])
    client = mlflow.MlflowClient()
    versions = client.search_model_versions(f"name='{MODEL_NAME}'")
    if not versions:
        raise RuntimeError(f"No versions found for model {MODEL_NAME}")

    latest_version = max(versions, key=lambda v: int(v.version)).version
    context["ti"].xcom_push(key="model_version", value=latest_version)


def _run_split_train_test():
    """Run train/test split script."""
    train_path = Path(TRAIN_DATA)
    test_path = Path(TEST_DATA)
    if train_path.exists() and test_path.exists():
        return

    env = os.environ.copy()
    env.update(DEFAULT_ENV)
    subprocess.run(
        [
            "python",
            f"{DATA_PIPELINE_DIR}/split_train_test.py",
            "--input",
            FULL_DATA,
            "--output-dir",
            DATA_DIR,
            "--test-size",
            "0.2",
            "--random-state",
            "42",
        ],
        check=True,
        env=env,
    )


def _should_promote(**context):
    """Branch: promote only if validation_passed tag is true on the eval run."""
    import mlflow

    run_id = context["ti"].xcom_pull(key="run_id", task_ids="extract_run_id")
    if not run_id:
        return "skip_promote"

    mlflow.set_tracking_uri(DEFAULT_ENV["MLFLOW_TRACKING_URI"])
    client = mlflow.MlflowClient()

    # Get all experiment IDs (MLflow 3.x requires list, not None)
    all_experiments = client.search_experiments()
    experiment_ids = [exp.experiment_id for exp in all_experiments]

    # Search for eval runs that reference this training run via tag
    runs = client.search_runs(
        experiment_ids=experiment_ids,
        filter_string=f"tags.source_run_id = '{run_id}' AND tags.task = 'model_evaluation'",
        order_by=["end_time DESC"],
        max_results=5,
    )

    if not runs:
        # Fallback: search across all experiments without task filter
        runs = client.search_runs(
            experiment_ids=experiment_ids,
            filter_string=f"tags.source_run_id = '{run_id}'",
            order_by=["end_time DESC"],
            max_results=5,
        )

    if not runs:
        return "skip_promote"

    latest = runs[0]
    validation_flag = str(latest.data.tags.get("validation_passed", "false")).lower()

    if validation_flag == "true":
        return "promote_model"

    return "skip_promote"


with DAG(
    dag_id="cart_to_purchase_e2e_lightgbm",
    description="End-to-end cart-to-purchase pipeline - LightGBM (manual trigger)",
    start_date=datetime(2024, 1, 1),
    schedule=None,
    catchup=False,
    default_args={
        "retries": 0,
    },
    tags=["cart-to-purchase", "mlops", "lightgbm"],
) as dag:
    split_train_test = PythonOperator(
        task_id="split_train_test",
        python_callable=_run_split_train_test,
    )

    skip_hpo = EmptyOperator(task_id="skip_hpo")

    train_model = BashOperator(
        task_id="train_lightgbm",
        bash_command=(
            "set -euo pipefail && "
            f"mkdir -p {MODEL_PIPELINE_DIR}/logs && "
            f"LOG_TMP=/tmp/train_run_{{{{ run_id | replace(':', '_') | replace('+', '_') | replace(' ', '_') }}}}.log && "
            f"python {MODEL_SCRIPTS_DIR}/train.py "
            f"--config {MODEL_CONFIG} "
            f"--training-data-path {TRAIN_DATA} "
            f"--run-name lightgbm_airflow_{{{{ run_id | replace(':', '_') | replace('+', '_') | replace(' ', '_') }}}} "
            '2>&1 | tee "$LOG_TMP" && '
            f'cp "$LOG_TMP" {MODEL_PIPELINE_DIR}/logs/train_run.log'
        ),
        env=DEFAULT_ENV,
    )

    extract_run_id = PythonOperator(
        task_id="extract_run_id",
        python_callable=_extract_run_id_from_output,
        op_kwargs={"output_path": f"{MODEL_PIPELINE_DIR}/logs/train_run.log"},
    )

    eval_model = BashOperator(
        task_id="evaluate_model",
        bash_command=(
            f"python {MODEL_SCRIPTS_DIR}/eval.py "
            f"--config {MODEL_CONFIG} "
            f"--run-id {{{{ ti.xcom_pull(task_ids='extract_run_id', key='run_id') }}}} "
            f"--eval-data-path {TEST_DATA} "
            f"--output-path-prediction {PREDICTION_OUTPUT} "
            "--validate-thresholds"
        ),
        env=DEFAULT_ENV,
    )

    register_model = BashOperator(
        task_id="register_model",
        bash_command=(
            f"python {MODEL_SCRIPTS_DIR}/register_model.py "
            f"--config {MODEL_CONFIG} "
            "register --run-id {{ ti.xcom_pull(task_ids='extract_run_id', key='run_id') }} "
            f"--model-name {MODEL_NAME}"
        ),
        env=DEFAULT_ENV,
    )

    fetch_model_version = PythonOperator(
        task_id="fetch_model_version",
        python_callable=_fetch_latest_version,
    )

    set_alias = BashOperator(
        task_id="set_alias",
        bash_command=(
            f"python {MODEL_SCRIPTS_DIR}/register_model.py "
            f"--config {MODEL_CONFIG} "
            f"set-alias --model-name {MODEL_NAME} "
            "--version {{ ti.xcom_pull(task_ids='fetch_model_version', key='model_version') }} "
            f"--alias {ALIAS_NAME}"
        ),
        env=DEFAULT_ENV,
    )

    branch_promote = BranchPythonOperator(
        task_id="branch_promote",
        python_callable=_should_promote,
    )

    promote_model = BashOperator(
        task_id="promote_model",
        bash_command=(
            f"python {MODEL_SCRIPTS_DIR}/register_model.py "
            f"--config {MODEL_CONFIG} "
            f"promote --model-name {MODEL_NAME} "
            "--version {{ ti.xcom_pull(task_ids='fetch_model_version', key='model_version') }}"
        ),
        env=DEFAULT_ENV,
    )

    skip_promote = EmptyOperator(task_id="skip_promote")

    split_train_test >> skip_hpo >> train_model >> extract_run_id
    extract_run_id >> eval_model >> register_model >> fetch_model_version >> set_alias
    set_alias >> branch_promote
    branch_promote >> [promote_model, skip_promote]

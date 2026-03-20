"""
Cart-to-Purchase XGBoost Training DAG for K8s Airflow.
"""
from __future__ import annotations

import re
from datetime import datetime
from pathlib import Path

from airflow import DAG
from airflow.operators.bash import BashOperator
from airflow.operators.empty import EmptyOperator
from airflow.operators.python import PythonOperator
from kubernetes import client as k8s

REPO_ROOT = "/opt/airflow"
DATA_DIR = f"{REPO_ROOT}/data_pipeline/propensity_feature_store/propensity_features/feature_repo/data"
MODEL_PIPELINE_DIR = f"{REPO_ROOT}/model_pipeline"
MODEL_SCRIPTS_DIR = f"{MODEL_PIPELINE_DIR}/src/scripts"
MODEL_CONFIG = f"{MODEL_PIPELINE_DIR}/src/config/config_k8s.yaml"

TRAIN_DATA = f"{DATA_DIR}/train.parquet"
MODEL_NAME = "purchase_propensity_model"
ALIAS_NAME = "staging"

PG_CONN = "postgresql+psycopg2://airflow:airflow123@airflow-postgres:5432/airflow"

# Install Python dependencies (libgomp1 pre-mounted via hostPath on KinD node)
PY_DEPS = (
    "pip install loguru mlflow boto3 xgboost pandas pyarrow scikit-learn "
    "numpy lightgbm catboost --quiet --root-user-action=ignore"
)
INSTALL_DEPS = PY_DEPS

DEFAULT_ENV = {
    "AWS_ACCESS_KEY_ID": "minio",
    "AWS_SECRET_ACCESS_KEY": "minio123",
    "AWS_DEFAULT_REGION": "us-east-1",
    "MLFLOW_S3_ENDPOINT_URL": "http://minio.mlops.svc.cluster.local:9000",
    "MLFLOW_TRACKING_URI": "http://mlflow.mlops.svc.cluster.local:5000",
    "PYTHONPATH": MODEL_PIPELINE_DIR,
}


def make_pod_override() -> k8s.V1Pod:
    return k8s.V1Pod(
        spec=k8s.V1PodSpec(
            containers=[
                k8s.V1Container(
                    name="base",
                    env=[
                        k8s.V1EnvVar(
                            name="AIRFLOW__DATABASE__SQL_ALCHEMY_CONN",
                            value=PG_CONN,
                        ),
                    ],
                    volume_mounts=[
                        k8s.V1VolumeMount(
                            name="airflow-home", mount_path="/opt/airflow"
                        ),
                        k8s.V1VolumeMount(name="logs", mount_path="/opt/airflow/logs"),
                        k8s.V1VolumeMount(
                            name="libgomp", mount_path="/usr/lib/aarch64-linux-gnu"
                        ),
                    ],
                )
            ],
            volumes=[
                k8s.V1Volume(
                    name="airflow-home",
                    persistent_volume_claim=k8s.V1PersistentVolumeClaimVolumeSource(
                        claim_name="airflow-dags-pvc"
                    ),
                ),
                k8s.V1Volume(
                    name="logs",
                    persistent_volume_claim=k8s.V1PersistentVolumeClaimVolumeSource(
                        claim_name="airflow-logs-pvc"
                    ),
                ),
                k8s.V1Volume(
                    name="libgomp",
                    host_path=k8s.V1HostPathVolumeSource(
                        path="/usr/lib/aarch64-linux-gnu",
                        type="Directory",
                    ),
                ),
            ],
        )
    )


def _extract_run_id_from_output(output_path: str, **context):
    log_path = Path(output_path)
    if not log_path.exists():
        raise FileNotFoundError(f"Training log not found: {output_path}")

    run_id = None
    for line in log_path.read_text().splitlines():
        if "Run ID:" in line:
            run_id = line.split("Run ID:", 1)[1].strip()
            break
        match = re.search(r"run_id=([a-f0-9]{32})", line)
        if match:
            run_id = match.group(1)
            break
        match = re.search(r"/runs/([a-f0-9]{32})", line)
        if match:
            run_id = match.group(1)
            break

    if not run_id:
        raise RuntimeError("Failed to parse run_id from training output")

    context["ti"].xcom_push(key="run_id", value=run_id)


def _fetch_latest_version(**context):
    import mlflow

    mlflow.set_tracking_uri(DEFAULT_ENV["MLFLOW_TRACKING_URI"])
    client = mlflow.MlflowClient()
    versions = client.search_model_versions(f"name='{MODEL_NAME}'")
    if not versions:
        raise RuntimeError(f"No versions found for model {MODEL_NAME}")
    latest_version = max(versions, key=lambda v: int(v.version)).version
    context["ti"].xcom_push(key="model_version", value=latest_version)


with DAG(
    dag_id="cart_to_purchase_k8s",
    description="Cart-to-purchase XGBoost training on K8s MLflow",
    start_date=datetime(2024, 1, 1),
    schedule=None,
    catchup=False,
    default_args={"retries": 0},
    tags=["cart-to-purchase", "mlops", "kubernetes"],
) as dag:
    start = EmptyOperator(task_id="start")

    train_xgboost = BashOperator(
        task_id="train_xgboost",
        bash_command=(
            f"{INSTALL_DEPS} && "
            f"mkdir -p {MODEL_PIPELINE_DIR}/logs && "
            f"LOG_TMP=/tmp/train_run_$(date +%s).log && "
            f"python {MODEL_SCRIPTS_DIR}/train.py "
            f"--config {MODEL_CONFIG} "
            f"--training-data-path {TRAIN_DATA} "
            f"--run-name xgboost_k8s_airflow_$(date +%s) "
            f'> "$LOG_TMP" 2>&1; '
            f"EXIT=$?; "
            f'cat "$LOG_TMP"; '
            f'cp "$LOG_TMP" {MODEL_PIPELINE_DIR}/logs/train_run.log; '
            f"exit $EXIT"
        ),
        env=DEFAULT_ENV,
        executor_config={"pod_override": make_pod_override()},
    )

    extract_run_id = PythonOperator(
        task_id="extract_run_id",
        python_callable=_extract_run_id_from_output,
        op_kwargs={"output_path": f"{MODEL_PIPELINE_DIR}/logs/train_run.log"},
    )

    register_model = BashOperator(
        task_id="register_model",
        bash_command=(
            f"{INSTALL_DEPS} && "
            f"python {MODEL_SCRIPTS_DIR}/register_model.py "
            f"--config {MODEL_CONFIG} "
            "register --run-id {{ ti.xcom_pull(task_ids='extract_run_id', key='run_id') }} "
            f"--model-name {MODEL_NAME}"
        ),
        env=DEFAULT_ENV,
        executor_config={"pod_override": make_pod_override()},
    )

    fetch_model_version = PythonOperator(
        task_id="fetch_model_version",
        python_callable=_fetch_latest_version,
    )

    set_alias = BashOperator(
        task_id="set_alias",
        bash_command=(
            f"{INSTALL_DEPS} && "
            f"python {MODEL_SCRIPTS_DIR}/register_model.py "
            f"--config {MODEL_CONFIG} "
            f"set-alias --model-name {MODEL_NAME} "
            "--version {{ ti.xcom_pull(task_ids='fetch_model_version', key='model_version') }} "
            f"--alias {ALIAS_NAME}"
        ),
        env=DEFAULT_ENV,
        executor_config={"pod_override": make_pod_override()},
    )

    end = EmptyOperator(task_id="end")

    (
        start
        >> train_xgboost
        >> extract_run_id
        >> register_model
        >> fetch_model_version
        >> set_alias
        >> end
    )

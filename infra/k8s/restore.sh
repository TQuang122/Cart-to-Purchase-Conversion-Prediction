#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

KIND_CLUSTER_NAME="${KIND_CLUSTER_NAME:-ctp-cluster}"
KIND_PERSIST_PATH="${KIND_PERSIST_PATH:-/Users/jky/kind-pv}"
BACKUP_DIR="${BACKUP_DIR:-$PROJECT_ROOT/backups}"
SERVING_IMAGE="${SERVING_IMAGE:-tquang71/ctpserving:1.0.0}"
SERVING_PORT="${SERVING_PORT:-18000}"
SKIP_RECREATE=0
SKIP_SERVING=0
VERIFY_ONLY=0

MINIO_BACKUP_DIR="$BACKUP_DIR/minio-mlflow"
POSTGRES_BACKUP_DIR="$BACKUP_DIR/postgres"
AIRFLOW_DAGS_BACKUP="$BACKUP_DIR/airflow-dags/dags.tar.gz"

MINIO_PF_PID=""
SERVING_PF_PID=""
MLFLOW_PF_PID=""

log() {
  printf '[%s] %s\n' "$(date '+%H:%M:%S')" "$*"
}

die() {
  printf '[%s] ERROR: %s\n' "$(date '+%H:%M:%S')" "$*" >&2
  exit 1
}

cleanup() {
  if [[ -n "$MINIO_PF_PID" ]]; then
    kill "$MINIO_PF_PID" >/dev/null 2>&1 || true
    wait "$MINIO_PF_PID" 2>/dev/null || true
  fi
  if [[ -n "$SERVING_PF_PID" ]]; then
    kill "$SERVING_PF_PID" >/dev/null 2>&1 || true
    wait "$SERVING_PF_PID" 2>/dev/null || true
  fi
  if [[ -n "$MLFLOW_PF_PID" ]]; then
    kill "$MLFLOW_PF_PID" >/dev/null 2>&1 || true
    wait "$MLFLOW_PF_PID" 2>/dev/null || true
  fi
}

trap cleanup EXIT

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || die "Missing required command: $1"
}

pick_python() {
  if [[ -n "${PYTHON_BIN:-}" ]] && command -v "$PYTHON_BIN" >/dev/null 2>&1; then
    printf '%s\n' "$PYTHON_BIN"
    return 0
  fi

  if [[ -x "/opt/miniconda3/envs/propensity_mlops/bin/python3" ]]; then
    printf '%s\n' "/opt/miniconda3/envs/propensity_mlops/bin/python3"
    return 0
  fi

  command -v python3 >/dev/null 2>&1 || die "python3 not found"
  printf '%s\n' "python3"
}

check_prerequisites() {
  require_cmd kind
  require_cmd kubectl
  require_cmd docker
  require_cmd curl
  require_cmd file
  require_cmd python3
}

check_restore_inputs() {

  [[ -d "$BACKUP_DIR" ]] || die "Backup directory not found: $BACKUP_DIR"
  [[ -d "$MINIO_BACKUP_DIR" ]] || die "MinIO backup directory not found: $MINIO_BACKUP_DIR"
  [[ -f "$POSTGRES_BACKUP_DIR/mlflow.dump" ]] || die "Missing backup file: $POSTGRES_BACKUP_DIR/mlflow.dump"
  [[ -f "$POSTGRES_BACKUP_DIR/airflow.dump" ]] || die "Missing backup file: $POSTGRES_BACKUP_DIR/airflow.dump"
}

validate_backups() {
  log "Validating backup integrity"

  python3 - <<PY
from pathlib import Path

for dump_path in [
    Path(r"$POSTGRES_BACKUP_DIR/mlflow.dump"),
    Path(r"$POSTGRES_BACKUP_DIR/airflow.dump"),
]:
    data = dump_path.read_bytes()[:5]
    if data != b"PGDMP":
        raise SystemExit(f"Invalid pg_dump custom format for {dump_path}")

root = Path(r"$MINIO_BACKUP_DIR")
files = [p for p in root.rglob("*") if p.is_file()]
if not files:
    raise SystemExit("MinIO backup directory is empty")

mlmodels = [p for p in root.rglob("MLmodel") if p.is_file()]
if not mlmodels:
    raise SystemExit("No MLmodel artifact found in MinIO backup")

print(f"Validated dumps and {len(files)} MinIO backup files")
PY
}

show_help() {
  cat <<'EOF'
Usage: ./restore.sh [options]

Options:
  --skip-recreate   Reuse existing cluster, skip kind delete/create
  --skip-serving    Skip serving image load/deploy and serving endpoint checks
  --verify-only     Only run verification checks on current cluster state
  -h, --help        Show this help message
EOF
}

parse_args() {
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --skip-recreate)
        SKIP_RECREATE=1
        ;;
      --skip-serving)
        SKIP_SERVING=1
        ;;
      --verify-only)
        VERIFY_ONLY=1
        ;;
      -h|--help)
        show_help
        exit 0
        ;;
      *)
        die "Unknown option: $1"
        ;;
    esac
    shift
  done
}

recreate_kind_cluster() {
  mkdir -p "$KIND_PERSIST_PATH"

  if kind get clusters | grep -q "^${KIND_CLUSTER_NAME}$"; then
    log "Deleting existing kind cluster: $KIND_CLUSTER_NAME"
    kind delete cluster --name "$KIND_CLUSTER_NAME"
  fi

  log "Creating kind cluster with host mount: $KIND_PERSIST_PATH"
  kind create cluster --name "$KIND_CLUSTER_NAME" --config - <<EOF
kind: Cluster
apiVersion: kind.x-k8s.io/v1alpha4
nodes:
- role: control-plane
  extraMounts:
  - hostPath: $KIND_PERSIST_PATH
    containerPath: /var/local-path-provisioner
EOF

  kubectl wait --for=condition=Ready "node/${KIND_CLUSTER_NAME}-control-plane" --timeout=180s
}

deploy_infrastructure() {
  log "Deploying infrastructure manifests"
  if (cd "$SCRIPT_DIR" && ./deploy.sh); then
    return 0
  fi

  log "deploy.sh failed, switching to resilient apply flow"

  kubectl apply -f "$SCRIPT_DIR/namespace.yaml"

  kubectl apply -f "$SCRIPT_DIR/postgres/postgres-secret.yaml"
  kubectl apply -f "$SCRIPT_DIR/postgres/postgres-pvc.yaml"
  kubectl apply -f "$SCRIPT_DIR/postgres/postgres-deployment.yaml"
  kubectl apply -f "$SCRIPT_DIR/postgres/postgres-service.yaml"
  kubectl wait --for=condition=ready pod -l app=postgres -n mlops --timeout=300s

  kubectl apply -f "$SCRIPT_DIR/minio/minio-secret.yaml"
  kubectl apply -f "$SCRIPT_DIR/minio/minio-pvc.yaml"
  kubectl apply -f "$SCRIPT_DIR/minio/minio-deployment.yaml"
  kubectl apply -f "$SCRIPT_DIR/minio/minio-service.yaml"
  kubectl wait --for=condition=ready pod -l app=minio -n mlops --timeout=300s

  kubectl delete -f "$SCRIPT_DIR/minio/minio-bucket-job.yaml" --ignore-not-found=true
  kubectl apply -f "$SCRIPT_DIR/minio/minio-bucket-job.yaml"
  kubectl wait --for=condition=complete job/minio-create-bucket -n mlops --timeout=180s

  kubectl apply -f "$SCRIPT_DIR/mlflow/mlflow-config.yaml"
  kubectl apply -f "$SCRIPT_DIR/mlflow/mlflow-deployment.yaml"
  kubectl apply -f "$SCRIPT_DIR/mlflow/mlflow-service.yaml"
  kubectl wait --for=condition=ready pod -l app=mlflow -n mlops --timeout=600s

  kubectl apply -f "$SCRIPT_DIR/kafka/kafka-config.yaml"
  kubectl apply -f "$SCRIPT_DIR/kafka/kafka-statefulset.yaml"
  kubectl apply -f "$SCRIPT_DIR/kafka/kafka-service.yaml"
  kubectl wait --for=condition=ready pod -l app=kafka -n mlops --timeout=600s
  kubectl apply -f "$SCRIPT_DIR/kafka/kafka-ui-deployment.yaml"
  kubectl apply -f "$SCRIPT_DIR/kafka/kafka-ui-service.yaml"
  kubectl wait --for=condition=ready pod -l app=kafka-ui -n mlops --timeout=300s

  kubectl apply -f "$SCRIPT_DIR/dashboard/dashboard-namespace.yaml"
  kubectl apply -f "$SCRIPT_DIR/dashboard/dashboard-serviceaccount.yaml"
  kubectl apply -f "$SCRIPT_DIR/dashboard/dashboard-rbac.yaml"
  kubectl apply -f "$SCRIPT_DIR/dashboard/dashboard-secret.yaml"
  kubectl apply -f "$SCRIPT_DIR/dashboard/dashboard-configmap.yaml"
  kubectl apply -f "$SCRIPT_DIR/dashboard/dashboard-deployment.yaml"
  kubectl apply -f "$SCRIPT_DIR/dashboard/dashboard-service.yaml"

  kubectl apply -f "$SCRIPT_DIR/airflow/airflow-rbac.yaml"
  kubectl apply -f "$SCRIPT_DIR/airflow/airflow-secret.yaml"
  kubectl apply -f "$SCRIPT_DIR/airflow/airflow-passwords.yaml"
  kubectl apply -f "$SCRIPT_DIR/airflow/airflow-config.yaml"
  kubectl apply -f "$SCRIPT_DIR/airflow/airflow-pvc.yaml"
  kubectl apply -f "$SCRIPT_DIR/airflow/airflow-postgres.yaml"
  kubectl wait --for=condition=ready pod -l app=airflow-postgres -n mlops --timeout=600s
  kubectl apply -f "$SCRIPT_DIR/airflow/airflow-scheduler.yaml"
  kubectl apply -f "$SCRIPT_DIR/airflow/airflow-webserver.yaml"
  kubectl wait --for=condition=ready pod -l app=airflow-scheduler -n mlops --timeout=600s
  kubectl wait --for=condition=ready pod -l app=airflow-webserver -n mlops --timeout=600s
}

start_minio_port_forward() {
  log "Port-forwarding MinIO API to localhost:9000"
  kubectl port-forward -n mlops svc/minio 9000:9000 >/tmp/minio-pf.log 2>&1 &
  MINIO_PF_PID=$!

  for _ in $(seq 1 30); do
    if curl -sf http://127.0.0.1:9000/minio/health/live >/dev/null 2>&1; then
      return 0
    fi
    sleep 2
  done

  die "MinIO port-forward not ready on 127.0.0.1:9000"
}

restore_minio_artifacts() {
  local python_bin
  python_bin="$(pick_python)"

  start_minio_port_forward

  log "Restoring MinIO artifacts from $MINIO_BACKUP_DIR"
  "$python_bin" - <<PY
import sys
from pathlib import Path

try:
    import boto3
except Exception as exc:
    raise SystemExit(f"boto3 import failed: {exc}")

root = Path(r"$MINIO_BACKUP_DIR")
bucket = "mlflow"
s3 = boto3.client(
    "s3",
    endpoint_url="http://127.0.0.1:9000",
    aws_access_key_id="minio",
    aws_secret_access_key="minio123",
)

try:
    s3.head_bucket(Bucket=bucket)
except Exception:
    s3.create_bucket(Bucket=bucket)

count = 0
keys = []
for path in root.rglob("*"):
    if path.is_file():
        key = path.relative_to(root).as_posix()
        s3.upload_file(str(path), bucket, key)
        count += 1
        keys.append(key)

resp = s3.list_objects_v2(Bucket=bucket)
existing = {obj["Key"] for obj in resp.get("Contents", [])}
missing = [k for k in keys if k not in existing]
if missing:
    raise SystemExit(f"Missing uploaded objects in MinIO listing: {missing[:5]}")

print(f"Uploaded {count} objects to s3://{bucket}")
PY
}

pod_name_by_label() {
  local label="$1"
  kubectl get pods -n mlops -l "$label" -o jsonpath='{.items[0].metadata.name}'
}

restore_postgres_databases() {
  local mlflow_pod
  local airflow_pg_pod

  mlflow_pod="$(pod_name_by_label app=postgres)"
  airflow_pg_pod="$(pod_name_by_label app=airflow-postgres)"

  log "Restoring MLflow PostgreSQL dump"
  kubectl cp "$POSTGRES_BACKUP_DIR/mlflow.dump" "mlops/${mlflow_pod}:/tmp/mlflow.dump"
  kubectl exec -n mlops "$mlflow_pod" -- sh -c "PGPASSWORD=mlflow123 pg_restore -U mlflow -d mlflow --clean --if-exists --no-owner --no-privileges /tmp/mlflow.dump"

  log "Restoring Airflow PostgreSQL dump"
  kubectl cp "$POSTGRES_BACKUP_DIR/airflow.dump" "mlops/${airflow_pg_pod}:/tmp/airflow.dump"
  kubectl exec -n mlops "$airflow_pg_pod" -- sh -c "PGPASSWORD=airflow123 pg_restore -U airflow -d airflow --clean --if-exists --no-owner --no-privileges /tmp/airflow.dump"

  log "Restarting MLflow after database restore"
  kubectl rollout restart deployment/mlflow -n mlops
  kubectl rollout status deployment/mlflow -n mlops --timeout=300s

  log "Verifying MLflow registry alias purchase_propensity_model@staging"
  kubectl port-forward -n mlops svc/mlflow 15000:5000 >/tmp/mlflow-pf.log 2>&1 &
  MLFLOW_PF_PID=$!

  for _ in $(seq 1 20); do
    if curl -sf "http://127.0.0.1:15000/health" >/dev/null 2>&1 || curl -sf "http://127.0.0.1:15000/" >/dev/null 2>&1; then
      break
    fi
    sleep 2
  done

  local alias_json
  alias_json="$(curl -fsS "http://127.0.0.1:15000/api/2.0/mlflow/registered-models/alias?name=purchase_propensity_model&alias=staging")"
  echo "$alias_json" | grep -q '"model_version"' || die "MLflow alias purchase_propensity_model@staging not found"
}

restore_airflow_dags() {
  local web_pod
  web_pod="$(pod_name_by_label app=airflow-webserver)"

  log "Restoring Airflow DAGs"
  if [[ -f "$AIRFLOW_DAGS_BACKUP" ]]; then
    kubectl cp "$AIRFLOW_DAGS_BACKUP" "mlops/${web_pod}:/tmp/dags.tar.gz"
    if kubectl exec -n mlops "$web_pod" -- sh -c "tar xzf /tmp/dags.tar.gz -C /opt/airflow/dags"; then
      log "Airflow DAG archive extracted"
      return 0
    fi

    log "DAG archive extract failed; falling back to repository DAG sync"
  else
    log "DAG archive not found; using repository DAG sync"
  fi

  kubectl cp "$SCRIPT_DIR/airflow/dags/." "mlops/${web_pod}:/opt/airflow/dags"
}

restart_airflow_components() {
  log "Restarting Airflow scheduler and webserver"
  kubectl rollout restart deployment/airflow-scheduler -n mlops
  kubectl rollout restart deployment/airflow-webserver -n mlops
  kubectl rollout status deployment/airflow-scheduler -n mlops --timeout=300s
  kubectl rollout status deployment/airflow-webserver -n mlops --timeout=300s

  log "Waiting for Airflow DAG cart_to_purchase_k8s to be discoverable"
  for _ in $(seq 1 30); do
    local web_pod
    web_pod="$(pod_name_by_label app=airflow-webserver)"

    if kubectl exec -n mlops "$web_pod" -- sh -c "airflow dags list | grep -q '^cart_to_purchase_k8s'" >/dev/null 2>&1; then
      return 0
    fi
    sleep 4
  done

  local web_pod
  web_pod="$(pod_name_by_label app=airflow-webserver)"
  kubectl exec -n mlops "$web_pod" -- sh -c "airflow dags list-import-errors || true"
  die "Airflow DAG cart_to_purchase_k8s was not discovered in time"
}

load_serving_image() {
  docker info >/dev/null 2>&1 || die "Docker is not running"

  log "Pulling serving image: $SERVING_IMAGE"
  docker pull --platform linux/arm64 "$SERVING_IMAGE"

  log "Loading serving image into kind"
  if kind load docker-image "$SERVING_IMAGE" --name "$KIND_CLUSTER_NAME"; then
    return 0
  fi

  log "kind load failed; importing image with ctr fallback"
  docker save "$SERVING_IMAGE" | docker exec -i "${KIND_CLUSTER_NAME}-control-plane" ctr --namespace=k8s.io images import --platform linux/arm64 -
}

deploy_serving() {
  load_serving_image
  kubectl apply -f "$SCRIPT_DIR/serving/"
  kubectl rollout status deployment/serving-api -n mlops --timeout=300s
}

verify_serving_restore() {
  log "Validating restored services"

  kubectl port-forward -n mlops svc/serving-api "${SERVING_PORT}:8000" >/tmp/serving-pf.log 2>&1 &
  SERVING_PF_PID=$!
  sleep 3

  local stats_json
  stats_json="$(curl -fsS "http://127.0.0.1:${SERVING_PORT}/predict/stats")"
  printf '%s\n' "$stats_json"

  echo "$stats_json" | grep -q '"mlflow_registry"' || die "Serving model source is not mlflow_registry"

  curl -fsS -X POST "http://127.0.0.1:${SERVING_PORT}/predict/raw-lite?explain_level=full" \
    -H "Content-Type: application/json" \
    -d '{"user_id":"10001","product_id":"20001","price":149.99,"activity_count":12,"event_weekday":3,"event_hour":14,"user_total_views":45,"user_total_carts":8,"product_total_views":230,"product_total_carts":42,"brand_purchase_rate":0.15,"price_vs_user_avg":0.8,"price_vs_category_avg":1.1,"brand":"samsung","category_code_level1":"electronics","category_code_level2":"audio"}' >/tmp/restore-predict.json

  cat /tmp/restore-predict.json

  python3 - <<'PY'
import json

with open('/tmp/restore-predict.json', 'r', encoding='utf-8') as f:
    payload = json.load(f)

prob = payload.get('probability')
if not isinstance(prob, (int, float)):
    raise SystemExit('Prediction probability missing or invalid')
if not (0.0 <= float(prob) <= 1.0):
    raise SystemExit(f'Probability out of range: {prob}')

signals = payload.get('explainability', {}).get('top_signals', [])
if not signals:
    raise SystemExit('Missing explainability top_signals in prediction response')
PY
}

verify_restore() {
  log "Checking cluster pod health"
  kubectl get pods -n mlops

  if [[ "$SKIP_SERVING" -eq 1 ]]; then
    log "Skipping serving verification (--skip-serving)"
    return 0
  fi

  verify_serving_restore
}

show_persistence_snapshot() {
  log "Host persistence path snapshot"
  python3 - <<PY
from pathlib import Path

root = Path(r"$KIND_PERSIST_PATH")
pvc_dirs = sorted([p.name for p in root.iterdir() if p.is_dir() and p.name.startswith("pvc-")])
files = 0
bytes_total = 0
for p in root.rglob("*"):
    if p.is_file():
        files += 1
        bytes_total += p.stat().st_size

print({
    "root": str(root),
    "pvc_dir_count": len(pvc_dirs),
    "file_count": files,
    "bytes": bytes_total,
})
PY
}

main() {
  parse_args "$@"

  log "Starting full restore workflow"
  check_prerequisites

  if [[ "$VERIFY_ONLY" -eq 1 ]]; then
    verify_restore
    show_persistence_snapshot
    log "Verify-only workflow completed successfully"
    return 0
  fi

  check_restore_inputs
  validate_backups

  if [[ "$SKIP_RECREATE" -eq 0 ]]; then
    recreate_kind_cluster
  else
    log "Skipping kind recreate (--skip-recreate)"
  fi

  deploy_infrastructure
  restore_minio_artifacts
  restore_postgres_databases
  restore_airflow_dags
  restart_airflow_components

  if [[ "$SKIP_SERVING" -eq 0 ]]; then
    deploy_serving
  else
    log "Skipping serving deploy (--skip-serving)"
  fi

  verify_restore
  show_persistence_snapshot
  log "Restore workflow completed successfully"
}

main "$@"

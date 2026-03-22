#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

BACKUP_DIR="${BACKUP_DIR:-$PROJECT_ROOT/backups}"
MINIO_BACKUP_DIR="$BACKUP_DIR/minio-mlflow"
POSTGRES_BACKUP_DIR="$BACKUP_DIR/postgres"
AIRFLOW_DAGS_BACKUP_DIR="$BACKUP_DIR/airflow-dags"
MLFLOW_EXPERIMENTS_BACKUP_DIR="$BACKUP_DIR/mlflow-experiments"

MINIO_PF_PID=""
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

show_help() {
  cat <<'EOF'
Usage: ./backup.sh [options]

Options:
  --verify-only     Validate backup outputs without creating new backups
  -h, --help        Show this help message
EOF
}

VERIFY_ONLY=0

parse_args() {
  while [[ $# -gt 0 ]]; do
    case "$1" in
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

check_prerequisites() {
  require_cmd kubectl
  require_cmd docker
  require_cmd curl
  require_cmd file
  require_cmd python3
}

ensure_backup_dirs() {
  mkdir -p "$MINIO_BACKUP_DIR"
  mkdir -p "$POSTGRES_BACKUP_DIR"
  mkdir -p "$AIRFLOW_DAGS_BACKUP_DIR"
  mkdir -p "$MLFLOW_EXPERIMENTS_BACKUP_DIR"
}

pod_name_by_label() {
  local label="$1"
  kubectl get pods -n mlops -l "$label" -o jsonpath='{.items[0].metadata.name}'
}

start_minio_port_forward() {
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

backup_minio_artifacts() {
  local python_bin
  python_bin="$(pick_python)"

  start_minio_port_forward

  log "Backing up MinIO artifacts to $MINIO_BACKUP_DIR"
  "$python_bin" - <<PY
from pathlib import Path

try:
    import boto3
except Exception as exc:
    raise SystemExit(f"boto3 import failed: {exc}")

target = Path(r"$MINIO_BACKUP_DIR")
target.mkdir(parents=True, exist_ok=True)

s3 = boto3.client(
    "s3",
    endpoint_url="http://127.0.0.1:9000",
    aws_access_key_id="minio",
    aws_secret_access_key="minio123",
)

bucket = "mlflow"
resp = s3.list_objects_v2(Bucket=bucket)
objects = resp.get("Contents", [])

for obj in objects:
    key = obj["Key"]
    out_path = target / key
    out_path.parent.mkdir(parents=True, exist_ok=True)
    s3.download_file(bucket, key, str(out_path))

print(f"Downloaded {len(objects)} objects from s3://{bucket}")
PY
}

backup_postgres_dumps() {
  local mlflow_pod
  local airflow_pg_pod

  mlflow_pod="$(pod_name_by_label app=postgres)"
  airflow_pg_pod="$(pod_name_by_label app=airflow-postgres)"

  log "Creating MLflow PostgreSQL backup"
  kubectl exec -n mlops "$mlflow_pod" -- sh -c "PGPASSWORD=mlflow123 pg_dump -U mlflow -d mlflow -Fc" > "$POSTGRES_BACKUP_DIR/mlflow.dump"

  log "Creating Airflow PostgreSQL backup"
  kubectl exec -n mlops "$airflow_pg_pod" -- sh -c "PGPASSWORD=airflow123 pg_dump -U airflow -d airflow -Fc" > "$POSTGRES_BACKUP_DIR/airflow.dump"
}

backup_airflow_dags() {
  local web_pod
  web_pod="$(pod_name_by_label app=airflow-webserver)"

  log "Creating Airflow DAG archive"
  kubectl exec -n mlops "$web_pod" -- sh -c "tar czf /tmp/dags.tar.gz -C /opt/airflow/dags ."
  kubectl cp "mlops/${web_pod}:/tmp/dags.tar.gz" "$AIRFLOW_DAGS_BACKUP_DIR/dags.tar.gz"
}

backup_mlflow_metadata() {
  local python_bin
  python_bin="$(pick_python)"

  kubectl port-forward -n mlops svc/mlflow 15000:5000 >/tmp/mlflow-pf.log 2>&1 &
  MLFLOW_PF_PID=$!

  for _ in $(seq 1 20); do
    if curl -sf "http://127.0.0.1:15000/" >/dev/null 2>&1; then
      break
    fi
    sleep 2
  done

  log "Backing up MLflow experiment metadata"
  "$python_bin" - <<PY
import json
from pathlib import Path
from urllib import request

base = "http://127.0.0.1:15000"
out_dir = Path(r"$MLFLOW_EXPERIMENTS_BACKUP_DIR")
out_dir.mkdir(parents=True, exist_ok=True)

def post(path: str, payload: dict) -> dict:
    req = request.Request(
        base + path,
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with request.urlopen(req) as resp:
        return json.loads(resp.read().decode("utf-8"))

experiments_resp = post("/api/2.0/mlflow/experiments/search", {"max_results": 1000})
experiments = experiments_resp.get("experiments", [])
(out_dir / "experiments.json").write_text(json.dumps(experiments_resp, indent=2), encoding="utf-8")

for exp in experiments:
    exp_id = exp.get("experiment_id")
    if not exp_id:
      continue
    runs_resp = post("/api/2.0/mlflow/runs/search", {"experiment_ids": [exp_id], "max_results": 50000})
    (out_dir / f"exp_{exp_id}_runs.json").write_text(json.dumps(runs_resp, indent=2), encoding="utf-8")

print(f"Saved metadata for {len(experiments)} experiments")
PY
}

verify_backup_outputs() {
  log "Verifying backup outputs"

  [[ -f "$POSTGRES_BACKUP_DIR/mlflow.dump" ]] || die "Missing backup output: $POSTGRES_BACKUP_DIR/mlflow.dump"
  [[ -f "$POSTGRES_BACKUP_DIR/airflow.dump" ]] || die "Missing backup output: $POSTGRES_BACKUP_DIR/airflow.dump"
  [[ -f "$AIRFLOW_DAGS_BACKUP_DIR/dags.tar.gz" ]] || die "Missing backup output: $AIRFLOW_DAGS_BACKUP_DIR/dags.tar.gz"
  [[ -f "$MLFLOW_EXPERIMENTS_BACKUP_DIR/experiments.json" ]] || die "Missing backup output: $MLFLOW_EXPERIMENTS_BACKUP_DIR/experiments.json"

  python3 - <<PY
from pathlib import Path

for dump_path in [
    Path(r"$POSTGRES_BACKUP_DIR/mlflow.dump"),
    Path(r"$POSTGRES_BACKUP_DIR/airflow.dump"),
]:
    if dump_path.read_bytes()[:5] != b"PGDMP":
        raise SystemExit(f"Invalid pg_dump custom format: {dump_path}")

dags = Path(r"$AIRFLOW_DAGS_BACKUP_DIR/dags.tar.gz")
if dags.read_bytes()[:2] != b"\x1f\x8b":
    raise SystemExit(f"Invalid gzip signature: {dags}")

minio_files = [p for p in Path(r"$MINIO_BACKUP_DIR").rglob("*") if p.is_file()]
if not minio_files:
    raise SystemExit("MinIO backup output is empty")

print({"minio_file_count": len(minio_files)})
PY
}

main() {
  parse_args "$@"
  check_prerequisites
  ensure_backup_dirs

  if [[ "$VERIFY_ONLY" -eq 1 ]]; then
    verify_backup_outputs
    log "Backup verify-only completed successfully"
    return 0
  fi

  log "Starting backup workflow"
  backup_minio_artifacts
  backup_postgres_dumps
  backup_airflow_dags
  backup_mlflow_metadata
  verify_backup_outputs
  log "Backup workflow completed successfully"
}

main "$@"

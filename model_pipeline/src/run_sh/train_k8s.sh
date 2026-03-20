#!/bin/bash
set -e

# =============================================================================
# Train with K8s MLflow
# Prerequisites:
#   1. kubectl port-forward svc/mlflow -n mlops 5000:5000 &
#   2. kubectl port-forward svc/minio -n mlops 9000:9000 &
# =============================================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"

# Training data path
TRAIN_DATA="$PROJECT_ROOT/data_pipeline/propensity_feature_store/propensity_features/feature_repo/data/train.parquet"

# MLflow K8s config
CONFIG_PATH="$PROJECT_ROOT/model_pipeline/src/config/config_k8s.yaml"

# Experiment name
TIMESTAMP="$(date +"%Y%m%d_%H%M%S")"
RUN_NAME="xgboost_k8s_${TIMESTAMP}"

echo "============================================"
echo "Training with K8s MLflow"
echo "============================================"
echo "Config: $CONFIG_PATH"
echo "Data: $TRAIN_DATA"
echo "Run name: $RUN_NAME"
echo "============================================"

# Set Python path
export PYTHONPATH="$PROJECT_ROOT/model_pipeline"

# AWS credentials for MinIO (must match K8s secret)
export AWS_ACCESS_KEY_ID="minio"
export AWS_SECRET_ACCESS_KEY="minio123"
export AWS_DEFAULT_REGION="us-east-1"
export MLFLOW_S3_ENDPOINT_URL="http://localhost:9000"

# Run training
python "$PROJECT_ROOT/model_pipeline/src/scripts/train.py" \
  --config "$CONFIG_PATH" \
  --training-data-path "$TRAIN_DATA" \
  --run-name "$RUN_NAME"

echo "============================================"
echo "Training completed!"
echo "View results at: http://localhost:5000"
echo "============================================"

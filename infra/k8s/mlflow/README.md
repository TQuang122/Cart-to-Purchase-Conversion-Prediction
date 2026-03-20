# MLflow with PostgreSQL and MinIO

This directory contains the MLflow tracking server configuration with PostgreSQL backend and MinIO artifact storage.

## Issue Fixed: Missing PostgreSQL Driver

The default MLflow Docker image doesn't include the PostgreSQL driver (`psycopg2`). The deployment has been configured to install required dependencies at runtime.

### Current Solution

The deployment uses an init process that installs dependencies before starting MLflow:
- `psycopg2-binary` - PostgreSQL database driver
- `boto3` - AWS SDK for S3/MinIO compatibility

### Alternative: Custom Docker Image

For production use, it's recommended to build a custom Docker image with pre-installed dependencies.

#### Build Custom Image

```bash
# For Docker Desktop with Kubernetes
docker build -t mlflow-postgres:latest -f mlflow/Dockerfile mlflow/

# Update deployment to use the custom image
kubectl set image deployment/mlflow mlflow=mlflow-postgres:latest -n mlops
```

## Configuration

### Environment Variables

Set via `mlflow-config.yaml`:
- `AWS_ACCESS_KEY_ID`: MinIO access key (minio)
- `AWS_SECRET_ACCESS_KEY`: MinIO secret key (minio123)
- `MLFLOW_S3_ENDPOINT_URL`: MinIO endpoint (http://minio:9000)

### Backend Store

PostgreSQL database connection:
```
postgresql://mlflow:mlflow123@postgres:5432/mlflow
```

### Artifact Store

MinIO S3-compatible storage:
```
s3://mlflow/
```

## Verify Installation

```bash
# Check pods
kubectl get pods -n mlops

# Check logs
kubectl logs deployment/mlflow -n mlops

# Port forward to access UI
kubectl port-forward svc/mlflow -n mlops 5000:5000

# Test health endpoint
curl http://localhost:5000/health
```

## Usage from Python

```python
import mlflow
import os

# Set tracking URI
os.environ['MLFLOW_TRACKING_URI'] = 'http://localhost:5000'

# For S3 artifact storage
os.environ['AWS_ACCESS_KEY_ID'] = 'minio'
os.environ['AWS_SECRET_ACCESS_KEY'] = 'minio123'
os.environ['MLFLOW_S3_ENDPOINT_URL'] = 'http://localhost:9000'

# Start experiment
mlflow.set_experiment("cart-to-purchase")
with mlflow.start_run():
    mlflow.log_param("model", "xgboost")
    mlflow.log_metric("f1", 0.7381)
```

## Files

- `mlflow-config.yaml` - Environment configuration for S3/MinIO
- `mlflow-deployment.yaml` - MLflow deployment with dependency installation
- `mlflow-service.yaml` - LoadBalancer service
- `Dockerfile` - Custom image with pre-installed dependencies
- `README.md` - This file

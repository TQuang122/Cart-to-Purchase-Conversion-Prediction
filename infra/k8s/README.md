# MLOps Kubernetes Infrastructure

This directory contains Kubernetes manifests for deploying the MLOps infrastructure for the **Cart-to-Purchase Conversion Prediction** project.

## Components

- **PostgreSQL**: Backend store for MLflow tracking server metadata and Airflow metadata
- **MinIO**: S3-compatible object storage for MLflow artifacts
- **MLflow**: Machine learning tracking server
- **Kafka**: 3-node streaming platform cluster (KRaft mode)
- **Apache Airflow**: Workflow orchestration platform (Airflow 2.8.1)
- **Kubernetes Dashboard**: Web-based UI for managing the Kubernetes cluster

## Architecture

```
┌───────────────────────────────────────────────────────┐
│                    MLOps Namespace                      │
├───────────────────────────────────────────────────────┤
│                                                        │
│  ┌──────────────┐      ┌──────────────┐               │
│  │              │      │              │               │
│  │  PostgreSQL  │◄─────┤    MLflow    │               │
│  │              │      │    Server    │               │
│  │  Port: 5432  │      │              │               │
│  │              │      │  Port: 5000  │               │
│  └──────────────┘      └──────┬───────┘               │
│         ▲                       │                       │
│         │                       ▼                       │
│    [PVC: 5Gi]          ┌──────────────┐               │
│                         │              │               │
│                         │    MinIO     │               │
│                         │              │               │
│                         │  API: 9000   │               │
│                         │  Console:    │               │
│                         │  9001        │               │
│                         └──────┬───────┘               │
│                                │                       │
│                                ▼                       │
│                           [PVC: 10Gi]                  │
│                                                        │
│  ┌──────────────────────────────────────────────┐      │
│  │              Kafka Cluster (3 nodes)        │      │
│  │  kafka-0 ── kafka-1 ── kafka-2             │      │
│  └──────────────────────────────────────────────┘      │
│                                                        │
│  ┌──────────────────────────────────────────────┐      │
│  │         Apache Airflow (KubernetesExecutor)   │      │
│  │  Webserver ── Scheduler ── PostgreSQL       │      │
│  └──────────────────────────────────────────────┘      │
└───────────────────────────────────────────────────────┘
```

## Prerequisites

- Kubernetes cluster (minikube, kind, GKE, EKS, AKS, etc.)
- kubectl configured to access your cluster
- Sufficient cluster resources:
  - At least 2GB RAM available
  - At least 20Gi storage for PVCs

## Quick Start

### Deploy Everything

```bash
cd infra/k8s
chmod +x deploy.sh
./deploy.sh
```

### Access Services

**MLflow UI:**
```bash
kubectl port-forward svc/mlflow -n mlops 5000:5000
```
Then open http://localhost:5000

**MinIO Console:**
```bash
kubectl port-forward svc/minio -n mlops 9001:9001
```
Then open http://localhost:9001 (login: minio / minio123)

**Kafka UI:**
```bash
kubectl port-forward svc/kafka-ui -n mlops 8080:8080
```
Then open http://localhost:8080

**Apache Airflow UI:**
```bash
kubectl port-forward svc/airflow-webserver -n mlops 8080:8080
```
Then open http://localhost:8080 (login: admin / admin123)

**Kubernetes Dashboard:**
```bash
kubectl proxy
# Then open: http://localhost:8001/api/v1/namespaces/kubernetes-dashboard/services/https:kubernetes-dashboard:/proxy/
# Login with token from dashboard-token.txt
```

### Teardown Everything

```bash
./teardown.sh
```

## Backup and Restore Runbook

Use the automation scripts in this directory to keep backup/restore reproducible.

```bash
# Full backup to ./backups
./backup.sh

# Verify existing backup files only
./backup.sh --verify-only

# Full restore (recreate cluster, restore data, redeploy serving, verify)
./restore.sh

# Fast restore for dev (reuse existing cluster, skip serving redeploy)
./restore.sh --skip-recreate --skip-serving

# Verify current runtime only
./restore.sh --verify-only
```

Flags:
- `--skip-recreate`: skip deleting/creating KinD cluster
- `--skip-serving`: skip serving image load/deploy and serving endpoint checks
- `--verify-only`: run validation checks only, no restore actions

## Configuration

### Default Credentials

**PostgreSQL (MLflow):**
- User: mlflow
- Password: mlflow123
- Database: mlflow

**PostgreSQL (Airflow):**
- User: airflow
- Password: airflow123
- Database: airflow

**MinIO:**
- Access Key: minio
- Secret Key: minio123
- Bucket: mlflow

**Apache Airflow:**
- Username: admin
- Password: admin123

## Directory Structure

```
k8s/
├── namespace.yaml                  # MLOps namespace definition
├── deploy.sh                       # Automated MLOps deployment script
├── teardown.sh                     # Automated MLOps teardown script
├── backup.sh                       # One-command backup workflow
├── restore.sh                      # One-command restore workflow
├── README.md                       # This file
├── postgres/
│   ├── postgres-secret.yaml        # PostgreSQL credentials
│   ├── postgres-pvc.yaml           # PostgreSQL storage
│   ├── postgres-deployment.yaml    # PostgreSQL deployment
│   └── postgres-service.yaml       # PostgreSQL service
├── minio/
│   ├── minio-secret.yaml          # MinIO credentials
│   ├── minio-pvc.yaml             # MinIO storage
│   ├── minio-deployment.yaml       # MinIO deployment
│   ├── minio-service.yaml         # MinIO service
│   └── minio-bucket-job.yaml      # Job to create mlflow bucket
├── mlflow/
│   ├── mlflow-config.yaml         # MLflow configuration
│   ├── mlflow-deployment.yaml      # MLflow deployment
│   ├── mlflow-service.yaml        # MLflow service
│   ├── Dockerfile                 # Custom MLflow image
│   └── README.md                 # MLflow documentation
├── kafka/
│   ├── kafka-config.yaml          # Kafka cluster configuration
│   ├── kafka-statefulset.yaml     # Kafka StatefulSet (3 brokers)
│   ├── kafka-service.yaml         # Kafka services
│   ├── kafka-ui-deployment.yaml    # Kafka UI deployment
│   ├── kafka-ui-service.yaml      # Kafka UI service
│   └── README.md                 # Kafka documentation
├── airflow/
│   ├── airflow-rbac.yaml          # Airflow RBAC configuration
│   ├── airflow-secret.yaml        # Airflow secrets
│   ├── airflow-passwords.yaml     # Airflow user passwords
│   ├── airflow-config.yaml        # Airflow configuration
│   ├── airflow-pvc.yaml          # Airflow storage (DAGs & logs)
│   ├── airflow-postgres.yaml      # Airflow PostgreSQL database
│   ├── airflow-scheduler.yaml     # Airflow scheduler deployment
│   ├── airflow-webserver.yaml     # Airflow webserver deployment
│   ├── Dockerfile                 # Custom Airflow image
│   └── requirements.txt          # Python dependencies
└── dashboard/
    ├── dashboard-namespace.yaml   # Dashboard namespace
    ├── dashboard-serviceaccount.yaml # Service accounts
    ├── dashboard-rbac.yaml        # RBAC permissions
    ├── dashboard-secret.yaml      # Dashboard secrets
    ├── dashboard-configmap.yaml  # Dashboard configuration
    ├── dashboard-deployment.yaml  # Dashboard deployment
    └── dashboard-service.yaml    # Dashboard service
```

## Integration with Serving Pipeline

The Kubernetes infrastructure provides:

1. **MLflow** - Track experiments and model registry
2. **MinIO** - Store model artifacts and features
3. **Kafka** - Stream processing for real-time features
4. **Airflow** - Orchestrate training pipelines

The serving pipeline at `serving_pipeline/` can connect to these services:

```python
# Example: Connect to MLflow from serving pipeline
import mlflow

os.environ['MLFLOW_TRACKING_URI'] = 'http://mlflow.mlops.svc.cluster.local:5000'
os.environ['AWS_ACCESS_KEY_ID'] = 'minio'
os.environ['AWS_SECRET_ACCESS_KEY'] = 'minio123'
os.environ['MLFLOW_S3_ENDPOINT_URL'] = 'http://minio.mlops.svc.cluster.local:9000'
```

## Troubleshooting

### Pods not starting

```bash
kubectl describe pod <pod-name> -n mlops
kubectl logs <pod-name> -n mlops
```

### Connection issues

Ensure all services are running:
```bash
kubectl get all -n mlops
```

### Storage issues

Check if PVCs are bound:
```bash
kubectl get pvc -n mlops
```

## Production Considerations

1. **Security:**
   - Change default passwords
   - Use Kubernetes Secrets with encryption at rest
   - Implement RBAC
   - Use network policies

2. **High Availability:**
   - Deploy PostgreSQL with replicas or use managed database
   - Deploy MinIO in distributed mode or use S3
   - Increase MLflow replicas

3. **Backup:**
   - Implement backup strategy for PostgreSQL
   - Configure MinIO bucket versioning
   - Use volume snapshots

4. **Monitoring:**
   - Add Prometheus metrics
   - Configure alerts
   - Set up logging aggregation

5. **KServe Integration:**
   For serving models with KServe, add the following:

   ```bash
   # Install KServe
   kubectl apply -f https://github.com/kserve/kserve/releases/download/v0.12.0/kserve.yaml
   
   # Deploy XGBoost model
   kubectl apply -f kserve/xgboost-isvc.yaml
   ```

# Cart-to-Purchase Conversion Prediction

[![Python](https://img.shields.io/badge/Python-3.10+-blue.svg)](https://www.python.org/downloads/)
[![MLflow](https://img.shields.io/badge/MLflow-Tracking-orange.svg)](https://mlflow.org/)
[![Kubernetes](https://img.shields.io/badge/Kubernetes-KinD%20Ready-326CE5.svg)](https://kubernetes.io/)
[![Docker](https://img.shields.io/badge/Docker-Compose-2496ED.svg)](https://www.docker.com/)
[![React](https://img.shields.io/badge/React-19-61DAFB.svg)](https://react.dev/)

An end-to-end MLOps system that predicts whether a user will complete a purchase after adding an item to cart. The project covers data processing, model training, registry-based deployment, and a production-style inference UI.

## Overview

- Problem type: conditional binary classification after a `cart` event
- Serving style: online API (single + batch prediction)
- Training and registry: MLflow + MinIO artifacts
- Orchestration: Airflow DAGs on Kubernetes
- Frontend: React 19 + Vite dashboard for prediction and model exploration

## Data Source

Dataset: [eCommerce Behavior Data from Multi Category Store (Kaggle)](https://www.kaggle.com/datasets/mkechinov/ecommerce-behavior-data-from-multi-category-store/data)

- Scale: 285M+ events (Oct 2019 to Apr 2020)
- Core events: `view`, `cart`, `remove_from_cart`, `purchase`
- Typical fields: `event_time`, `product_id`, `category_code`, `brand`, `price`, `user_id`, `user_session`

Target definition:

- `1` (purchase): user added to cart, then purchased
- `0` (no purchase): user added to cart, but did not purchase

## Architecture

### Mode A: KinD Kubernetes (recommended)

- Infrastructure in cluster (`namespace: mlops`): MLflow, MinIO, PostgreSQL, Kafka, Airflow
- Serving API (FastAPI) deployed as Kubernetes workload
- Model pulled from MLflow Registry alias and served via `/predict/*`

### Mode B: Local Docker Compose (development)

- Start local infra via `infra/docker/run.sh up`
- Run FastAPI app directly with Uvicorn
- Run React UI in Vite dev mode

## Repository Layout

```text
.
├── data_pipeline/                 # Data processing and feature generation
├── model_pipeline/                # Model training, configs, tests, notebooks
│   └── src/
├── serving_pipeline/
│   ├── api/                       # FastAPI app and routers
│   └── react-ui/                  # React 19 dashboard (Vite)
├── infra/
│   ├── docker/                    # Local docker-compose orchestration
│   └── k8s/                       # KinD Kubernetes manifests and scripts
├── scripts/                       # Ops helper scripts (tunnel, smoke checks, sync)
└── Dockerfile.serving             # Serving API container image
```

## Quick Start

### 1) Kubernetes path (full MLOps flow)

```bash
# Create KinD cluster
kind create cluster --name ctp-cluster

# Deploy platform components
./infra/k8s/deploy.sh

# Verify
kubectl get pods -n mlops

# Build and deploy serving image
docker build -f Dockerfile.serving -t ctpserving:local .
kind load docker-image ctpserving:local --name ctp-cluster
kubectl apply -f infra/k8s/serving/

# Expose API
kubectl port-forward -n mlops svc/serving-api 18000:8000
curl http://127.0.0.1:18000/health
```

### 2) Local development path

```bash
# Start infra stack
./infra/docker/run.sh up

# Start backend
cd serving_pipeline
conda activate propensity_mlops
uvicorn api.main:app --host 127.0.0.1 --port 8000
```

```bash
# Start frontend
cd serving_pipeline/react-ui
npm install
npm run dev
```

Frontend default URL: `http://localhost:5173`

## API Reference

Base URL examples:

- K8s port-forward: `http://127.0.0.1:18000`
- Local backend: `http://127.0.0.1:8000`

### Health and stats

| Method | Path | Description |
|---|---|---|
| `GET` | `/health` | Service health check |
| `GET` | `/predict/stats` | Prediction service stats |
| `GET` | `/predict/monitoring/fallback-ratio` | Feature fallback monitoring |

### Prediction endpoints

| Method | Path | Description |
|---|---|---|
| `POST` | `/predict/raw` | Full feature payload prediction |
| `POST` | `/predict/raw-lite` | Minimal payload prediction with preprocessing |
| `POST` | `/predict/raw/batch` | Batch prediction with JSON list |
| `POST` | `/predict/raw/batch/upload` | Batch prediction from CSV upload |
| `POST` | `/predict/feast` | Prediction using online feature lookup |

### Model and dataset endpoints

| Method | Path | Description |
|---|---|---|
| `GET` | `/model/overview` | Model metadata and serving summary |
| `GET` | `/model/architecture` | Model architecture details |
| `GET` | `/model/hyperparameters` | Training hyperparameters |
| `GET` | `/model/lineage` | Registry/model lineage |
| `GET` | `/dataset/profile` | Dataset profile summary |
| `GET` | `/dataset/quality` | Data quality metrics |
| `GET` | `/dataset/conversion` | Conversion-related dataset metrics |

### Example request (raw-lite)

```bash
curl -X POST "http://127.0.0.1:18000/predict/raw-lite?explain_level=full" \
  -H "Content-Type: application/json" \
  -d '{
    "user_id": "10001",
    "product_id": "20001",
    "price": 149.99,
    "activity_count": 12,
    "event_weekday": 3,
    "event_hour": 14,
    "user_total_views": 45,
    "user_total_carts": 8,
    "product_total_views": 230,
    "product_total_carts": 42,
    "brand_purchase_rate": 0.15,
    "price_vs_user_avg": 0.8,
    "price_vs_category_avg": 1.1,
    "brand": "samsung",
    "category_code_level1": "electronics",
    "category_code_level2": "audio"
  }'
```

## Model and Explainability

- Champion model: XGBoost (registry-served)
- Operating threshold: `0.525` (configurable)
- Explainability: tree SHAP contributions via XGBoost `pred_contribs=True`
- Response can include top signals (`explain_level=top`) or full contributions (`explain_level=full`)

Reported benchmark snapshot:

| Model | AUC | F1 @ 0.525 |
|---|---:|---:|
| XGBoost | 0.9312 | 0.7381 |

## Operations and Helper Scripts

### K8s tunnel helper

```bash
chmod +x scripts/k8s-tunnel.sh
scripts/k8s-tunnel.sh start
scripts/k8s-tunnel.sh status
scripts/k8s-tunnel.sh logs
scripts/k8s-tunnel.sh stop
```

Optional Vercel env sync:

```bash
AUTO_UPDATE_VERCEL=true VERCEL_TARGET_ENVS=production,development scripts/k8s-tunnel.sh restart
VERCEL_TARGET_ENVS=production,development scripts/k8s-tunnel.sh sync-vercel
```

### Backup and restore (K8s)

```bash
./infra/k8s/backup.sh
./infra/k8s/restore.sh
```

## Testing and Validation

```bash
# Model pipeline tests
cd model_pipeline
pytest src/test/

# Frontend checks
cd serving_pipeline/react-ui
npm run lint
npm run build

# Frontend E2E (if Playwright browsers are installed)
npx playwright test
```

## Troubleshooting

- `kubectl port-forward` fails:
  - Verify service exists: `kubectl get svc -n mlops`
  - Verify pods are healthy: `kubectl get pods -n mlops`
- MLflow/MinIO issues:
  - Check env vars: `MLFLOW_TRACKING_URI`, `MLFLOW_S3_ENDPOINT_URL`, `AWS_*`
- Frontend cannot call backend:
  - Confirm API base URL in UI settings
  - Check CORS origins in `serving_pipeline/api/main.py`
- KinD data disappears after Docker restart:
  - Expected with local-path storage unless persisted externally

## Acknowledgments

- Kaggle dataset by Open CDP project contributors
- MLflow, Airflow, FastAPI, XGBoost, React, and Kubernetes communities

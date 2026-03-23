# Cart-to-Purchase Conversion Prediction

[![Python](https://img.shields.io/badge/Python-3.10+-blue.svg)](https://www.python.org/downloads/)
[![MLflow](https://img.shields.io/badge/MLflow-Latest-orange.svg)](https://mlflow.org/)
[![Kubernetes](https://img.shields.io/badge/Kubernetes-KinD%20Ready-326CE5.svg)](https://kubernetes.io/)
[![Docker](https://img.shields.io/badge/Docker-Compose-2496ED.svg)](https://www.docker.com/)
[![XGBoost](https://img.shields.io/badge/XGBoost-3.0.1-red.svg)](https://xgboost.readthedocs.io/)

**Problem**: Given a user adding a product to cart, will they complete the purchase?

This project implements a full MLOps pipeline — from raw e-commerce event data to a production-ready prediction API deployed on Kubernetes.

---

## 🎯 Problem Statement

Cart-to-purchase conversion is formulated as a **conditional binary classification**: the target is defined only after an add-to-cart event has occurred.

| Label | Condition |
|-------|-----------|
| `1` (purchase) | User added product to cart → then purchased it |
| `0` (no purchase) | User added product to cart → but never purchased |

---

## 📊 Data Source

> [eCommerce Behavior Data from Multi Category Store](https://www.kaggle.com/datasets/mkechinov/ecommerce-behavior-data-from-multi-category-store/data) — 285M+ events, Oct 2019 – Apr 2020, Open CDP project.

| Field | Description |
|-------|-------------|
| `event_time` | UTC timestamp |
| `event_type` | `view`, `cart`, `remove_from_cart`, `purchase` |
| `product_id` | Product identifier |
| `category_id` | Category identifier |
| `category_code` | Hierarchical taxonomy (e.g. `electronics.audio.headphones`) |
| `brand` | Brand name (lowercase, may be missing) |
| `price` | Product price |
| `user_id` | Permanent user identifier |
| `user_session` | Temporary session ID |

---

## 🏗️ Architecture

### Two Deployment Modes

#### Mode A: KinD Kubernetes (production-style, full MLOps)

```
┌───────────────────────────────────────────────────────────┐
│                KinD Cluster (kind ctp-cluster)            │
│                      namespace: mlops                     │
├───────────────────────────────────────────────────────────┤
│                                                           │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐   │
│  │PostgreSQL│  │  MinIO   │  │  MLflow  │  │   Kafka  │   │
│  │  :5432   │  │:9000/9001│  │  :5000   │  │  :9092   │   │
│  └──────────┘  └──────────┘  └──────────┘  └──────────┘   │
│                                                           │
│  ┌──────────────────────┐  ┌──────────────────────────┐   │
│  │  Apache Airflow      │  │    Serving API (FastAPI) │   │
│  │  :8080 (webserver)   │  │    :8000 (ClusterIP)     │   │
│  └──────────────────────┘  │    image: ctpserving:v14  │
│                            └─────────────────┬────────┘   │   
│                                              │            │
│                                              ▼            │
│                                     GET /predict/stats    │
│                                     POST /predict/raw-lite│
│                                     POST /predict/feast   │
└───────────────────────────────────────────────────────────┘
```

#### Mode B: Docker Compose (local dev)

```
┌─────────────────────────────────────────────────┐
│  docker compose (./infra/docker/run.sh up)      │
│                                                 │
│  MLflow :5000  |  MinIO :9000  |  Kafka :9092   │
│  Airflow :8090  |  MySQL :3306                  │
└─────────────────────────────────────────────────┘
                          │
                          ▼
         ┌─────────────────────────────────┐
         │  FastAPI (uvicorn :8000)        │
         │  serving_pipeline/              │
         │  conda env: propensity_mlops    │
         └─────────────────────────────────┘
```

---

## 🔄 Pipeline Overview

```
[Raw Events CSV]
       │
       ▼
[data_pipeline/]          Feature engineering → Parquet features
       │                     (user/product features, no Feast)
       ▼
[model_pipeline/]          XGBoost training + TabICL comparison
       │                     • MLflow experiment tracking
       │                     • Hyperparameter tuning
       │                     • Model registry → MinIO S3
       ▼
[infra/k8s/]               Airflow DAG: train → register → serve
       │
       ▼
[serving_pipeline/]        FastAPI serving
       │                     • Loads model from K8s MLflow registry
       │                     • BinaryClassifierWrapper + XGBClassifier
       │                     • Threshold: 0.525
       ▼
[React 19 UI]              Vercel or local npm run dev
       │                     • Prediction UI
       │                     • Dataset explorer
       │                     • Model monitoring
       ▼
[End User]
```

---

## 🚀 Quick Start

### Option A: KinD Kubernetes (recommended for full MLOps)

```bash
# 1. Create KinD cluster
kind create cluster --name ctp-cluster

# 2. Deploy all MLOps infrastructure
cd infra/k8s && ./deploy.sh

# 3. Verify all pods are running
kubectl get pods -n mlops

# 4. Build & deploy serving API
cd serving_pipeline
docker build -f Dockerfile.serving -t ctpserving:v14 .
kind load docker-image ctpserving:v14 --name ctp-cluster
kubectl apply -f infra/k8s/serving/

# 5. Access serving API
kubectl port-forward -n mlops svc/serving-api 18000:8000
curl http://127.0.0.1:18000/predict/stats
```

### Option B: Docker Compose (local dev)

```bash
# 1. Start infrastructure
./infra/docker/run.sh up

# 2. Start serving API
cd serving_pipeline
conda activate propensity_mlops
uvicorn api.main:app --host 127.0.0.1 --port 8000
```

### Option C: One-command K8s tunnel helper

Use the helper script to manage both `kubectl port-forward` and `cloudflared` in one command:

```bash
chmod +x scripts/k8s-tunnel.sh
scripts/k8s-tunnel.sh start
scripts/k8s-tunnel.sh status
scripts/k8s-tunnel.sh logs
scripts/k8s-tunnel.sh stop
```

The script prints the active `trycloudflare.com` URL and checks both local/public `/health` endpoints.

---

## 🔌 API Endpoints

All endpoints work on port `18000` (KinD K8s) or `8000` (local Docker).

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/predict/stats` | Model health, source (mlflow_registry), run_id |
| `POST` | `/predict/raw-lite?explain_level=full` | Prediction with SHAP feature contributions |
| `POST` | `/predict/feast` | Full feature set prediction |
| `GET` | `/model/info` | Model metadata |
| `GET` | `/health` | API health check |

### Example: raw-lite prediction

```bash
curl -X POST http://127.0.0.1:18000/predict/raw-lite \
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

Response:
```json
{
  "is_purchased": 1,
  "probability": 0.6481,
  "decision_threshold": 0.525,
  "model_used": "xgboost",
  "feature_quality": {"score": 39.0, "grade": "D", "inferred_count": 12},
  "feature_contributions": [
    {"feature": "user_cart_to_purchase_rate", "contribution": 0.42645},
    {"feature": "user_total_purchases", "contribution": 0.31382},
    {"feature": "activity_count", "contribution": 0.208}
  ],
  "explainability": {
    "method": "tree_contrib",
    "baseline_score": -0.045,
    "top_signals": [
      {"feature": "user_cart_to_purchase_rate", "contribution": 0.42645},
      {"feature": "user_total_purchases", "contribution": 0.31382},
      {"feature": "activity_count", "contribution": 0.208}
    ]
  }
}

---
## 🧠 SHAP Feature Contributions

The serving API computes **XGBoost tree SHAP** contributions for every prediction, enabling model explainability.

| Field | Type | Description |
|-------|------|-------------|
| `feature_contributions` | `array` | All 26 features with per-feature SHAP contributions |
| `explainability.method` | `string` | Always `tree_contrib` |
| `explainability.baseline_score` | `float` | Model bias term (intercept) |
| `explainability.top_signals` | `array` | Top 3 features by absolute contribution magnitude |
| `explainability.notes` | `array` | Optional debug/inference notes (empty by default) |
| `explainability.baseline_score` | `float` | Model bias term (intercept) |
| `explainability.top_signals` | `array` | Top 3 features by absolute contribution magnitude |
| `explainability.method` | `string` | Always `tree_contrib` |

**Key implementation details:**
- Uses `booster.predict(dmat, pred_contribs=True)` via `xgb.DMatrix` — raw numpy arrays cause TypeError
- Extracts contributions from `_MLflowPyFuncWrapper.get_booster()` — raw Booster lacks this method
- Pads missing feature columns with `0.0` when model was trained on a subset of 26 features
- Query param `explain_level=full` returns all 26 contributions; default `explain_level=top` returns only top 3 signals

## 📁 Project Structure

```
├── data_pipeline/               # Feature engineering
│   └── propensity_feature_store/  # Parquet-based feature lookup
│
├── model_pipeline/              # Training & evaluation
│   ├── src/
│   │   ├── model/              # XGBoost trainer, TabICL wrapper
│   │   ├── data/               # Feature processing
│   │   ├── scripts/            # train.py, register_model.py, benchmark.py
│   │   └── config/             # XGBoost, TabICL, K8s configs
│   └── notebook/
│       └── tabicl_vs_xgboost_experiment.ipynb
│
├── serving_pipeline/            # FastAPI serving + React UI
│   ├── api/
│   │   └── routers/
│   │       ├── predict.py       # Prediction endpoints (MLflow-loaded model)
│   │       └── model.py         # Model info endpoint
│   ├── models/                  # Parquet feature files
│   ├── react-ui/                # React 19 + Vite 7.3.1 + Playwright
│   └── requirements.txt
│
├── infra/
│   ├── docker/                  # Docker Compose (MLflow, MinIO, Kafka, Airflow)
│   │   └── run.sh
│   └── k8s/                    # KinD Kubernetes manifests
│       ├── deploy.sh            # Deploy all MLOps infra
│       ├── teardown.sh
│       ├── serving/             # FastAPI serving deployment (v9)
│       ├── mlflow/              # MLflow + PostgreSQL + MinIO
│       ├── airflow/             # Airflow + DAGs + K8sExecutor
│       ├── kafka/               # 3-node Kafka cluster (KRaft)
│       ├── minio/               # MinIO S3 storage
│       ├── postgres/            # PostgreSQL (MLflow + Airflow backends)
│       └── dashboard/          # Kubernetes Dashboard
│
├── Dockerfile.serving           # Multi-stage build for serving API image
└── requirements.txt             # Top-level Python dependencies
```

---

## 🧪 Model Performance

| Model | AUC | F1@0.525 | Threshold | Notes |
|-------|-----|----------|-----------|-------|
| **XGBoost v8** | 0.9312 | 0.7381 | 0.525 | Champion — loaded from MLflow registry |
| TabICL v2.0.3 | — | — | — | Experimental comparison in notebook |

**Serving API loads model from**: `models:/purchase_propensity_model@staging` (run_id: `ae1f94061e684639b5abce84cde2654c`)

---

## 🧰 Infrastructure Ports

| Service | KinD K8s | Docker Compose | Purpose |
|---------|----------|---------------|---------|
| MLflow UI | `kubectl port-forward svc/mlflow -n mlops 5000:5000` | `localhost:5000` | Experiment tracking |
| MinIO Console | `kubectl port-forward svc/minio -n mlops 9001:9001` | `localhost:9001` | Artifact storage |
| MinIO API | `kubectl port-forward svc/minio -n mlops 9000:9000` | `localhost:9000` | S3 endpoint |
| Airflow | `kubectl port-forward svc/airflow-webserver -n mlops 8080:8080` | `localhost:8090` | DAG orchestration |
| Kafka UI | `kubectl port-forward svc/kafka-ui -n mlops 8080:8080` | — | Kafka management |
| Serving API | `kubectl port-forward -n mlops svc/serving-api 18000:8000` | `localhost:8000` | Prediction service |
| React UI | `npm run dev` (port 5173) | same | Frontend |

**Credentials (KinD K8s):** MinIO `minio/minio123` | Airflow `admin/admin123`

---

## ⚙️ Configuration

### Environment variables for serving API

```bash
MLFLOW_TRACKING_URI=http://mlflow.mlops.svc.cluster.local:5000   # KinD
AWS_ACCESS_KEY_ID=minio
AWS_SECRET_ACCESS_KEY=minio123
MLFLOW_S3_ENDPOINT_URL=http://minio.mlops.svc.cluster.local:9000
MLFLOW_MODEL_NAME=purchase_propensity_model
MLFLOW_MODEL_ALIAS=staging
PREDICT_THRESHOLD=0.525
GEMINI_API_KEY=...                                              # optional
```

---

## 🧪 Testing

```bash
# Serving API health
curl http://127.0.0.1:18000/predict/stats

# Unit tests
cd model_pipeline && pytest src/test/

# E2E tests (React UI)
cd serving_pipeline/react-ui && npx playwright test
```

---

## 📝 Airflow DAGs

| DAG | Description |
|-----|-------------|
| `cart_to_purchase_e2e` | Full pipeline: train → register → serve |
| `cart_to_purchase_k8s` | K8sExecutor: train_xgboost → register_model → set_alias |
| `ctp_e2e_tabicl_dag` | TabICL experimental pipeline |

DAGs are mounted via `airflow-dags-pvc` (1Gi) and synced via `sync-repo-job`.

---

## 🔑 Optional: Gemini Chatbot

The React UI includes a chatbot powered by Gemini.

```bash
export GEMINI_API_KEY="your_key_here"
export GEMINI_MODEL="gemini-2.5-flash"   # optional
```

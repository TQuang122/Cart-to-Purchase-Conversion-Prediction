# Health Check Commands - Cart-to-Purchase Conversion Prediction

**Repository**: Cart-to-Purchase Conversion Prediction (React frontend + ML backend)
**Date Scanned**: March 15, 2026
**Stack**: React 19 + TypeScript + Vite | Python 3.11+ | FastAPI | XGBoost | MLflow | Airflow

---

## 📋 Executive Summary

This document provides a complete inventory of scripts and configurations that define:
- **Lint/Code Quality**: ESLint, TypeScript checks
- **Test**: Playwright E2E, pytest unit/integration tests
- **Build**: Vite bundle, TypeScript compilation
- **Health Checks**: Docker Compose services, MLflow tracking, Airflow DAGs
- **Development**: npm scripts, Python CLI tools

---

## 🎯 Frontend (React UI) - `serving_pipeline/react-ui/`

### 📦 Package Manifest
**File**: `package.json` (v0.0.0, private, type=module)

#### NPM Scripts (defined in `scripts` section)
```json
{
  "dev": "vite",
  "build": "tsc -b && vite build",
  "lint": "eslint .",
  "preview": "vite preview"
}
```

**Command Reference**:
| Command | Purpose | Entry Point |
|---------|---------|------------|
| `npm run dev` | Start dev server (HMR) | Vite on port 5173 |
| `npm run build` | TypeScript + Vite bundle | Outputs to `dist/` |
| `npm run lint` | ESLint checks | All TS/TSX files |
| `npm run preview` | Preview production build | Local preview server |

### 🧪 Test Configuration

**File**: `playwright.config.ts`
- **Test Dir**: `./tests/`
- **Base URL**: `http://localhost:5173` (Vite dev server)
- **Parallel**: Fully parallel (CI: sequential)
- **Retries**: 0 (2 in CI)
- **Workers**: Default (CI: 1)
- **Reporter**: HTML report to `playwright-report/`
- **Trace**: On-first-retry

**Running E2E Tests**:
```bash
npm run build  # Ensure build passes first
npx playwright test
```

### 🔍 Linting Configuration

**File**: `eslint.config.js`
- **Language**: TypeScript (ts/tsx)
- **Extends**:
  - `@eslint/js` (recommended)
  - `typescript-eslint` (recommended)
  - `eslint-plugin-react-hooks` (recommended)
  - `eslint-plugin-react-refresh` (vite preset)
- **Globals**: Browser
- **ECMAScript**: 2020

**Lint Command**:
```bash
npm run lint
```

### 🏗️ Build Configuration

**File**: `vite.config.ts`
- **Plugin**: `@vitejs/plugin-react`
- **Path Alias**: `@/` → `./src/`
- **Output**: `dist/`

**Build Command**:
```bash
npm run build  # TypeScript compilation + Vite bundling
```

### 📊 Dependencies Summary
- **React**: 19.2.0
- **TypeScript**: ~5.9.3
- **Vite**: 7.3.1
- **ESLint**: 9.39.1
- **Playwright**: 1.58.2 (E2E testing)
- **TailwindCSS**: 3.4.19 (styling)

---

## 🐍 Backend - Python Projects

### Root Level Configuration

**File**: `pyproject.toml`
- **Project Name**: `customer-purchas-propensity-prediction`
- **Version**: 0.1.0
- **Python**: ≥3.11
- **Key Dependencies**:
  - mlflow ≥3.8.1
  - xgboost ≥3.1.3
  - feast[redis] ≥0.59.0
  - pytest ≥9.0.2
  - scikit-learn ≥1.8.0
  - pyspark ≥4.1.1
  - google-generativeai ≥0.8.6

**Testing Entry Point**: `pytest` (see below)

### Model Pipeline - `model_pipeline/`

#### 📋 Test Configuration
**Files**: 
- `src/test/conftest.py` (pytest fixtures & config)
- `src/test/unit/test_experiment_tracker.py`
- `src/test/integration/test_integration_training_pipeline.py`
- `src/test/integration/test_e2e.py`

**Custom Pytest Markers** (defined in conftest.py):
```python
@pytest.mark.e2e              # End-to-end tests (requires MLflow server)
@pytest.mark.slow            # Slow-running tests
@pytest.mark.requires_mlflow  # Requires live MLflow server
```

**Test Fixtures** (conftest.py):
- `test_data_dir()` - Temporary directory for test data
- `sample_config()` - Test MLflow/model configuration
- `sample_training_data()` - Synthetic training dataset (500 samples)
- `mock_mlflow_client()` - Mocked MLflow client
- `reset_mlflow()` - Auto-cleanup between tests
- `setup_test_env()` - Test environment variables

**Running Tests**:
```bash
# All tests
pytest model_pipeline/src/test/

# Unit tests only
pytest model_pipeline/src/test/unit/

# Integration tests only
pytest model_pipeline/src/test/integration/

# E2E tests (requires MLflow server)
pytest model_pipeline/src/test/integration/test_e2e.py -m e2e

# Skip slow tests
pytest --ignore=slow -m "not slow"
```

#### 🏃 Training & Evaluation Scripts

**Files**:
- `src/scripts/train.py` - Model training CLI
- `src/scripts/eval.py` - Model evaluation CLI
- `src/scripts/register_model.py` - Model registry CLI
- `src/run_sh/train.sh` - Training execution wrapper
- `src/run_sh/eval.sh` - Evaluation execution wrapper
- `src/run_sh/register_model.sh` - Model registration
- `src/run_sh/set_model_alias.sh` - Set model alias (staging/champion)
- `src/run_sh/promote_model.sh` - Promote to production
- `src/run_sh/list_models.sh` - List registered models
- `src/run_sh/model_info.sh` - Get model information

**Quick Start Workflow**:
```bash
cd model_pipeline/src/run_sh
chmod +x *.sh

# 1. Train model
./train.sh  # Returns run_id

# 2. Evaluate model
./eval.sh   # Update RUN_ID in script

# 3. Register model
./register_model.sh

# 4. Promote to staging
./set_model_alias.sh

# 5. Promote to production
./promote_model.sh
```

#### ⚙️ Configuration

**File**: `src/config/config.yaml`
- **MLflow Tracking URI**: `http://localhost:5000`
- **Experiment Name**: Test experiment (configurable)
- **Model Type**: XGBoost classifier
- **XGBoost Device**: CUDA or CPU
- **Thresholds**: Accuracy ≥0.85, AUC ≥0.80
- **SHAP Explainability**: Enabled, exact explainer

---

### Serving Pipeline - `serving_pipeline/`

#### 📦 Package Manifest
**File**: `package.json` (OpenCode helper)

#### 🐍 Python Backend

**Files**:
- `requirements.txt` - Dependencies for serving
- `api/main.py` - FastAPI application (port 8000)
- `predict_func.py` - Prediction function
- `chatbot_function.py` - Gemini chatbot integration
- `ui.py` - Gradio UI (legacy)
- `train_mock_model.py` - Mock model training

**Backend Dependencies** (from `requirements.txt`):
- FastAPI
- Gradio ≥6.3.0
- google-generativeai ≥0.8.6
- MLflow ≥3.5.0
- boto3 ≥1.34.0
- feast ≥0.35.0

**Health Checks**:
```bash
# Start FastAPI backend
conda activate propensity_mlops
cd serving_pipeline
python -m pip install -r requirements.txt
export GEMINI_API_KEY="your_key"  # Optional: Gemini integration
uvicorn api.main:app --host 127.0.0.1 --port 8000

# Test API endpoint
curl http://localhost:8000/docs  # Swagger UI
```

#### React UI (See Frontend section above)

**Quick Start Combined**:
```bash
# Terminal 1: Backend
conda activate propensity_mlops
cd serving_pipeline
python -m pip install -r requirements.txt
uvicorn api.main:app --host 127.0.0.1 --port 8000

# Terminal 2: Frontend
cd serving_pipeline/react-ui
npm install
npm run dev
```

---

## 🐳 Infrastructure & Docker

### Docker Services Management

**File**: `infra/docker/run.sh` (Main orchestration script)

**Usage**:
```bash
chmod +x infra/docker/run.sh

./run.sh up       # Start all services
./run.sh down     # Stop all services
./run.sh restart  # Restart all services
./run.sh status   # Show service status
./run.sh help     # Show help
```

**Managed Services**:
1. **MLflow** (`infra/docker/mlflow/`)
   - MLflow Tracking Server (port 5000)
   - MinIO S3-compatible storage (ports 9000, 9001)
   - MySQL metadata backend (port 3306)

2. **Kafka** (`infra/docker/kafka/`)
   - 3-broker KRaft cluster
   - Ports: 9092, 9192, 9292

3. **Monitoring** (`infra/docker/monitor/`)
   - Grafana (port 3000): admin/admin
   - Prometheus (port 9090)
   - Loki (port 3100): Log aggregation
   - Node Exporter (port 9100, Linux only)
   - DCGM Exporter (port 9400, NVIDIA GPU only)

4. **Airflow** (`infra/docker/airflow/`)
   - Webserver (port 8080): airflow/airflow
   - Scheduler
   - Workers (CeleryExecutor)
   - API Server (port 8081)
   - PostgreSQL backend (port 5432)
   - Redis (port 6379)

### Docker Compose Files

| Service | File | Customization |
|---------|------|---------------|
| MLflow | `infra/docker/mlflow/docker-compose.yaml` | MySQL creds, MinIO keys in `.env` |
| Kafka | `infra/docker/kafka/docker-compose.yaml` | Broker ports, retention |
| Monitor | `infra/docker/monitor/docker-compose.yaml` | Profiles: `linux`, `nvidia` |
| Airflow | `infra/docker/airflow/docker-compose.yaml` | `requirements.txt`, DAG directories |

### Infrastructure Access URLs

| Service | URL | Default Credentials |
|---------|-----|-------------------|
| MLflow | http://localhost:5000 | N/A |
| MinIO Console | http://localhost:9001 | minio / minio123 |
| Grafana | http://localhost:3000 | admin / admin |
| Prometheus | http://localhost:9090 | N/A |
| Airflow | http://localhost:8080 | airflow / airflow |
| Airflow API | http://localhost:8081 | (JWT auth) |

---

## 📝 Python Requirements Files

### Root Level Requirements
**File**: `requirements.txt`
- **Purpose**: Airflow custom dependencies + MLflow client
- **Python**: 3.11 compatible
- **Key Packages**:
  - requests (HTTP client)
  - mlflow ≥3.5.0 (MLflow client)
  - pandas, numpy, pyarrow (data processing)
  - xgboost, scikit-learn (ML)
  - boto3 (S3/MinIO)
  - feast (feature store)
  - python-dotenv (environment)
  - loguru (logging)
  - optuna (hyperparameter optimization)

### Model Pipeline Requirements
**File**: `model_pipeline/requirements.txt`
- Custom model pipeline dependencies

### Serving Pipeline Requirements
**File**: `serving_pipeline/requirements.txt`
- FastAPI, Gradio, Google Generative AI, boto3, MLflow

---

## 🔧 Development Workflow Commands

### Frontend Complete Workflow
```bash
cd serving_pipeline/react-ui

# Install dependencies
npm install

# Development (hot reload)
npm run dev

# Type check
npx tsc --noEmit

# Lint code
npm run lint

# Build for production
npm run build

# Preview production build
npm run preview

# Run E2E tests
npx playwright test

# View test report
npx playwright show-report
```

### Backend Complete Workflow
```bash
# Activate project serving environment (recommended)
conda activate propensity_mlops

# Install serving dependencies
cd serving_pipeline
python -m pip install -r requirements.txt

# Run tests
pytest model_pipeline/src/test/ -v

# Train model
cd model_pipeline/src/run_sh
./train.sh

# Start serving
cd serving_pipeline
uvicorn api.main:app --reload
```

### Full Stack Startup
```bash
# Terminal 1: Infrastructure
cd infra/docker
./run.sh up

# Terminal 2: Backend API
conda activate propensity_mlops
cd serving_pipeline
python -m pip install -r requirements.txt
uvicorn api.main:app --host 127.0.0.1 --port 8000

# Terminal 3: Frontend
cd serving_pipeline/react-ui
npm run dev

# Access:
# - Frontend: http://localhost:5173
# - API Docs: http://localhost:8000/docs
# - MLflow: http://localhost:5000
# - Airflow: http://localhost:8080
```

---

## ✅ Health Check Checklist

### Frontend Health Checks
- [ ] `npm install` succeeds (dependencies resolved)
- [ ] `npm run build` succeeds (TypeScript + Vite)
- [ ] `npm run lint` passes (no linting errors)
- [ ] `npm run dev` starts without errors
- [ ] `npx playwright test` passes (E2E tests)

### Backend Health Checks
- [ ] `pytest model_pipeline/src/test/` passes
- [ ] `conda activate propensity_mlops` completed before API start
- [ ] `python -m pip install -r serving_pipeline/requirements.txt` completed
- [ ] `uvicorn api.main:app` starts (port 8000)
- [ ] MLflow tracking server responds (http://localhost:5000)
- [ ] `/docs` endpoint accessible for API

### Infrastructure Health Checks
- [ ] `./run.sh up` starts all services
- [ ] `docker compose ps` shows all containers running
- [ ] MLflow accessible: http://localhost:5000/api/health
- [ ] MinIO accessible: http://localhost:9001
- [ ] Airflow accessible: http://localhost:8080
- [ ] Kafka brokers responding: `kafka-topics --list` on each broker

### Integration Health Checks
- [ ] Frontend connects to API (http://localhost:8000)
- [ ] API loads model from MLflow registry
- [ ] Predictions return successfully
- [ ] Feature store (Feast/Redis) responds
- [ ] Airflow DAG `cart_to_purchase_e2e` can be triggered

---

## 📊 Command Summary Table

| Layer | Tool | Command | Purpose |
|-------|------|---------|---------|
| Frontend | npm | `npm run dev` | Dev server |
| Frontend | npm | `npm run build` | Production bundle |
| Frontend | ESLint | `npm run lint` | Code quality |
| Frontend | Playwright | `npx playwright test` | E2E tests |
| Backend | pytest | `pytest model_pipeline/` | Unit/integration tests |
| Backend | MLflow | `mlflow ui` | Experiment tracking |
| Backend | FastAPI | `uvicorn api.main:app` | API server |
| Infra | Docker Compose | `./run.sh up` | Start all services |
| Infra | Docker Compose | `./run.sh down` | Stop all services |
| Infra | Docker Compose | `./run.sh status` | Service status |

---

## 🚀 Default Entry Points

- **Frontend Dev**: `npm run dev` → Vite on http://localhost:5173
- **Frontend Build**: `npm run build` → Outputs to `dist/`
- **Backend API**: `uvicorn api.main:app` → FastAPI on http://localhost:8000
- **Model Training**: `model_pipeline/src/run_sh/train.sh` → MLflow tracking
- **Testing**: `pytest model_pipeline/` → Pytest with MLflow fixtures
- **Infrastructure**: `./run.sh up` → Docker Compose orchestration

---

## 📌 Key Notes

1. **No GitHub Actions/CI Workflows**: Project uses local development + manual Docker orchestration
2. **MLflow Integration**: Uses MinIO (S3-compatible) for artifacts + MySQL backend
3. **Feature Store**: Feast with Redis online serving
4. **Test Database**: Uses temporary directories + mocked MLflow client
5. **Environment Variables**: Set via `.env` files in respective directories
6. **Python 3.11+**: Required for all backend components
7. **CUDA Optional**: XGBoost configured for both CPU and GPU training

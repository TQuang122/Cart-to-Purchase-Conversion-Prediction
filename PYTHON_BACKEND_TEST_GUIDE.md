# Python Backend Test Locations & Execution Guide

**Last Updated**: 2026-03-15  
**Repo**: Cart-to-Purchase Conversion Prediction (MLOps Pipeline)

---

## 📍 Test Locations Summary

### Primary Test Directory
- **Path**: `./model_pipeline/src/test/`
- **Framework**: pytest
- **Structure**:
  ```
  model_pipeline/src/test/
  ├── conftest.py                           # Shared pytest fixtures & config
  ├── fixtures/
  │   └── sample_config.yaml                # Test fixture data
  ├── unit/
  │   └── test_experiment_tracker.py        # 20+ unit tests
  └── integration/
      ├── test_e2e.py                       # End-to-end workflow tests
      └── test_integration_training_pipeline.py  # Integration tests
  ```

---

## 🧪 Test Categories

### 1. **Unit Tests** - `model_pipeline/src/test/unit/test_experiment_tracker.py`
**Purpose**: Test individual components with mocked dependencies  
**Framework**: pytest + unittest.mock  
**Size**: 266 lines | 20+ test functions

**Test Classes**:
- `TestExperimentTrackerInit` - Initialization & experiment creation
- `TestExperimentTrackerRun` - Run lifecycle management
- `TestExperimentTrackerLogging` - Logging metrics, params, artifacts
- `TestExperimentTrackerSearch` - Run queries & comparisons

**Sample Tests**:
```python
@patch("src.mlflow_utils.experiment_tracker.mlflow")
def test_init_creates_new_experiment(self, mock_mlflow):
    # Test: Creates experiment when it doesn't exist
    
@patch("src.mlflow_utils.experiment_tracker.mlflow")
def test_start_run_context_manager(self, mock_mlflow):
    # Test: Run context manager functionality
```

---

### 2. **Integration Tests** - `model_pipeline/src/test/integration/`

#### **test_integration_training_pipeline.py** (17,669 bytes)
**Purpose**: Test workflow: Data prep → Training → Logging → Model saving  
**Dependency**: Mocked MLflow (no running server required)

#### **test_e2e.py** (13,672 bytes)
**Purpose**: Full MLOps cycle with real small dataset  
**Marks**: `@pytest.mark.e2e`, `@pytest.mark.slow`, `@pytest.mark.requires_mlflow`  
**Requirements**: Running MLflow server at `http://localhost:5000`

**E2E Test Workflow**:
1. Load real (small) dataset
2. Train baseline model
3. Train challenger models (different hyperparameters)
4. Evaluate all models
5. Compare models
6. Register best model
7. Promote to staging
8. Compare staging vs champion
9. Promote to champion if better
10. Verify artifacts & metrics logged

---

## 🛠️ Pytest Configuration

### **Project Configuration**: `pyproject.toml`
```toml
[project]
name = "customer-purchas-propensity-prediction"
requires-python = ">=3.11"
dependencies = [
    "pytest>=9.0.2",  # Test framework
    "mlflow>=3.8.1",
    "xgboost>=3.1.3",
    ...
]
```

### **Shared Fixtures**: `model_pipeline/src/test/conftest.py`
Provides reusable test fixtures:

| Fixture | Scope | Purpose |
|---------|-------|---------|
| `test_data_dir` | session | Temporary directory for test data |
| `sample_config` | function | Test MLflow/model/features config |
| `sample_config_file` | function | Config YAML file path |
| `sample_training_data` | function | 500-row synthetic DataFrame |
| `sample_train_test_split` | function | Split data into train/test sets |

**Example**:
```python
@pytest.fixture
def sample_training_data():
    """Generate 500-row synthetic dataset"""
    return pd.DataFrame({
        "price": np.random.uniform(10, 500, 500),
        "activity_count": np.random.randint(1, 50, 500),
        "event_weekday": np.random.randint(0, 7, 500),
        ...
        "is_purchased": np.random.choice([0, 1], 500)
    })
```

---

## ⚙️ Running Tests

### **Method 1: Direct pytest Invocation** (Recommended)

#### Run All Tests
```bash
cd ./model_pipeline

# Run all tests (unit + integration)
python -m pytest src/test/ -v

# Run with coverage
python -m pytest src/test/ -v --cov=src --cov-report=html
```

#### Run Specific Test Suite
```bash
# Unit tests only
python -m pytest src/test/unit/ -v

# Integration tests only
python -m pytest src/test/integration/ -v

# E2E tests (requires MLflow running)
python -m pytest src/test/integration/test_e2e.py -v -s -m e2e
```

#### Run Specific Test Class/Function
```bash
# Single test class
python -m pytest src/test/unit/test_experiment_tracker.py::TestExperimentTrackerInit -v

# Single test function
python -m pytest src/test/unit/test_experiment_tracker.py::TestExperimentTrackerInit::test_init_creates_new_experiment -v
```

### **Method 2: pytest with Markers**

#### By Marker
```bash
# E2E tests only (requires MLflow)
python -m pytest -m e2e -v -s

# Exclude slow tests
python -m pytest -m "not slow" -v

# Tests requiring MLflow server
python -m pytest -m requires_mlflow -v
```

#### Available Markers (in test_e2e.py)
- `@pytest.mark.e2e` - End-to-end tests
- `@pytest.mark.slow` - Long-running tests
- `@pytest.mark.requires_mlflow` - Needs MLflow server

### **Method 3: Docker-Based Testing**

Tests can be run inside Airflow/MLflow Docker containers:

```bash
# Start MLflow infrastructure
cd ./infra/docker
./run.sh up

# Run tests in Python environment
python -m pytest ./model_pipeline/src/test/ -v
```

---

## 📦 Test Dependencies

### **Installed via pyproject.toml**
```
pytest>=9.0.2              # Test framework
mlflow>=3.8.1              # MLflow client
xgboost>=3.1.3             # Model training
scikit-learn>=1.8.0        # ML utilities
pandas>=2.3.3              # Data processing
numpy>=2.4.1               # Numerical computing
boto3>=1.42.19             # S3/MinIO support
```

### **Model Pipeline Specific** (`model_pipeline/requirements.txt`)
```
pytest (implicit via pyproject.toml)
mlflow>=2.15.0,<2.20.0
xgboost>=2.0.0,<2.2.0
pandas>=2.0.0,<2.3.0
numpy>=1.24.0,<2.0.0
scikit-learn>=1.3.0,<1.6.0
shap>=0.44.0,<0.46.0      # Model explainability
```

---

## 🚀 Health Check / CI-Ready Commands

### **Quick Health Check** (5 seconds)
```bash
# Run unit tests only (no MLflow required)
cd ./model_pipeline
python -m pytest src/test/unit/ -v --tb=short
```

### **Full Backend Test Suite** (requires MLflow running)
```bash
# Step 1: Start infrastructure
cd ./infra/docker
./run.sh up  # Starts MLflow, MinIO, PostgreSQL, Kafka, etc.

# Step 2: Run all tests
cd ../../model_pipeline
python -m pytest src/test/ -v --cov=src

# Step 3: Stop infrastructure
cd ../infra/docker
./run.sh down
```

### **CI/CD Integration** (GitHub Actions / GitLab CI)
```yaml
# Example for GitHub Actions
- name: Run Python Backend Tests
  run: |
    cd model_pipeline
    python -m pytest src/test/unit/ -v --tb=short
```

---

## 📊 Test Statistics

| Category | Count | Location | Status |
|----------|-------|----------|--------|
| **Unit Tests** | 20+ | `test_experiment_tracker.py` | ✅ Ready |
| **Integration Tests** | 3+ | `test_integration_training_pipeline.py` | ✅ Ready |
| **E2E Tests** | 10+ | `test_e2e.py` | ⚠️ Requires MLflow |
| **Total** | 35+ | `model_pipeline/src/test/` | ✅ Functional |

---

## 🔧 Environment Variables for Tests

```bash
# MLflow tracking server
export MLFLOW_TRACKING_URI=http://localhost:5000

# MinIO credentials (for artifact storage)
export AWS_ACCESS_KEY_ID=minio
export AWS_SECRET_ACCESS_KEY=minio123
export AWS_DEFAULT_REGION=us-east-1
export MLFLOW_S3_ENDPOINT_URL=http://localhost:9000

# Optional: Override model/training config
export MLFLOW_EXPERIMENT_NAME=test_experiment
export PREDICT_THRESHOLD=0.525
```

---

## 📝 Test Configuration Files

### **conftest.py** - Fixture Definitions
- Location: `model_pipeline/src/test/conftest.py`
- Lines: 188 total
- Provides:
  - Temp directory for test artifacts
  - Sample MLflow config
  - Synthetic training data (500 rows)
  - Train/test data splits

### **Fixtures YAML** - Test Data
- Location: `model_pipeline/src/test/fixtures/sample_config.yaml`
- Contains:
  - MLflow tracking config
  - Model hyperparameters
  - Feature columns (training_features)
  - Target column (is_purchased)
  - Evaluation thresholds

---

## ⚠️ Known Test Requirements

### **Unit Tests**
- ✅ No external dependencies
- ✅ Use mocked MLflow
- ✅ <5 second runtime

### **Integration Tests**
- ⚠️ May need mocked or real MLflow
- ⚠️ Requires pandas/numpy/sklearn
- ⚠️ 10-30 second runtime

### **E2E Tests**
- ⚠️ **Requires running MLflow server** at `http://localhost:5000`
- ⚠️ Requires MinIO at `http://localhost:9000`
- ⚠️ 30-120 second runtime
- ⚠️ Creates real runs/models in MLflow

---

## 🎯 Recommended Test Execution Strategy

### **Pre-Commit** (Local Development)
```bash
python -m pytest ./model_pipeline/src/test/unit/ -q
```

### **Pre-Push** (Before GitHub push)
```bash
python -m pytest ./model_pipeline/src/test/ -v --tb=short -m "not requires_mlflow"
```

### **CI/CD Pipeline** (GitHub Actions)
```bash
# Stage 1: Unit tests (always)
python -m pytest ./model_pipeline/src/test/unit/ -v

# Stage 2: E2E tests (on main branch only, with running MLflow)
if [ "$GITHUB_REF" == "refs/heads/main" ]; then
  docker compose -f ./infra/docker/mlflow/docker-compose.yaml up -d
  python -m pytest ./model_pipeline/src/test/integration/test_e2e.py -v
  docker compose -f ./infra/docker/mlflow/docker-compose.yaml down
fi
```

---

## 🔍 Debugging Failed Tests

### **Show Test Output**
```bash
pytest src/test/ -v -s  # -s shows print statements
```

### **Show Traceback**
```bash
pytest src/test/ --tb=long  # Full traceback
pytest src/test/ --tb=short # Minimal traceback
```

### **Run with Pdb (Debugger)**
```bash
pytest src/test/unit/test_experiment_tracker.py -v --pdb
```

### **Stop on First Failure**
```bash
pytest src/test/ -x  # Stop at first failure
pytest src/test/ -x -s  # Stop + show output
```

---

## 📚 References

- **Pytest Docs**: https://docs.pytest.org/
- **MLflow Docs**: https://mlflow.org/docs/latest/
- **XGBoost Docs**: https://xgboost.readthedocs.io/
- **Project README**: `./README.md`
- **Model Pipeline README**: `./model_pipeline/README.md`

---

## ✅ Verification Checklist

Before deploying:

- [ ] All unit tests pass: `pytest src/test/unit/ -v`
- [ ] No linting errors: `python -m pylint src/`
- [ ] No type errors: `python -m mypy src/`
- [ ] Coverage >80%: `pytest src/test/ --cov=src --cov-report=term-missing`
- [ ] E2E tests pass (if MLflow running): `pytest src/test/integration/test_e2e.py -v`

---

## Summary Table

| Aspect | Details |
|--------|---------|
| **Test Framework** | pytest 9.0.2+ |
| **Primary Location** | `./model_pipeline/src/test/` |
| **Unit Tests** | 20+ tests in `test_experiment_tracker.py` |
| **Integration Tests** | Multiple tests in `test_integration_training_pipeline.py` & `test_e2e.py` |
| **Quick Test** | `pytest src/test/unit/ -v` (~5 sec) |
| **Full Test** | `pytest src/test/ -v` (~60 sec with MLflow) |
| **CI Command** | `python -m pytest ./model_pipeline/src/test/unit/ -v` |
| **Key Dependencies** | pytest, mlflow, xgboost, pandas, scikit-learn |
| **Mocking** | unittest.mock (no external services for unit tests) |
| **Fixtures** | 5+ shared fixtures in conftest.py |


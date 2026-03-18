# PYTHON BACKEND TEST INVENTORY

**Generated**: 2026-03-15  
**Repository**: Cart-to-Purchase Conversion Prediction MLOps  
**Status**: ✅ All test locations identified and documented

---

## 📂 Test Files & Locations

### **Primary Python Backend Test Suite**
Location: `./model_pipeline/src/test/`

#### **Configuration & Fixtures**
- **conftest.py** (188 lines)
  - Shared pytest fixtures for all tests
  - Provides: test_data_dir, sample_config, sample_training_data, sample_config_file
  - Scope: session, function-level fixtures

- **fixtures/sample_config.yaml**
  - MLflow configuration (tracking_uri, experiment_name, artifact_location)
  - Model configuration (hyperparameters, type)
  - Evaluation thresholds
  - Feature definitions (target_column, training_features)

#### **Unit Tests** ✅
- **unit/test_experiment_tracker.py** (266 lines)
  - **20+ test functions** organized in 4 classes
  - Classes:
    - `TestExperimentTrackerInit` - Initialization tests
    - `TestExperimentTrackerRun` - Run lifecycle tests
    - `TestExperimentTrackerLogging` - Metric/artifact logging tests
    - `TestExperimentTrackerSearch` - Run search/comparison tests
  - Uses: @patch decorators for MLflow mocking
  - Dependencies: unittest.mock, mlflow (mocked)
  - Runtime: <5 seconds

#### **Integration Tests** ⚠️
- **integration/test_integration_training_pipeline.py**
  - Tests complete workflow: data → training → logging → model saving
  - Uses mocked MLflow (no server required)
  - Runtime: 10-30 seconds

#### **End-to-End Tests** ⚠️⚠️
- **integration/test_e2e.py** (404 lines)
  - Full MLOps cycle with real small dataset
  - 10+ test functions
  - Pytest markers: `@pytest.mark.e2e`, `@pytest.mark.slow`, `@pytest.mark.requires_mlflow`
  - **Requirement**: Running MLflow server at http://localhost:5000
  - Workflow:
    1. Load real (small) dataset
    2. Train baseline + challenger models
    3. Evaluate models
    4. Compare models
    5. Register best model
    6. Promote to staging
    7. Compare staging vs champion
    8. Verify artifacts & metrics
  - Runtime: 30-120 seconds

---

## 🗂️ Supporting Test Infrastructure

### **Data Pipeline Tests**
- `./data_pipeline/scripts/split_train_test.py` - May contain inline tests or validation

### **Serving Pipeline Tests** (Frontend)
- `./serving_pipeline/tests/` - React/Next.js UI tests
- `./serving_pipeline/react-ui/test-results/` - Test results directory
- Framework: Playwright, Jest/Vitest
- Note: These are JavaScript, not Python backend tests

---

## 📊 Test Statistics Summary

| Metric | Value |
|--------|-------|
| **Primary Test Location** | `./model_pipeline/src/test/` |
| **Test Files** | 5 (conftest.py, 2 integration, 1 unit, 1 fixture config) |
| **Test Functions** | 35+ total |
| **Unit Tests** | 20+ in test_experiment_tracker.py |
| **Mocked Services** | MLflow client |
| **Framework** | pytest 9.0.2+ |
| **Primary Dependency** | mlflow>=3.8.1, xgboost>=3.1.3 |

---

## 🎯 Test Execution Commands

### **Quick Unit Tests** (No Setup Required)
```bash
cd ./model_pipeline
python -m pytest src/test/unit/ -v
# Runtime: ~5 seconds
# Status: ✅ Ready
```

### **All Tests** (Optionally With MLflow)
```bash
cd ./model_pipeline
python -m pytest src/test/ -v

# With coverage
python -m pytest src/test/ -v --cov=src --cov-report=html

# Without E2E (no MLflow needed)
python -m pytest src/test/ -v -m "not requires_mlflow"
```

### **E2E Tests Only** (Requires MLflow)
```bash
cd ./model_pipeline

# First, ensure MLflow is running
cd ../infra/docker
./run.sh up
cd ../../model_pipeline

# Run E2E tests
python -m pytest src/test/integration/test_e2e.py -v -s -m e2e
```

### **Specific Test Class/Function**
```bash
# Single test class
python -m pytest src/test/unit/test_experiment_tracker.py::TestExperimentTrackerInit -v

# Single test function
python -m pytest src/test/unit/test_experiment_tracker.py::TestExperimentTrackerInit::test_init_creates_new_experiment -v
```

---

## 🛠️ Test Dependencies

### **Declared in pyproject.toml**
```
pytest>=9.0.2
mlflow>=3.8.1
xgboost>=3.1.3
scikit-learn>=1.8.0
pandas>=2.3.3
numpy>=2.4.1
boto3>=1.42.19  (for S3/MinIO)
```

### **model_pipeline/requirements.txt**
```
mlflow>=2.15.0,<2.20.0
xgboost>=2.0.0,<2.2.0
pandas>=2.0.0,<2.3.0
numpy>=1.24.0,<2.0.0
scikit-learn>=1.3.0,<1.6.0
shap>=0.44.0,<0.46.0      (for model explainability)
```

---

## 🔧 Configuration Files

### **pyproject.toml**
- Location: `./pyproject.toml`
- Contains: `pytest>=9.0.2` in dependencies
- Python requirement: `>=3.11`

### **Pytest Configuration**
- Uses default pytest discovery
- No pytest.ini file (uses pyproject.toml)
- Fixture autodiscovery from conftest.py

### **Test Markers**
```python
@pytest.mark.e2e           # End-to-end tests
@pytest.mark.slow          # Long-running tests
@pytest.mark.requires_mlflow  # Needs MLflow server
```

---

## 🚀 CI/CD Integration Examples

### **GitHub Actions**
```yaml
- name: Run Backend Tests
  run: |
    cd model_pipeline
    python -m pytest src/test/unit/ -v --tb=short
```

### **GitLab CI**
```yaml
test:backend:unit:
  script:
    - cd model_pipeline
    - python -m pytest src/test/unit/ -v
    
test:backend:full:
  script:
    - cd model_pipeline
    - python -m pytest src/test/ -v -m "not requires_mlflow"
```

### **Pre-commit Hook**
```bash
#!/bin/bash
cd model_pipeline
python -m pytest src/test/unit/ -q || exit 1
```

---

## 📋 Test Fixtures Available

| Fixture Name | Scope | Returns | Purpose |
|--------------|-------|---------|---------|
| `test_data_dir` | session | Path | Temp directory for test artifacts |
| `sample_config` | function | dict | MLflow + model + features config |
| `sample_config_file` | function | Path | Config as YAML file |
| `sample_training_data` | function | DataFrame | 500-row synthetic dataset |
| `sample_train_test_split` | function | tuple[DataFrame, DataFrame] | Train/test data split |

---

## ⚠️ Test Requirements & Constraints

### **Unit Tests** ✅
- No external services required
- Fully mocked MLflow
- <5 second execution
- Safe to run in CI/CD every commit

### **Integration Tests**
- Requires core Python packages (pandas, numpy, sklearn, xgboost)
- Mocked MLflow (no server needed)
- 10-30 second execution

### **E2E Tests**
- **Requires**: Running MLflow server at `http://localhost:5000`
- **Requires**: MinIO at `http://localhost:9000`
- **Requires**: PostgreSQL backend (auto-started with ./infra/docker/run.sh)
- 30-120 second execution
- Should run on main branch or before production deployment

---

## 🔍 Test Discovery & Organization

### **Pytest Auto-Discovery**
```
model_pipeline/src/test/
├── test_*.py              # Discovers: test_experiment_tracker.py
├── *_test.py              # Would discover if named like this
├── conftest.py            # Automatic fixture discovery
└── fixtures/              # Manual fixture files (referenced in conftest)
```

### **Test Naming Convention**
- File prefix: `test_*.py`
- Class prefix: `Test*`
- Function prefix: `test_*`

Example: `test_experiment_tracker.py::TestExperimentTrackerInit::test_init_creates_new_experiment`

---

## 🎯 Recommended Test Flow

### **Development (Before Commit)**
```bash
# Quick unit test check
pytest src/test/unit/ -q
```

### **Pre-Push (Before Push to Remote)**
```bash
# Full integration without MLflow
pytest src/test/ -v -m "not requires_mlflow"
```

### **CI/CD Pipeline**
```bash
# Stage 1: Unit tests (always)
pytest src/test/unit/ -v

# Stage 2: Integration tests (on merge)
pytest src/test/integration/test_integration_training_pipeline.py -v

# Stage 3: E2E tests (on main branch only)
# Requires MLflow running, skip if not available
```

---

## 📞 Debugging & Troubleshooting

### **Common Issues**

| Problem | Cause | Solution |
|---------|-------|----------|
| `ModuleNotFoundError: src` | Wrong working directory | Run from `./model_pipeline` |
| E2E test timeout | MLflow not running | `cd infra/docker && ./run.sh up` |
| `ConnectionError` | MLflow server down | Check http://localhost:5000 |
| Import errors | Missing dependencies | `pip install -r requirements.txt` |
| Fixture not found | conftest.py not read | Ensure in src/test/ directory |

### **Debug Commands**
```bash
# List all tests
pytest src/test/ --collect-only -q

# Show test output
pytest src/test/ -v -s

# Show full traceback
pytest src/test/ --tb=long

# Stop on first failure
pytest src/test/ -x

# Run with Python debugger
pytest src/test/unit/test_experiment_tracker.py --pdb
```

---

## ✅ Health Check Checklist

Before marking backend tests as "healthy":

- [ ] Unit tests pass in <10 seconds
- [ ] No import errors when running `pytest src/test/ --collect-only`
- [ ] Fixtures load correctly
- [ ] Mock patches work as expected
- [ ] Integration tests pass (without MLflow)
- [ ] E2E tests pass (with MLflow running)
- [ ] Coverage report generates without errors

---

## 📚 Key Resources

| Resource | Location | Purpose |
|----------|----------|---------|
| Main test guide | `./PYTHON_BACKEND_TEST_GUIDE.md` | Comprehensive documentation |
| Quick reference | `./TEST_QUICK_REFERENCE.md` | Fast lookup commands |
| Test inventory | This file | Complete file inventory |
| conftest.py | `./model_pipeline/src/test/conftest.py` | Fixture definitions |
| Project README | `./README.md` | Project overview |
| Model pipeline README | `./model_pipeline/README.md` | Model-specific details |
| Pytest docs | https://docs.pytest.org/ | Official pytest documentation |

---

## 🎬 Quick Start

```bash
# 1. Navigate to model pipeline
cd ./model_pipeline

# 2. Run unit tests (5 seconds, no setup)
python -m pytest src/test/unit/ -v

# 3. If all pass ✅, you're good to go!
```

---

**Last Updated**: 2026-03-15  
**Status**: ✅ Complete - All test locations identified and catalogued

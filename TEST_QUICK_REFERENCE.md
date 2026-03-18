# Backend Test Quick Reference

## 🚀 Start Testing in 30 Seconds

```bash
cd ./model_pipeline
python -m pytest src/test/unit/ -v
```

---

## 📍 Test Locations

```
./model_pipeline/src/test/
├── unit/
│   └── test_experiment_tracker.py ............ 20+ tests (5 sec)
├── integration/
│   ├── test_integration_training_pipeline.py. Integration tests (30 sec)
│   └── test_e2e.py ........................... Full MLOps cycle (120 sec, needs MLflow)
└── conftest.py ............................. Shared fixtures & config
```

---

## ⚡ Common Commands

| Command | What It Does | Time |
|---------|-------------|------|
| `pytest src/test/unit/ -v` | Run unit tests | 5 sec ✅ |
| `pytest src/test/integration/ -v` | Run integration tests | 30 sec |
| `pytest src/test/ -v` | Run all tests | 60 sec (with MLflow) |
| `pytest src/test/ -v -s` | Run + show output | 60 sec |
| `pytest src/test/ -x` | Stop on first failure | varies |
| `pytest src/test/unit/ -k experiment` | Run tests matching "experiment" | 5 sec |
| `pytest src/test/ --cov=src` | Run with coverage report | 70 sec |

---

## 🧪 Test Suite Overview

### Unit Tests ✅ (No Dependencies)
- **File**: `test_experiment_tracker.py`
- **Tests**: 20+ (ExperimentTracker class methods)
- **Mocking**: Full MLflow mock
- **Time**: <5 seconds
- **Command**: `pytest src/test/unit/ -v`

### Integration Tests ⚠️ (Light Dependencies)
- **File**: `test_integration_training_pipeline.py`
- **Tests**: Full pipeline (data → train → log → save)
- **Mocking**: Mocked MLflow
- **Time**: 10-30 seconds
- **Command**: `pytest src/test/integration/test_integration_training_pipeline.py -v`

### E2E Tests ⚠️⚠️ (Requires MLflow Server)
- **File**: `test_e2e.py`
- **Tests**: Real MLflow, real small dataset
- **Markers**: `@pytest.mark.e2e`, `@pytest.mark.requires_mlflow`
- **Time**: 30-120 seconds
- **Requirement**: `http://localhost:5000` (MLflow running)
- **Command**: `pytest src/test/integration/test_e2e.py -v -s -m e2e`

---

## 🛠️ Before Committing

```bash
# Quick check (5 seconds)
pytest src/test/unit/ -v --tb=short

# If passes → ready to commit ✅
```

---

## 🔧 Before Pushing

```bash
# Full check (60 seconds, no MLflow needed)
pytest src/test/ -v -m "not requires_mlflow"

# If passes → safe to push ✅
```

---

## 🌐 Setup for Full Testing

```bash
# Terminal 1: Start MLflow infrastructure
cd ./infra/docker
./run.sh up

# Terminal 2: Run all tests
cd ./model_pipeline
pytest src/test/ -v --cov=src

# Cleanup
# Terminal 1: Ctrl+C or
./run.sh down
```

---

## 📋 Test Fixtures Available

| Fixture | What It Provides | Usage |
|---------|-----------------|-------|
| `test_data_dir` | Temp folder for test artifacts | `def test_foo(test_data_dir):` |
| `sample_config` | MLflow + model config dict | `def test_bar(sample_config):` |
| `sample_config_file` | Config YAML file path | `def test_baz(sample_config_file):` |
| `sample_training_data` | 500-row synthetic DataFrame | `def test_data(sample_training_data):` |

---

## 🆘 Troubleshooting

| Problem | Solution |
|---------|----------|
| `ModuleNotFoundError: src` | Run from `./model_pipeline` directory |
| E2E tests timeout | Start MLflow: `cd infra/docker && ./run.sh up` |
| Tests hang | Check MLflow status: `curl http://localhost:5000` |
| Import errors | Install deps: `pip install -r requirements.txt` |

---

## 📊 Coverage Target

Run with coverage:
```bash
pytest src/test/ --cov=src --cov-report=html --cov-report=term-missing
```

Aim for: **>80% coverage**

---

## 🎯 CI/CD Pipeline Setup

**For GitHub Actions**:
```yaml
- name: Run Backend Tests
  run: |
    cd model_pipeline
    python -m pytest src/test/unit/ -v --tb=short
```

**For GitLab CI**:
```yaml
test:backend:
  script:
    - cd model_pipeline
    - python -m pytest src/test/unit/ -v
```

---

## 📞 Help Commands

```bash
# List all test functions
pytest src/test/ --collect-only -q

# Show test summary
pytest src/test/ -v --tb=no

# Verbose fixture info
pytest --fixtures src/test/conftest.py
```

---

**Last Updated**: 2026-03-15  
**Status**: ✅ All tests functional and documented

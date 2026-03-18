"""
Shared pytest fixtures and configuration for all tests.
"""

import pytest
import pandas as pd
import numpy as np
import tempfile
from pathlib import Path
import yaml
import os


@pytest.fixture(scope="session")
def test_data_dir():
    """Create temp folder for test data"""
    with tempfile.TemporaryDirectory() as tmpdir:
        yield Path(tmpdir)


@pytest.fixture
def sample_config():
    """Load sample configuration for testing"""
    return {
        "mlflow": {
            "tracking_uri": "http://localhost:5000",
            "experiment_name": "test_experiment",
            "artifact_location": "s3://mlflow/",
            "registry_uri": "http://localhost:5000",
            "tags": {
                "task": "cart-to-purchase",
                "purpose": "test",
            },
        },
        "model": {
            "model_type": "logistic_regression",
            "name": "test_model",
            "version": "1.0.0",
            "type": "classifier",
            "train_test_split": 0.2,
            "random_state": 42,
            "parameters": {
                "C": 1.0,
                "max_iter": 100,
                "solver": "lbfgs",
                "random_state": 42,
            },
        },
        "evaluation": {
            "thresholds": {
                "accuracy_score": 0.7,
                "f1_score": 0.6,
            }
        },
        "features": {
            "target_column": "is_purchased",
            "training_features": [
                "price",
                "activity_count",
                "event_weekday",
                "event_hour",
                "user_total_events",
                "user_total_views",
                "user_total_carts",
            ],
        },
    }


@pytest.fixture
def sample_config_file(sample_config, test_data_dir):
    """Write sample config to a file and return path"""
    config_path = test_data_dir / "sample_config.yaml"
    with open(config_path, "w") as f:
        yaml.dump(sample_config, f)
    return config_path


@pytest.fixture
def sample_training_data():
    """Generate sample training data for testing"""
    np.random.seed(42)
    n_samples = 500

    data = pd.DataFrame(
        {
            "price": np.random.uniform(10, 500, n_samples),
            "activity_count": np.random.randint(1, 50, n_samples),
            "event_weekday": np.random.randint(0, 7, n_samples),
            "event_hour": np.random.randint(0, 24, n_samples),
            "user_total_events": np.random.randint(1, 100, n_samples),
            "user_total_views": np.random.randint(1, 80, n_samples),
            "user_total_carts": np.random.randint(0, 20, n_samples),
            "user_total_purchases": np.random.randint(0, 10, n_samples),
            "user_view_to_cart_rate": np.random.uniform(0, 1, n_samples),
            "user_cart_to_purchase_rate": np.random.uniform(0, 1, n_samples),
            "brand": np.random.choice(
                ["apple", "samsung", "xiaomi", "huawei"], n_samples
            ),
            "category_code_level1": np.random.choice(
                ["electronics", "clothing", "home"], n_samples
            ),
            "category_code_level2": np.random.choice(
                ["phone", "laptop", "tablet"], n_samples
            ),
            "is_purchased": np.random.randint(0, 2, n_samples),
        }
    )

    return data


@pytest.fixture
def sample_eval_data(sample_training_data):
    """Generate sample evaluation data (subset of training data)"""
    return sample_training_data.sample(n=100, random_state=42).reset_index(drop=True)


@pytest.fixture
def mock_mlflow_client():
    """Create a mock MLflow client"""
    from unittest.mock import Mock, MagicMock

    client = Mock()

    # Mock experiment methods
    client.get_experiment_by_name.return_value = None
    client.create_experiment.return_value = "test_exp_id"

    # Mock run methods
    mock_run = Mock()
    mock_run.info.run_id = "test_run_id"
    mock_run.data.metrics = {"accuracy": 0.85, "f1_score": 0.80}
    mock_run.data.params = {"C": "1.0", "max_iter": "100"}
    client.get_run.return_value = mock_run

    # Mock search methods
    client.search_runs.return_value = [mock_run]

    return client


@pytest.fixture(autouse=True)
def reset_mlflow():
    """Reset mlflow state between tests"""
    import mlflow

    try:
        mlflow.end_run()
    except Exception:
        pass

    yield

    try:
        mlflow.end_run()
    except Exception:
        pass


@pytest.fixture(scope="session", autouse=True)
def setup_test_env():
    """Set up test environment variables"""
    original_env = os.environ.copy()

    # Set test environment variables
    os.environ["AWS_ACCESS_KEY_ID"] = "test_key"
    os.environ["AWS_SECRET_ACCESS_KEY"] = "test_secret"
    os.environ["MLFLOW_S3_ENDPOINT_URL"] = "http://localhost:9000"
    os.environ["MLFLOW_TRACKING_URI"] = "http://localhost:5000"

    yield

    # Restore original environment
    os.environ.clear()
    os.environ.update(original_env)


# Custom pytest markers
def pytest_configure(config):
    """Register custom markers"""
    config.addinivalue_line(
        "markers", "e2e: mark test as end-to-end test (requires MLflow server)"
    )
    config.addinivalue_line("markers", "slow: mark test as slow running")
    config.addinivalue_line(
        "markers", "requires_mlflow: mark test as requiring MLflow server"
    )

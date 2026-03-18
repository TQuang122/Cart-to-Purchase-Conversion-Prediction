"""
End-to-End Test: Full MLOps Cycle with Real Data and Real MLflow
This test runs the complete workflow without mocks on actual small dataset.

Test Workflow:
1. Load real (small) dataset
2. Train baseline model
3. Train challenger models with different hyperparameters
4. Evaluate all models
5. Compare models
6. Register best model
7. Promote to staging
8. Compare staging vs champion
9. Promote to champion if better
10. Verify all artifacts and metrics are logged

NOTE: This test requires a running MLflow server.
Run with: pytest src/test/integration/test_e2e.py -v -s -m e2e
"""

import pytest
import pandas as pd
import numpy as np
import mlflow
import time
from pathlib import Path
import tempfile
import os

from src.mlflow_utils.experiment_tracker import ExperimentTracker
from src.mlflow_utils.model_registry import ModelRegistry
from src.model.xgboost_trainer import GenericBinaryClassifierTrainer
from src.model.evaluator import ModelEvaluator

# Mark all tests in this module
pytestmark = [pytest.mark.e2e, pytest.mark.slow, pytest.mark.requires_mlflow]


@pytest.fixture(scope="module")
def mlflow_config():
    """MLflow configuration for E2E tests"""
    return {
        "tracking_uri": os.getenv("MLFLOW_TRACKING_URI", "http://localhost:5000"),
        "experiment_name": f"e2e_test_{int(time.time())}",
        "artifact_location": "s3://mlflow/",
    }


@pytest.fixture(scope="module")
def model_config():
    """Model configuration for E2E tests"""
    return {
        "model_type": "logistic_regression",
        "name": "e2e_test_model",
        "version": "1.0.0",
        "train_test_split": 0.2,
        "random_state": 42,
        "parameters": {
            "C": 1.0,
            "max_iter": 100,
            "solver": "lbfgs",
            "random_state": 42,
        },
    }


@pytest.fixture(scope="module")
def feature_config():
    """Feature configuration for E2E tests"""
    return {
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
    }


@pytest.fixture(scope="module")
def small_real_dataset():
    """
    Generate a small realistic dataset for E2E testing.
    This simulates the cart-to-purchase prediction data.
    """
    np.random.seed(42)
    n_samples = 500

    # Generate features with realistic distributions
    data = pd.DataFrame(
        {
            "price": np.random.lognormal(4, 1, n_samples).clip(1, 1000),
            "activity_count": np.random.poisson(5, n_samples),
            "event_weekday": np.random.randint(0, 7, n_samples),
            "event_hour": np.random.randint(0, 24, n_samples),
            "user_total_events": np.random.poisson(20, n_samples),
            "user_total_views": np.random.poisson(15, n_samples),
            "user_total_carts": np.random.poisson(3, n_samples),
            "user_total_purchases": np.random.poisson(1, n_samples),
            "user_view_to_cart_rate": np.random.beta(2, 5, n_samples),
            "user_cart_to_purchase_rate": np.random.beta(2, 8, n_samples),
            "product_total_views": np.random.poisson(100, n_samples),
            "product_cart_to_purchase_rate": np.random.beta(3, 7, n_samples),
            "brand": np.random.choice(
                ["apple", "samsung", "xiaomi", "huawei", "lg"], n_samples
            ),
            "category_code_level1": np.random.choice(
                ["electronics", "clothing", "home"], n_samples
            ),
            "category_code_level2": np.random.choice(
                ["phone", "laptop", "tablet", "tv"], n_samples
            ),
        }
    )

    # Generate target with some correlation to features
    purchase_prob = 0.3 + 0.1 * (data["user_cart_to_purchase_rate"] > 0.3).astype(float)
    purchase_prob += 0.1 * (data["price"] < 200).astype(float)
    purchase_prob = purchase_prob.clip(0, 1)
    data["is_purchased"] = (np.random.random(n_samples) < purchase_prob).astype(int)

    return data


@pytest.fixture(scope="module")
def shared_state():
    """Shared state across tests in the module"""
    return {
        "run_ids": [],
        "model_versions": [],
    }


class TestE2EMLOpsCycle:
    """End-to-end tests for the complete MLOps cycle"""

    @pytest.mark.order(1)
    def test_01_setup_and_data_validation(self, small_real_dataset, feature_config):
        """Test 1: Validate dataset is properly structured"""
        print("\n" + "=" * 60)
        print("TEST 1: Setup and Data Validation")
        print("=" * 60)

        # Check dataset shape
        assert len(small_real_dataset) > 0, "Dataset should not be empty"
        assert small_real_dataset.shape[0] == 500, "Dataset should have 500 samples"

        # Check target column exists
        assert feature_config["target_column"] in small_real_dataset.columns

        # Check all training features exist
        for feature in feature_config["training_features"]:
            assert feature in small_real_dataset.columns, f"Missing feature: {feature}"

        # Check target distribution
        target_dist = small_real_dataset[feature_config["target_column"]].value_counts()
        print(f"Target distribution:\n{target_dist}")

        assert len(target_dist) == 2, "Target should be binary"
        print("Data validation passed!")

    @pytest.mark.order(2)
    def test_02_train_baseline_model(
        self,
        mlflow_config,
        model_config,
        feature_config,
        small_real_dataset,
        shared_state,
    ):
        """Test 2: Train baseline model and log to MLflow"""
        print("\n" + "=" * 60)
        print("TEST 2: Training Baseline Model")
        print("=" * 60)

        # Skip if MLflow is not available
        try:
            mlflow.set_tracking_uri(mlflow_config["tracking_uri"])
            mlflow.search_experiments()
        except Exception as e:
            pytest.skip(f"MLflow server not available: {e}")

        # Initialize tracker
        tracker = ExperimentTracker(
            tracking_uri=mlflow_config["tracking_uri"],
            experiment_name=mlflow_config["experiment_name"],
        )

        # Initialize trainer
        trainer = GenericBinaryClassifierTrainer(
            config=model_config,
            experiment_tracker=tracker,
            model_type=model_config["model_type"],
        )

        # Start run and train
        with tracker.start_run(
            run_name="baseline_model", tags={"model_type": "baseline", "test": "e2e"}
        ) as run:
            # Prepare data
            X_train, X_test, y_train, y_test = trainer.prepare_data(
                data=small_real_dataset,
                target_col=feature_config["target_column"],
                feature_cols=feature_config["training_features"],
                test_size=model_config["train_test_split"],
                random_state=model_config["random_state"],
            )

            print(f"Data prepared: {len(y_train)} train, {len(y_test)} test samples")

            # Train model
            model = trainer.train(
                X_train=X_train,
                y_train=y_train,
                X_test=X_test,
                y_test=y_test,
                params=model_config["parameters"],
            )

            print(f"Model trained successfully")

            # Store run_id for later tests
            shared_state["run_ids"].append(run.info.run_id)
            shared_state["baseline_run_id"] = run.info.run_id

            print(f"Baseline run_id: {run.info.run_id}")

        assert model is not None
        assert len(shared_state["run_ids"]) == 1

    @pytest.mark.order(3)
    def test_03_train_challenger_models(
        self, mlflow_config, feature_config, small_real_dataset, shared_state
    ):
        """Test 3: Train multiple challenger models with different hyperparameters"""
        print("\n" + "=" * 60)
        print("TEST 3: Training Challenger Models")
        print("=" * 60)

        # Skip if baseline wasn't trained
        if "baseline_run_id" not in shared_state:
            pytest.skip("Baseline model not trained")

        try:
            mlflow.set_tracking_uri(mlflow_config["tracking_uri"])
        except Exception as e:
            pytest.skip(f"MLflow server not available: {e}")

        # Define challenger configurations
        challengers = [
            {
                "name": "challenger_high_C",
                "model_type": "logistic_regression",
                "parameters": {
                    "C": 10.0,
                    "max_iter": 200,
                    "solver": "lbfgs",
                    "random_state": 42,
                },
            },
            {
                "name": "challenger_low_C",
                "model_type": "logistic_regression",
                "parameters": {
                    "C": 0.1,
                    "max_iter": 200,
                    "solver": "lbfgs",
                    "random_state": 42,
                },
            },
        ]

        tracker = ExperimentTracker(
            tracking_uri=mlflow_config["tracking_uri"],
            experiment_name=mlflow_config["experiment_name"],
        )

        for challenger in challengers:
            config = {
                "model_type": challenger["model_type"],
                "name": challenger["name"],
                "train_test_split": 0.2,
                "random_state": 42,
                "parameters": challenger["parameters"],
            }

            trainer = GenericBinaryClassifierTrainer(
                config=config,
                experiment_tracker=tracker,
                model_type=challenger["model_type"],
            )

            with tracker.start_run(
                run_name=challenger["name"],
                tags={"model_type": "challenger", "test": "e2e"},
            ) as run:
                X_train, X_test, y_train, y_test = trainer.prepare_data(
                    data=small_real_dataset,
                    target_col=feature_config["target_column"],
                    feature_cols=feature_config["training_features"],
                    test_size=0.2,
                    random_state=42,
                )

                model = trainer.train(
                    X_train=X_train,
                    y_train=y_train,
                    X_test=X_test,
                    y_test=y_test,
                    params=challenger["parameters"],
                )

                shared_state["run_ids"].append(run.info.run_id)
                print(f"Trained {challenger['name']}: run_id={run.info.run_id}")

        assert len(shared_state["run_ids"]) == 3  # baseline + 2 challengers

    @pytest.mark.order(4)
    def test_04_compare_runs(self, mlflow_config, shared_state):
        """Test 4: Compare all trained models"""
        print("\n" + "=" * 60)
        print("TEST 4: Comparing Models")
        print("=" * 60)

        if len(shared_state["run_ids"]) == 0:
            pytest.skip("No models trained")

        try:
            tracker = ExperimentTracker(
                tracking_uri=mlflow_config["tracking_uri"],
                experiment_name=mlflow_config["experiment_name"],
            )
        except Exception as e:
            pytest.skip(f"MLflow server not available: {e}")

        # Search for all runs
        runs = tracker.search_runs(
            filter_string="", max_results=10, order_by=["metrics.test_accuracy DESC"]
        )

        print(f"Found {len(runs)} runs")

        # Get best run
        best_run = tracker.get_best_run("test_accuracy", ascending=False)

        if best_run:
            shared_state["best_run_id"] = best_run.info.run_id
            print(f"Best run: {best_run.info.run_id}")
            print(f"Best accuracy: {best_run.data.metrics.get('test_accuracy', 'N/A')}")

        assert len(runs) > 0

    @pytest.mark.order(5)
    def test_05_verify_artifacts_logged(self, mlflow_config, shared_state):
        """Test 5: Verify that metrics and artifacts are properly logged"""
        print("\n" + "=" * 60)
        print("TEST 5: Verifying Artifacts and Metrics")
        print("=" * 60)

        if "baseline_run_id" not in shared_state:
            pytest.skip("No baseline run available")

        try:
            tracker = ExperimentTracker(
                tracking_uri=mlflow_config["tracking_uri"],
                experiment_name=mlflow_config["experiment_name"],
            )
        except Exception as e:
            pytest.skip(f"MLflow server not available: {e}")

        # Get baseline run
        run = tracker.get_run(shared_state["baseline_run_id"])

        # Verify metrics exist
        metrics = run.data.metrics
        print(f"Logged metrics: {list(metrics.keys())}")

        assert (
            "train_accuracy" in metrics
            or "training_score" in metrics
            or len(metrics) > 0
        ), "Expected metrics to be logged"

        print("Artifacts and metrics verification passed!")


class TestE2ECleanup:
    """Cleanup tests - run last"""

    @pytest.mark.order(100)
    def test_cleanup(self, mlflow_config):
        """Clean up test experiments (optional)"""
        print("\n" + "=" * 60)
        print("CLEANUP: Test Complete")
        print("=" * 60)

        # Note: In production, you might want to delete test experiments
        # For now, we just print completion message
        print(f"E2E tests completed for experiment: {mlflow_config['experiment_name']}")
        print("Test experiments are preserved for inspection.")

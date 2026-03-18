"""
Integration tests for the complete training pipeline.
Tests the workflow: Data preparation -> Training -> Logging -> Model saving
Uses mocked MLflow to avoid requiring a running server.
"""

import pytest
import pandas as pd
import numpy as np
import tempfile
import os
from unittest.mock import Mock, patch, MagicMock
from pathlib import Path

from src.mlflow_utils.experiment_tracker import ExperimentTracker
from src.model.xgboost_trainer import GenericBinaryClassifierTrainer


@pytest.fixture
def sample_training_data():
    """Generate sample training data for testing"""
    np.random.seed(42)
    n_samples = 1000

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
def training_config():
    """Sample training configuration"""
    return {
        "mlflow": {
            "tracking_uri": "http://localhost:5000",
            "experiment_name": "test_integration_experiment",
            "artifact_location": "s3://mlflow/",
        },
        "model": {
            "model_type": "logistic_regression",
            "name": "test_model",
            "version": "1.0.0",
            "train_test_split": 0.2,
            "random_state": 42,
            "parameters": {
                "C": 1.0,
                "max_iter": 100,
                "solver": "lbfgs",
                "random_state": 42,
            },
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


class TestDataPreparation:
    """Tests for data preparation step"""

    @patch("src.mlflow_utils.experiment_tracker.mlflow")
    @patch("src.mlflow_utils.experiment_tracker.MlflowClient")
    def test_prepare_data_splits_correctly(
        self, mock_client, mock_mlflow, training_config, sample_training_data
    ):
        """Test that data is split into correct proportions"""
        # Arrange
        mock_experiment = Mock()
        mock_experiment.experiment_id = "test_exp_id"
        mock_mlflow.get_experiment_by_name.return_value = mock_experiment

        tracker = ExperimentTracker(
            tracking_uri=training_config["mlflow"]["tracking_uri"],
            experiment_name=training_config["mlflow"]["experiment_name"],
        )

        trainer = GenericBinaryClassifierTrainer(
            config=training_config["model"],
            experiment_tracker=tracker,
            model_type=training_config["model"]["model_type"],
        )

        # Act
        X_train, X_test, y_train, y_test = trainer.prepare_data(
            data=sample_training_data,
            target_col=training_config["features"]["target_column"],
            feature_cols=training_config["features"]["training_features"],
            test_size=training_config["model"]["train_test_split"],
            random_state=training_config["model"]["random_state"],
        )

        # Assert
        total_samples = len(sample_training_data)
        expected_train = int(total_samples * 0.8)
        expected_test = total_samples - expected_train

        assert len(X_train) == expected_train
        assert len(X_test) == expected_test
        assert len(y_train) == expected_train
        assert len(y_test) == expected_test
        assert trainer.feature_names == training_config["features"]["training_features"]

    @patch("src.mlflow_utils.experiment_tracker.mlflow")
    @patch("src.mlflow_utils.experiment_tracker.MlflowClient")
    def test_prepare_data_preserves_class_distribution(
        self, mock_client, mock_mlflow, training_config, sample_training_data
    ):
        """Test that stratified split preserves class distribution"""
        # Arrange
        mock_experiment = Mock()
        mock_experiment.experiment_id = "test_exp_id"
        mock_mlflow.get_experiment_by_name.return_value = mock_experiment

        tracker = ExperimentTracker(
            tracking_uri=training_config["mlflow"]["tracking_uri"],
            experiment_name=training_config["mlflow"]["experiment_name"],
        )

        trainer = GenericBinaryClassifierTrainer(
            config=training_config["model"],
            experiment_tracker=tracker,
            model_type=training_config["model"]["model_type"],
        )

        # Act
        X_train, X_test, y_train, y_test = trainer.prepare_data(
            data=sample_training_data,
            target_col=training_config["features"]["target_column"],
            feature_cols=training_config["features"]["training_features"],
            test_size=0.2,
            random_state=42,
        )

        # Assert - class distribution should be similar
        original_ratio = sample_training_data["is_purchased"].mean()
        train_ratio = y_train.mean()
        test_ratio = y_test.mean()

        # Allow 5% tolerance
        assert abs(train_ratio - original_ratio) < 0.05
        assert abs(test_ratio - original_ratio) < 0.05


class TestModelTraining:
    """Tests for model training step"""

    @patch("src.mlflow_utils.experiment_tracker.mlflow")
    @patch("src.mlflow_utils.experiment_tracker.MlflowClient")
    @patch("src.model.xgboost_trainer.mlflow")
    def test_train_logistic_regression(
        self,
        mock_trainer_mlflow,
        mock_client,
        mock_tracker_mlflow,
        training_config,
        sample_training_data,
    ):
        """Test training a logistic regression model"""
        # Arrange
        mock_experiment = Mock()
        mock_experiment.experiment_id = "test_exp_id"
        mock_tracker_mlflow.get_experiment_by_name.return_value = mock_experiment

        tracker = ExperimentTracker(
            tracking_uri=training_config["mlflow"]["tracking_uri"],
            experiment_name=training_config["mlflow"]["experiment_name"],
        )

        trainer = GenericBinaryClassifierTrainer(
            config=training_config["model"],
            experiment_tracker=tracker,
            model_type="logistic_regression",
        )

        X_train, X_test, y_train, y_test = trainer.prepare_data(
            data=sample_training_data,
            target_col=training_config["features"]["target_column"],
            feature_cols=training_config["features"]["training_features"],
            test_size=0.2,
            random_state=42,
        )

        # Act
        model = trainer.train(
            X_train=X_train,
            y_train=y_train,
            X_test=X_test,
            y_test=y_test,
            params=training_config["model"]["parameters"],
        )

        # Assert
        assert model is not None
        assert trainer.model is not None
        assert hasattr(model, "predict")
        assert hasattr(model, "predict_proba")

    @patch("src.mlflow_utils.experiment_tracker.mlflow")
    @patch("src.mlflow_utils.experiment_tracker.MlflowClient")
    @patch("src.model.xgboost_trainer.mlflow")
    def test_train_random_forest(
        self,
        mock_trainer_mlflow,
        mock_client,
        mock_tracker_mlflow,
        sample_training_data,
    ):
        """Test training a random forest model"""
        # Arrange
        config = {
            "model_type": "random_forest",
            "name": "test_rf_model",
            "train_test_split": 0.2,
            "random_state": 42,
            "parameters": {
                "n_estimators": 10,
                "max_depth": 5,
                "random_state": 42,
            },
        }

        mock_experiment = Mock()
        mock_experiment.experiment_id = "test_exp_id"
        mock_tracker_mlflow.get_experiment_by_name.return_value = mock_experiment

        tracker = ExperimentTracker(
            tracking_uri="http://localhost:5000", experiment_name="test_rf_experiment"
        )

        trainer = GenericBinaryClassifierTrainer(
            config=config, experiment_tracker=tracker, model_type="random_forest"
        )

        feature_cols = ["price", "activity_count", "event_weekday"]
        X_train, X_test, y_train, y_test = trainer.prepare_data(
            data=sample_training_data,
            target_col="is_purchased",
            feature_cols=feature_cols,
            test_size=0.2,
            random_state=42,
        )

        # Act
        model = trainer.train(
            X_train=X_train,
            y_train=y_train,
            X_test=X_test,
            y_test=y_test,
            params=config["parameters"],
        )

        # Assert
        assert model is not None
        assert hasattr(model, "feature_importances_")

    @patch("src.mlflow_utils.experiment_tracker.mlflow")
    @patch("src.mlflow_utils.experiment_tracker.MlflowClient")
    @patch("src.model.xgboost_trainer.mlflow")
    def test_train_xgboost(
        self,
        mock_trainer_mlflow,
        mock_client,
        mock_tracker_mlflow,
        sample_training_data,
    ):
        """Test training an XGBoost model"""
        # Arrange
        config = {
            "model_type": "xgboost",
            "name": "test_xgb_model",
            "train_test_split": 0.2,
            "random_state": 42,
            "parameters": {
                "n_estimators": 10,
                "max_depth": 3,
                "learning_rate": 0.1,
                "random_state": 42,
            },
        }

        mock_experiment = Mock()
        mock_experiment.experiment_id = "test_exp_id"
        mock_tracker_mlflow.get_experiment_by_name.return_value = mock_experiment

        tracker = ExperimentTracker(
            tracking_uri="http://localhost:5000", experiment_name="test_xgb_experiment"
        )

        trainer = GenericBinaryClassifierTrainer(
            config=config, experiment_tracker=tracker, model_type="xgboost"
        )

        feature_cols = ["price", "activity_count", "event_weekday"]
        X_train, X_test, y_train, y_test = trainer.prepare_data(
            data=sample_training_data,
            target_col="is_purchased",
            feature_cols=feature_cols,
            test_size=0.2,
            random_state=42,
        )

        # Act
        model = trainer.train(
            X_train=X_train,
            y_train=y_train,
            X_test=X_test,
            y_test=y_test,
            params=config["parameters"],
        )

        # Assert
        assert model is not None
        assert hasattr(model, "feature_importances_")


class TestParameterFiltering:
    """Tests for deprecated parameter filtering"""

    @patch("src.mlflow_utils.experiment_tracker.mlflow")
    @patch("src.mlflow_utils.experiment_tracker.MlflowClient")
    def test_filter_deprecated_logistic_params(self, mock_client, mock_mlflow):
        """Test that deprecated logistic regression params are filtered"""
        # Arrange
        mock_experiment = Mock()
        mock_experiment.experiment_id = "test_exp_id"
        mock_mlflow.get_experiment_by_name.return_value = mock_experiment

        tracker = ExperimentTracker(
            tracking_uri="http://localhost:5000", experiment_name="test_experiment"
        )

        trainer = GenericBinaryClassifierTrainer(
            config={}, experiment_tracker=tracker, model_type="logistic_regression"
        )

        params = {
            "C": 1.0,
            "max_iter": 100,
            "multi_class": "auto",  # Deprecated
            "l1_ratio": None,  # Should be filtered (None value)
            "intercept_scaling": 1,  # Only for liblinear
        }

        # Act
        filtered = trainer._filter_params(params)

        # Assert
        assert "multi_class" not in filtered
        assert "l1_ratio" not in filtered
        assert "intercept_scaling" not in filtered
        assert filtered["C"] == 1.0
        assert filtered["max_iter"] == 100

    @patch("src.mlflow_utils.experiment_tracker.mlflow")
    @patch("src.mlflow_utils.experiment_tracker.MlflowClient")
    def test_filter_deprecated_xgboost_params(self, mock_client, mock_mlflow):
        """Test that deprecated XGBoost params are filtered"""
        # Arrange
        mock_experiment = Mock()
        mock_experiment.experiment_id = "test_exp_id"
        mock_mlflow.get_experiment_by_name.return_value = mock_experiment

        tracker = ExperimentTracker(
            tracking_uri="http://localhost:5000", experiment_name="test_experiment"
        )

        trainer = GenericBinaryClassifierTrainer(
            config={}, experiment_tracker=tracker, model_type="xgboost"
        )

        params = {
            "n_estimators": 100,
            "max_depth": 6,
            "use_label_encoder": False,  # Deprecated
        }

        # Act
        filtered = trainer._filter_params(params)

        # Assert
        assert "use_label_encoder" not in filtered
        assert filtered["n_estimators"] == 100
        assert filtered["max_depth"] == 6


class TestUnsupportedModelType:
    """Tests for handling unsupported model types"""

    @patch("src.mlflow_utils.experiment_tracker.mlflow")
    @patch("src.mlflow_utils.experiment_tracker.MlflowClient")
    def test_unsupported_model_type_raises_error(self, mock_client, mock_mlflow):
        """Test that unsupported model type raises ValueError"""
        # Arrange
        mock_experiment = Mock()
        mock_experiment.experiment_id = "test_exp_id"
        mock_mlflow.get_experiment_by_name.return_value = mock_experiment

        tracker = ExperimentTracker(
            tracking_uri="http://localhost:5000", experiment_name="test_experiment"
        )

        # Act & Assert
        with pytest.raises(ValueError) as excinfo:
            GenericBinaryClassifierTrainer(
                config={}, experiment_tracker=tracker, model_type="unsupported_model"
            )

        assert "model_type must be one of" in str(excinfo.value)
        assert "unsupported_model" in str(excinfo.value)


class TestCompleteTrainingPipeline:
    """Integration tests for complete training workflow"""

    @patch("src.mlflow_utils.experiment_tracker.mlflow")
    @patch("src.mlflow_utils.experiment_tracker.MlflowClient")
    @patch("src.model.xgboost_trainer.mlflow")
    def test_full_training_workflow(
        self,
        mock_trainer_mlflow,
        mock_client,
        mock_tracker_mlflow,
        training_config,
        sample_training_data,
    ):
        """Test complete training workflow from data to model"""
        # Arrange
        mock_experiment = Mock()
        mock_experiment.experiment_id = "test_exp_id"
        mock_tracker_mlflow.get_experiment_by_name.return_value = mock_experiment

        mock_run = Mock()
        mock_run.info.run_id = "test_run_id"
        mock_tracker_mlflow.start_run.return_value.__enter__ = Mock(
            return_value=mock_run
        )
        mock_tracker_mlflow.start_run.return_value.__exit__ = Mock(return_value=False)

        tracker = ExperimentTracker(
            tracking_uri=training_config["mlflow"]["tracking_uri"],
            experiment_name=training_config["mlflow"]["experiment_name"],
        )

        trainer = GenericBinaryClassifierTrainer(
            config=training_config["model"],
            experiment_tracker=tracker,
            model_type=training_config["model"]["model_type"],
        )

        # Act - Full workflow
        # 1. Prepare data
        X_train, X_test, y_train, y_test = trainer.prepare_data(
            data=sample_training_data,
            target_col=training_config["features"]["target_column"],
            feature_cols=training_config["features"]["training_features"],
            test_size=training_config["model"]["train_test_split"],
        )

        # 2. Train model
        model = trainer.train(
            X_train=X_train,
            y_train=y_train,
            X_test=X_test,
            y_test=y_test,
            params=training_config["model"]["parameters"],
        )

        # 3. Make predictions
        predictions = model.predict(X_test)
        probabilities = model.predict_proba(X_test)

        # Assert
        assert trainer.feature_names is not None
        assert len(trainer.feature_names) == len(
            training_config["features"]["training_features"]
        )
        assert model is not None
        assert len(predictions) == len(X_test)
        assert probabilities.shape == (len(X_test), 2)

        # Verify metrics logging was called
        mock_trainer_mlflow.sklearn.autolog.assert_called()

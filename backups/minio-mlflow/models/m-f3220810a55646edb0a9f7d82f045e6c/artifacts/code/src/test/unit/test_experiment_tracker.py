"""
Unit tests for ExperimentTracker class.
Tests individual methods with mocked MLflow dependencies.
"""

import pytest
from unittest.mock import Mock, patch, MagicMock
import mlflow

from src.mlflow_utils.experiment_tracker import ExperimentTracker


class TestExperimentTrackerInit:
    """Tests for ExperimentTracker initialization"""

    @patch("src.mlflow_utils.experiment_tracker.mlflow")
    @patch("src.mlflow_utils.experiment_tracker.MlflowClient")
    def test_init_creates_new_experiment(self, mock_client, mock_mlflow):
        """Test initialization when experiment doesn't exist"""
        # Arrange
        mock_mlflow.get_experiment_by_name.return_value = None
        mock_mlflow.create_experiment.return_value = "exp_123"

        # Act
        tracker = ExperimentTracker(
            tracking_uri="http://localhost:5000",
            experiment_name="test_experiment",
            artifact_location="s3://bucket/",
        )

        # Assert
        mock_mlflow.set_tracking_uri.assert_called_once_with("http://localhost:5000")
        mock_mlflow.create_experiment.assert_called_once_with(
            name="test_experiment", artifact_location="s3://bucket/"
        )
        assert tracker.experiment_id == "exp_123"

    @patch("src.mlflow_utils.experiment_tracker.mlflow")
    @patch("src.mlflow_utils.experiment_tracker.MlflowClient")
    def test_init_uses_existing_experiment(self, mock_client, mock_mlflow):
        """Test initialization when experiment already exists"""
        # Arrange
        mock_experiment = Mock()
        mock_experiment.experiment_id = "existing_exp_456"
        mock_mlflow.get_experiment_by_name.return_value = mock_experiment

        # Act
        tracker = ExperimentTracker(
            tracking_uri="http://localhost:5000", experiment_name="existing_experiment"
        )

        # Assert
        mock_mlflow.create_experiment.assert_not_called()
        assert tracker.experiment_id == "existing_exp_456"


class TestExperimentTrackerRun:
    """Tests for run management"""

    @patch("src.mlflow_utils.experiment_tracker.mlflow")
    @patch("src.mlflow_utils.experiment_tracker.MlflowClient")
    def test_start_run_context_manager(self, mock_client, mock_mlflow):
        """Test start_run as context manager"""
        # Arrange
        mock_experiment = Mock()
        mock_experiment.experiment_id = "exp_123"
        mock_mlflow.get_experiment_by_name.return_value = mock_experiment

        mock_run = Mock()
        mock_run.info.run_id = "run_abc"
        mock_mlflow.start_run.return_value.__enter__ = Mock(return_value=mock_run)
        mock_mlflow.start_run.return_value.__exit__ = Mock(return_value=False)

        tracker = ExperimentTracker(
            tracking_uri="http://localhost:5000", experiment_name="test_experiment"
        )

        # Act
        with tracker.start_run(run_name="test_run", tags={"key": "value"}) as run:
            # Assert
            mock_mlflow.start_run.assert_called_once()
            mock_mlflow.set_tags.assert_called_once_with({"key": "value"})

    @patch("src.mlflow_utils.experiment_tracker.mlflow")
    @patch("src.mlflow_utils.experiment_tracker.MlflowClient")
    def test_start_run_without_tags(self, mock_client, mock_mlflow):
        """Test start_run without tags"""
        # Arrange
        mock_experiment = Mock()
        mock_experiment.experiment_id = "exp_123"
        mock_mlflow.get_experiment_by_name.return_value = mock_experiment

        mock_run = Mock()
        mock_run.info.run_id = "run_abc"
        mock_mlflow.start_run.return_value.__enter__ = Mock(return_value=mock_run)
        mock_mlflow.start_run.return_value.__exit__ = Mock(return_value=False)

        tracker = ExperimentTracker(
            tracking_uri="http://localhost:5000", experiment_name="test_experiment"
        )

        # Act
        with tracker.start_run(run_name="test_run"):
            # Assert - set_tags should not be called when tags is None
            mock_mlflow.set_tags.assert_not_called()


class TestExperimentTrackerLogging:
    """Tests for logging methods"""

    @pytest.fixture
    def tracker(self):
        """Create a tracker with mocked dependencies"""
        with (
            patch("src.mlflow_utils.experiment_tracker.mlflow") as mock_mlflow,
            patch("src.mlflow_utils.experiment_tracker.MlflowClient"),
        ):
            mock_experiment = Mock()
            mock_experiment.experiment_id = "exp_123"
            mock_mlflow.get_experiment_by_name.return_value = mock_experiment

            tracker = ExperimentTracker(
                tracking_uri="http://localhost:5000", experiment_name="test_experiment"
            )
            tracker._mock_mlflow = mock_mlflow
            yield tracker

    def test_log_param(self, tracker):
        """Test logging a single parameter"""
        with patch("src.mlflow_utils.experiment_tracker.mlflow") as mock_mlflow:
            tracker.log_param("learning_rate", 0.01)
            mock_mlflow.log_param.assert_called_once_with("learning_rate", 0.01)

    def test_log_params(self, tracker):
        """Test logging multiple parameters"""
        with patch("src.mlflow_utils.experiment_tracker.mlflow") as mock_mlflow:
            params = {"learning_rate": 0.01, "max_depth": 6}
            tracker.log_params(params)
            mock_mlflow.log_params.assert_called_once_with(params)

    def test_log_metric(self, tracker):
        """Test logging a single metric"""
        with patch("src.mlflow_utils.experiment_tracker.mlflow") as mock_mlflow:
            tracker.log_metric("accuracy", 0.95, step=10)
            mock_mlflow.log_metric.assert_called_once_with("accuracy", 0.95, step=10)

    def test_log_metrics(self, tracker):
        """Test logging multiple metrics"""
        with patch("src.mlflow_utils.experiment_tracker.mlflow") as mock_mlflow:
            metrics = {"accuracy": 0.95, "f1_score": 0.92}
            tracker.log_metrics(metrics, step=5)
            mock_mlflow.log_metrics.assert_called_once_with(metrics, step=5)

    def test_log_artifact(self, tracker):
        """Test logging an artifact"""
        with patch("src.mlflow_utils.experiment_tracker.mlflow") as mock_mlflow:
            tracker.log_artifact("/path/to/file.txt", "artifacts/")
            mock_mlflow.log_artifact.assert_called_once_with(
                "/path/to/file.txt", "artifacts/"
            )

    def test_log_dict(self, tracker):
        """Test logging a dictionary as JSON"""
        with patch("src.mlflow_utils.experiment_tracker.mlflow") as mock_mlflow:
            data = {"key": "value", "number": 42}
            tracker.log_dict(data, "config.json")
            mock_mlflow.log_dict.assert_called_once_with(data, "config.json")

    def test_set_tag(self, tracker):
        """Test setting a single tag"""
        with patch("src.mlflow_utils.experiment_tracker.mlflow") as mock_mlflow:
            tracker.set_tag("model_type", "xgboost")
            mock_mlflow.set_tag.assert_called_once_with("model_type", "xgboost")

    def test_set_tags(self, tracker):
        """Test setting multiple tags"""
        with patch("src.mlflow_utils.experiment_tracker.mlflow") as mock_mlflow:
            tags = {"model_type": "xgboost", "version": "1.0"}
            tracker.set_tags(tags)
            mock_mlflow.set_tags.assert_called_once_with(tags)


class TestExperimentTrackerSearch:
    """Tests for search and query methods"""

    @pytest.fixture
    def tracker_with_client(self):
        """Create a tracker with mocked client"""
        with (
            patch("src.mlflow_utils.experiment_tracker.mlflow") as mock_mlflow,
            patch(
                "src.mlflow_utils.experiment_tracker.MlflowClient"
            ) as mock_client_class,
        ):
            mock_experiment = Mock()
            mock_experiment.experiment_id = "exp_123"
            mock_mlflow.get_experiment_by_name.return_value = mock_experiment

            mock_client = Mock()
            mock_client_class.return_value = mock_client

            tracker = ExperimentTracker(
                tracking_uri="http://localhost:5000", experiment_name="test_experiment"
            )
            yield tracker, mock_client

    def test_get_run(self, tracker_with_client):
        """Test getting a run by ID"""
        tracker, mock_client = tracker_with_client
        mock_run = Mock()
        mock_client.get_run.return_value = mock_run

        result = tracker.get_run("run_123")

        mock_client.get_run.assert_called_once_with("run_123")
        assert result == mock_run

    def test_search_runs(self, tracker_with_client):
        """Test searching runs"""
        tracker, mock_client = tracker_with_client
        mock_runs = [Mock(), Mock()]
        mock_client.search_runs.return_value = mock_runs

        result = tracker.search_runs(
            filter_string="metrics.accuracy > 0.9",
            max_results=50,
            order_by=["metrics.accuracy DESC"],
        )

        mock_client.search_runs.assert_called_once_with(
            experiment_ids=["exp_123"],
            filter_string="metrics.accuracy > 0.9",
            max_results=50,
            order_by=["metrics.accuracy DESC"],
        )
        assert result == mock_runs

    def test_get_best_run_found(self, tracker_with_client):
        """Test getting best run when runs exist"""
        tracker, mock_client = tracker_with_client

        mock_run = Mock()
        mock_run.info.run_id = "best_run_123"
        mock_run.data.metrics = {"accuracy": 0.98}
        mock_client.search_runs.return_value = [mock_run]

        result = tracker.get_best_run("accuracy", ascending=False)

        assert result == mock_run

    def test_get_best_run_not_found(self, tracker_with_client):
        """Test getting best run when no runs exist"""
        tracker, mock_client = tracker_with_client
        mock_client.search_runs.return_value = []

        result = tracker.get_best_run("accuracy")

        assert result is None

    def test_end_run(self, tracker_with_client):
        """Test ending a run"""
        tracker, _ = tracker_with_client

        with patch("src.mlflow_utils.experiment_tracker.mlflow") as mock_mlflow:
            tracker.end_run()
            mock_mlflow.end_run.assert_called_once()

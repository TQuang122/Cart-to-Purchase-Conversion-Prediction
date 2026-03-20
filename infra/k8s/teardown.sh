#!/bin/bash

# Teardown MLOps Infrastructure from Kubernetes
# This script removes all MLOps infrastructure components including Dashboard

set -e

echo "🗑️  Starting MLOps Infrastructure Teardown..."

# Check if kubectl is available
if ! command -v kubectl &> /dev/null; then
    echo "❌ kubectl is not installed. Please install kubectl first."
    exit 1
fi

# Delete Kubernetes Dashboard
echo "🎛️  Deleting Kubernetes Dashboard..."
kubectl delete -f dashboard/dashboard-service.yaml --ignore-not-found=true
kubectl delete -f dashboard/dashboard-deployment.yaml --ignore-not-found=true
kubectl delete -f dashboard/dashboard-configmap.yaml --ignore-not-found=true
kubectl delete -f dashboard/dashboard-secret.yaml --ignore-not-found=true
kubectl delete -f dashboard/dashboard-rbac.yaml --ignore-not-found=true
kubectl delete -f dashboard/dashboard-serviceaccount.yaml --ignore-not-found=true
kubectl delete -f dashboard/dashboard-namespace.yaml --ignore-not-found=true

# Delete token file
if [ -f "dashboard-token.txt" ]; then
    echo "💾 Removing saved token file..."
    rm dashboard-token.txt
fi

# Delete MLflow
echo "📊 Deleting MLflow tracking server..."
kubectl delete -f mlflow/mlflow-service.yaml --ignore-not-found=true
kubectl delete -f mlflow/mlflow-deployment.yaml --ignore-not-found=true
kubectl delete -f mlflow/mlflow-config.yaml --ignore-not-found=true

# Delete Kafka
echo "📨 Deleting Kafka cluster..."
kubectl delete -f kafka/kafka-ui-service.yaml --ignore-not-found=true
kubectl delete -f kafka/kafka-ui-deployment.yaml --ignore-not-found=true
kubectl delete -f kafka/kafka-service.yaml --ignore-not-found=true
kubectl delete -f kafka/kafka-statefulset.yaml --ignore-not-found=true
kubectl delete -f kafka/kafka-config.yaml --ignore-not-found=true
kubectl delete pvc -l app=kafka -n mlops --ignore-not-found=true

# Delete Airflow
echo "✈️  Deleting Airflow..."
kubectl delete -f airflow/airflow-webserver.yaml --ignore-not-found=true
kubectl delete -f airflow/airflow-scheduler.yaml --ignore-not-found=true
kubectl delete -f airflow/airflow-postgres.yaml --ignore-not-found=true
kubectl delete -f airflow/airflow-pvc.yaml --ignore-not-found=true
kubectl delete -f airflow/airflow-config.yaml --ignore-not-found=true
kubectl delete -f airflow/airflow-secret.yaml --ignore-not-found=true
kubectl delete -f airflow/airflow-rbac.yaml --ignore-not-found=true

# Delete MinIO
echo "📦 Deleting MinIO..."
kubectl delete -f minio/minio-bucket-job.yaml --ignore-not-found=true
kubectl delete -f minio/minio-service.yaml --ignore-not-found=true
kubectl delete -f minio/minio-deployment.yaml --ignore-not-found=true
kubectl delete -f minio/minio-pvc.yaml --ignore-not-found=true
kubectl delete -f minio/minio-secret.yaml --ignore-not-found=true

# Delete PostgreSQL
echo "🐘 Deleting PostgreSQL..."
kubectl delete -f postgres/postgres-service.yaml --ignore-not-found=true
kubectl delete -f postgres/postgres-deployment.yaml --ignore-not-found=true
kubectl delete -f postgres/postgres-pvc.yaml --ignore-not-found=true
kubectl delete -f postgres/postgres-secret.yaml --ignore-not-found=true

echo ""
echo "✅ MLOps Infrastructure teardown completed!"
echo ""
echo "⚠️  Note: PersistentVolumes may still exist. To delete them manually:"
echo "  kubectl get pv"
echo "  kubectl delete pv <pv-name>"
echo ""
echo "⚠️  To delete the namespaces (this will remove all resources):"
echo "  kubectl delete namespace mlops"
echo "  kubectl delete namespace kubernetes-dashboard"

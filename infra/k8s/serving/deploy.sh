#!/usr/bin/env bash
# =============================================================================
# Deploy Cart-to-Purchase Serving API to KinD cluster
# =============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
SERVING_IMAGE="${SERVING_IMAGE:-tquang71/ctpserving:1.0.0}"
KIND_CLUSTER_NAME="${KIND_CLUSTER_NAME:-ctp-cluster}"
NAMESPACE="mlops"

cd "$PROJECT_ROOT"

log() { echo "[$(date '+%H:%M:%S')] $1"; }

load() {
    log "Pulling pinned registry image: $SERVING_IMAGE"
    docker pull "$SERVING_IMAGE"
    log "Loading image into KinD cluster: $KIND_CLUSTER_NAME"
    kind load docker-image "$SERVING_IMAGE" --name "$KIND_CLUSTER_NAME"
    log "Image loaded into KinD"
}

deploy() {
    log "Deploying serving API to namespace: $NAMESPACE"
    kubectl apply -f infra/k8s/serving/serving-configmap.yaml
    kubectl apply -f infra/k8s/serving/serving-secret.yaml
    kubectl apply -f infra/k8s/serving/serving-pvc.yaml
    kubectl apply -f infra/k8s/serving/serving-deployment.yaml
    kubectl apply -f infra/k8s/serving/serving-service.yaml
    kubectl apply -f infra/k8s/serving/serving-hpa.yaml
    kubectl set image -n "$NAMESPACE" deployment/serving-api \
      download-model="$SERVING_IMAGE" \
      serving-api="$SERVING_IMAGE"
    log "Deployment applied"
}

status() {
    log "Checking pod status..."
    kubectl get pods -n "$NAMESPACE" -l app=serving-api -o wide
    echo ""
    kubectl get svc -n "$NAMESPACE" serving-api
    echo ""
    kubectl get pvc -n "$NAMESPACE" serving-models-pvc
}

logs() {
    kubectl logs -n "$NAMESPACE" -l app=serving-api --tail=50 -f
}

watch() {
    kubectl get pods -n "$NAMESPACE" -l app=serving-api -w
}

port_forward() {
    log "Port-forwarding serving API to localhost:8000"
    kubectl port-forward -n "$NAMESPACE" svc/serving-api 8000:8000
}

down() {
    log "Tearing down serving API"
    kubectl delete -f infra/k8s/serving/serving-hpa.yaml --ignore-not-found
    kubectl delete -f infra/k8s/serving/serving-service.yaml --ignore-not-found
    kubectl delete -f infra/k8s/serving/serving-deployment.yaml --ignore-not-found
    kubectl delete -f infra/k8s/serving/serving-pvc.yaml --ignore-not-found
    kubectl delete -f infra/k8s/serving/serving-configmap.yaml --ignore-not-found
    kubectl delete -f infra/k8s/serving/serving-secret.yaml --ignore-not-found
    log "Teardown complete"
}

CMD="${1:-help}"
case "$CMD" in
    load)   load ;;
    deploy) deploy ;;
    status) status ;;
    logs)   logs ;;
    watch)  watch ;;
    port-forward) port_forward ;;
    down)   down ;;
    all)
        load && deploy
        echo ""
        status
        echo ""
        echo "========================================"
        echo "  Serving API deployed!"
        echo "  Image: $SERVING_IMAGE"
        echo "  Access: kubectl port-forward -n mlops svc/serving-api 8000:8000"
        echo "  Then: curl http://localhost:8000/health"
        echo "========================================"
        ;;
    *)
        echo "Usage: $0 {load|deploy|status|logs|watch|port-forward|down|all}"
        echo ""
        echo "  SERVING_IMAGE default: tquang71/ctpserving:1.0.0"
        echo "  load       - Pull pinned registry image and load into KinD"
        echo "  deploy     - Deploy to K8s"
        echo "  status     - Check pod/svc status"
        echo "  logs       - Tail logs"
        echo "  watch      - Watch pod status"
        echo "  port-forward - Port-forward to localhost:8000"
        echo "  down       - Remove all serving resources"
        echo "  all        - Load + deploy"
        ;;
esac

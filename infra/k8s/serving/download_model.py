#!/usr/bin/env python3
"""
Init container script for Cart-to-Purchase Serving API on Kubernetes.

Model is loaded DIRECTLY from MLflow registry by the serving app.
We no longer download model artifacts from MinIO/S3.

This script only:
- Copies pre-built feature parquet files (user/product lookups) to PVC
- Copies feast_repo to PVC
"""

import os
import shutil

MODEL_DIR = os.environ.get("MODEL_DIR", "/app/models")
SRC_FEATURES = "/src_models"

os.makedirs(MODEL_DIR, exist_ok=True)

# Copy feature parquet files (large, committed to repo in image)
if os.path.exists(os.path.join(SRC_FEATURES, "user_features.parquet")):
    for fname in ["user_features.parquet", "product_features.parquet"]:
        src = os.path.join(SRC_FEATURES, fname)
        dst = os.path.join(MODEL_DIR, fname)
        if not os.path.exists(dst):
            shutil.copy2(src, dst)
            print(f"[init] Copied {fname} from pre-built assets")
        else:
            print(f"[init] {fname} already exists — skipping")

# Copy feast_repo
SRC_FEAST = os.path.join(SRC_FEATURES, "feast_repo")
DST_FEAST = os.path.join(MODEL_DIR, "feast_repo")
if os.path.exists(SRC_FEAST) and not os.path.exists(DST_FEAST):
    shutil.copytree(SRC_FEAST, DST_FEAST)
    print(f"[init] Copied feast_repo")

# NOTE: Model (.joblib) is NOT downloaded from MinIO anymore.
# The serving app loads it directly from MLflow registry using:
#   mlflow.pyfunc.load_model("models:/purchase_propensity_model@staging")
print("[init] Init complete — serving app will load model from MLflow registry")

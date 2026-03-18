from pathlib import Path
import pandas as pd


SCRIPT_DIR = Path(__file__).resolve().parent
# Build path relative to script location
DATA_PATH = (
    SCRIPT_DIR
    / "../propensity_feature_store/propensity_features/feature_repo/data/processed_purchase_propensity_data_v2.parquet"
)
df = pd.read_parquet(DATA_PATH)

user_ids = df["user_id"].unique()
print("Total unique customers:", len(user_ids))
print(df.head())

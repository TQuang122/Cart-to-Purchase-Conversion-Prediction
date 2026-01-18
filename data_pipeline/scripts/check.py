import pandas as pd

df = pd.read_parquet("./propensity_feature_store/propensity_features/feature_repo/data/processed_purchase_propensity_data_v1.parquet")

user_ids = df["user_id"].unique()
print("Total unique customers:", len(user_ids))
print(df.head())
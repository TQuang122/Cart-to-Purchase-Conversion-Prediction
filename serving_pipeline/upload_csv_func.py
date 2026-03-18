import pandas as pd

# ---2.Logic tab Upload CSV---
def preview_csv(file_obj):
    if file_obj is None:
        return None, pd.DataFrame()
    try:
        df = pd.read_csv(file_obj.name)
        return df, df.head(10)
    except Exception as e:
        return None, pd.DataFrame({"Lỗi!!!": [str(e)]})
    


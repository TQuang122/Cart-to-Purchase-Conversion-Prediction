import matplotlib.pyplot as plt
import seaborn as sns
import matplotlib.ticker as mtick
import pandas as pd
import random
import time

# --- 4. logic dashboard --- 

def plot_price_distribution(df):
    if df is None or df.empty:
        return None
    col_name = next((col for col in df.columns if col.lower() == 'price'), None)
    
    if col_name is None:
        fig = plt.figure(figsize=(8, 2))
        plt.text(0.5, 0.5, "Không tìm thấy cột 'price' trong dữ liệu", 
                 ha='center', va='center', fontsize=12, color='red')
        plt.axis('off')
        return fig

    data = df[col_name].dropna()
    fig = plt.figure(figsize=(10, 6))
    sns.set_style('whitegrid') 

    sns.histplot(
        data, 
        kde=True, 
        color='#3498db', 
        edgecolor='black', 
        bins=30,           
        alpha=0.7,         
        line_kws={'linewidth': 2} 
    )

    mean_val = data.mean()
    median_val = data.median()
    
    plt.axvline(mean_val, color='red', linestyle='--', linewidth=1.5, label=f'Mean: ${mean_val:,.2f}')
    plt.axvline(median_val, color='green', linestyle='-', linewidth=1.5, label=f'Median: ${median_val:,.2f}')
    plt.title(f"Product Distribution ({col_name})", fontsize=15, fontweight='bold', pad=20)
    plt.xlabel("Price ($)", fontsize=12)
    plt.ylabel("Frequency", fontsize=12)
    plt.legend(loc='upper right')
    plt.tight_layout()
    
    return fig

def plot_funnel_analysis(df):

    if df is None or df.empty: return None
    if 'event_type' not in df.columns: return None

    funnel_data = df['event_type'].value_counts().sort_values(ascending=False)
    
    total_events = funnel_data.sum() 

    fig, ax = plt.subplots(figsize=(10, 6))
    sns.set_style('whitegrid')

    plot = sns.barplot(
        x=funnel_data.values, 
        y=funnel_data.index, 
        palette='viridis', 
        edgecolor='black', 
        alpha=0.8
    )

    for i, (value, name) in enumerate(zip(funnel_data.values, funnel_data.index)):
        percent = (value / total_events) * 100
        label_text = f"{value:,.0f} ({percent:.1f}%)"
        
        
        ax.text(value + (value * 0.01), i, label_text, 
                va='center', fontweight='bold', color='#333333')
    plt.title('Conversion Funnel ', fontsize=15, fontweight='bold', pad=20)
    plt.xlabel('Number of Events', fontsize=12)
    plt.ylabel('') 
    plt.xlim(0, funnel_data.max() * 1.15)
    plt.tight_layout()
    return fig

def plot_hourly_conversion(df):
    if df is None or df.empty: return None
    
    if 'event_time' not in df.columns: return None
    
    plot_df = df.copy()
    
    try:
        plot_df['event_time'] = pd.to_datetime(plot_df['event_time'])
        plot_df['hour'] = plot_df['event_time'].dt.hour
    except Exception:
        return None 

    if 'is_purchased' not in plot_df.columns and 'event_type' in plot_df.columns:
        plot_df['is_purchased'] = (plot_df['event_type'] == 'purchase').astype(int)
        
    hour_analysis = plot_df.groupby('hour')['is_purchased'].mean() * 100

    if hour_analysis.empty: return None

    fig, ax = plt.subplots(figsize=(10, 6))
    sns.set_style("whitegrid")

    ax.plot(hour_analysis.index, hour_analysis.values, 
            color='#008080', marker='o', linewidth=2, markersize=6, label='Conversion Rate')

    ax.fill_between(hour_analysis.index, hour_analysis.values, color='#008080', alpha=0.1)

    peak_hour = hour_analysis.idxmax()
    peak_rate = hour_analysis.max()
    
    ax.plot(peak_hour, peak_rate, marker='o', color='#ff6b6b', markersize=12, markeredgewidth=2, fillstyle='none')
    
    ax.annotate(f'Giờ vàng: {peak_hour}h\n({peak_rate:.1f}%)', 
                xy=(peak_hour, peak_rate), 
                xytext=(peak_hour, peak_rate + (peak_rate * 0.1)),
                arrowprops=dict(facecolor='#333', shrink=0.05, width=2, headwidth=8),
                fontsize=11, fontweight='bold', color='#c0392b', ha='center')

    ax.set_title('Hourly Purchase Probability', 
                 fontsize=14, fontweight='bold', pad=15)
    ax.set_xlabel('Hours of the day (0h - 23h)', fontsize=11)
    ax.set_ylabel('Conversion rate (%)', fontsize=11)
    
    ax.set_xticks(range(0, 24, 2)) 
    ax.yaxis.set_major_formatter(mtick.PercentFormatter())
    plt.tight_layout()
    return fig

def plot_cart_abandonment_latency(df):
    if df is None or df.empty: return None
    required_cols = ['event_time', 'event_type', 'user_session', 'product_id']
    if not all(col in df.columns for col in required_cols): return None

    try:
        process_df = df.copy()
        process_df['event_time'] = pd.to_datetime(process_df['event_time'])

        carts = process_df[process_df['event_type'] == 'cart'][['user_session', 'product_id', 'event_time']]
        purchases = process_df[process_df['event_type'] == 'purchase'][['user_session', 'product_id', 'event_time']]

        if carts.empty or purchases.empty: return None

        latency_df = pd.merge(carts, purchases, on=['user_session', 'product_id'], suffixes=('_cart', '_purchase'))
        
        latency_df['latency_seconds'] = (latency_df['event_time_purchase'] - latency_df['event_time_cart']).dt.total_seconds()
        
        valid_latency = latency_df[(latency_df['latency_seconds'] >= 0) & (latency_df['latency_seconds'] <= 3600)]
        
        if valid_latency.empty: return None

        minutes_data = valid_latency['latency_seconds'] / 60

    except Exception as e:
        print(f"Lỗi xử lý latency: {e}")
        return None

    fig, ax = plt.subplots(figsize=(10, 6))
    sns.set_style("whitegrid")

    sns.histplot(
        minutes_data, 
        bins=50, 
        kde=True, 
        color='#FF7F50', # Coral Color
        edgecolor='white',
        alpha=0.7,
        line_kws={'linewidth': 2, 'color': '#FF4500'} 
    )

    median_val = minutes_data.median()
    mean_val = minutes_data.mean()

    ax.axvline(median_val, color='green', linestyle='--', linewidth=2, label=f'Median: {median_val:.1f} min')
    
    ax.axvline(mean_val, color='blue', linestyle=':', linewidth=2, label=f'Mean: {mean_val:.1f} min')

    ax.set_title('Time to make a purchase decision (within the first 60 minutes)', fontsize=14, fontweight='bold', pad=15)
    ax.set_xlabel('Number of minutes after adding to cart (Minutes)', fontsize=11)
    ax.set_ylabel('Number of orders (Volume)', fontsize=11)
    
    ax.legend(loc='upper right', frameon=True, shadow=True)
    
    fast_buy_count = (minutes_data <= 5).sum()
    total_count = len(minutes_data)
    percent_fast = (fast_buy_count / total_count) * 100
    
    stats_text = f" Insight:\n{percent_fast:.1f}% Customers finalize their orders\nwithin the first 5 minutes!!"
    props = dict(boxstyle='round', facecolor='wheat', alpha=0.5)
    ax.text(0.95, 0.60, stats_text, transform=ax.transAxes, fontsize=10,
            verticalalignment='top', horizontalalignment='right', bbox=props)

    plt.tight_layout()
    return fig


def update_full_dashboard(df):
    # Trả về theo thứ tự của outputs bên dưới
    return (
        plot_funnel_analysis(df),          # 1. Phễu
        plot_price_distribution(df),       # 2. Giá
        plot_hourly_conversion(df),        # 3. Giờ vàng
        plot_cart_abandonment_latency(df)  # 4. Tốc độ mua
    )







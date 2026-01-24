import gradio as gr
import pandas as pd
import random
import time
import google.generativeai as genai
import os
import matplotlib.pyplot as plt
import seaborn as sns
import matplotlib.ticker as mtick

# pip install google-generativeai
initial_message = [
    {
        "role": "assistant",
        "content": "👋 Hi! I'm your **AI Growth Assistant**.\n\nCan I help you optimize your e-commerce today?"
    }
]
# tạm thời chưa bảo mật API key
GEMINI_API_KEY = "AIzaSyA_uU1iq27B8WLu6wUaGGPpzJJNdLY6fyc"
genai.configure(
    api_key=GEMINI_API_KEY
)

model = genai.GenerativeModel("gemini-3-flash-preview")

# --- 1. LOGIC DỰ ĐOÁN ---

def predict_single(user_id, product_id, price, brand, activity_count, weekday):
    base_score = 0.2
    try:
        p = float(price)
    except:
        p = 500

    if p < 50:
        base_score += 0.3
    if activity_count > 5:
        base_score += 0.25
    if str(brand).lower() in ["samsung", "apple"]:
        base_score += 0.15

    score = base_score + (random.random() * 0.15)
    score = min(score, 0.99)
    is_buy = 1 if score > 0.5 else 0

    result_text = "CÓ MUA (Purchase)" if is_buy else "KHÔNG MUA (No Purchase)"
    return (
        f"User: {user_id}\n"
        f"Product: {product_id}\n"
        f"Dự đoán: {result_text}\n"
        f"Xác suất: {score:.4f}"
    )


# ---2.Logic tab Upload CSV---
def preview_csv(file_obj):
    if file_obj is None:
        return None, pd.DataFrame()
    try:
        df = pd.read_csv(file_obj.name)
        return df, df.head(10)
    except Exception as e:
        return None, pd.DataFrame({"Lỗi!!!": [str(e)]})
    

# --- 3. LOGIC CHATBOT ---


def build_prompt(message):
    prompt = f"""
    You are an AI assistant for an E-commerce Prediction System.

    User question:
    {message}

    Answer clearly, in bullet points if helpful.
    """
    return prompt

def chat_interface(message, history):
    history = history or []

    if not message or message.strip() == "":
        return "", history

    # user message
    history.append({
        "role": "user",
        "content": message
    })
    history.append({
        "role": "assistant",
        "content": "🤖 <span class='typing'><span></span><span></span><span></span></span>"
    })
    try:
        prompt = build_prompt(message)
        response = model.generate_content(prompt)

        if (
            response
            and response.candidates
            and response.candidates[0].content
            and response.candidates[0].content.parts
        ):
            reply = response.candidates[0].content.parts[0].text
        else:
            reply = "⚠️ AI did not return text content."

    except Exception as e:
        reply = f"❌ Gemini API error:\n{str(e)}"

    # assistant message
    history.append({
        "role": "assistant",
        "content": reply
    })

    return "", history



    



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
    plt.title(f"Phân phối giá sản phẩm ({col_name})", fontsize=15, fontweight='bold', pad=20)
    plt.xlabel("Price ($)", fontsize=12)
    plt.ylabel("Frequency (Tần suất)", fontsize=12)
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
    plt.title('Conversion Funnel (Phễu chuyển đổi)', fontsize=15, fontweight='bold', pad=20)
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

    ax.set_title('Xác suất mua hàng theo khung giờ (Hourly Purchase Probability)', 
                 fontsize=14, fontweight='bold', pad=15)
    ax.set_xlabel('Giờ trong ngày (0h - 23h)', fontsize=11)
    ax.set_ylabel('Tỷ lệ chuyển đổi (%)', fontsize=11)
    
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

    ax.set_title('Thời gian quyết định mua hàng (Trong 60 phút đầu)', fontsize=14, fontweight='bold', pad=15)
    ax.set_xlabel('Số phút sau khi thêm vào giỏ (Minutes)', fontsize=11)
    ax.set_ylabel('Số lượng đơn hàng (Volume)', fontsize=11)
    
    ax.legend(loc='upper right', frameon=True, shadow=True)
    
    fast_buy_count = (minutes_data <= 5).sum()
    total_count = len(minutes_data)
    percent_fast = (fast_buy_count / total_count) * 100
    
    stats_text = f"💡 Insight:\n{percent_fast:.1f}% khách chốt đơn\ntrong 5 phút đầu!"
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



# --- 5. UI ---

theme = gr.themes.Soft(
    primary_hue="indigo",
    neutral_hue="slate",
).set(
    body_background_fill="#0f172a",
    block_background_fill="#1e293b",
    body_text_color="white",
)



custom_css = """
/* === 1. TỔNG QUAN NỀN & FONT === */
body, .gradio-container {
    background: linear-gradient(135deg, #0f172a 0%, #110e1b 100%) !important;
    font-family: 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
}

/* === 2. TIÊU ĐỀ ẤN TƯỢNG (GRADIENT TEXT) === */
h1 {
    background: linear-gradient(90deg, #6366f1, #a855f7, #ec4899);
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
    font-weight: 800 !important;
    text-align: center;
    margin-bottom: 1rem !important;
    filter: drop-shadow(0 0 10px rgba(168, 85, 247, 0.3));
}

h2, h3, p, label, span {
    color: #e2e8f0 !important;
}

/* === 3. KHỐI CHỨA (GLASSMORPHISM) === */
.block, .panel {
    background: rgba(30, 41, 59, 0.4) !important;
    border: 1px solid rgba(255, 255, 255, 0.08) !important;
    backdrop-filter: blur(8px);
    border-radius: 12px !important;
    box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.3);
}

/* === 4. NÚT BẤM (NEON GLOW) === */
/* Nút chính (Primary) */
button.primary {
    background: linear-gradient(90deg, #4f46e5 0%, #9333ea 100%) !important;
    border: none !important;
    color: white !important;
    font-weight: bold;
    transition: all 0.3s ease;
    box-shadow: 0 0 15px rgba(79, 70, 229, 0.4);
}

button.primary:hover {
    transform: translateY(-2px);
    box-shadow: 0 0 25px rgba(147, 51, 234, 0.6);
    filter: brightness(1.2);
}

/* Nút phụ (Secondary/Clear) */
button.secondary {
    background: rgba(255, 255, 255, 0.1) !important;
    border: 1px solid rgba(255, 255, 255, 0.2) !important;
    color: #cbd5e1 !important;
}
button.secondary:hover {
    background: rgba(255, 255, 255, 0.2) !important;
}

/* === 5. INPUT & DROPDOWN === */
input, textarea, select, .gr-input {
    background-color: #1e293b !important;
    border: 1px solid #475569 !important;
    color: #f8fafc !important;
    border-radius: 8px !important;
}

input:focus, textarea:focus {
    border-color: #818cf8 !important;
    box-shadow: 0 0 0 2px rgba(99, 102, 241, 0.2) !important;
}

/* === 6. TAB NAVIGATION === */
.tab-nav button {
    font-weight: bold;
    color: #94a3b8 !important;
    border-bottom: 2px solid transparent;
}

.tab-nav button.selected {
    color: #c084fc !important; /* Màu tím sáng */
    border-bottom: 2px solid #c084fc !important;
    text-shadow: 0 0 8px rgba(192, 132, 252, 0.5);
}

/* === 7. CHATBOT AREA === */
#chatbot {
    height: 500px; 
    overflow-y: auto; 
    background-color: rgba(15, 23, 42, 0.6) !important;
    border: 1px solid rgba(148, 163, 184, 0.1);
    border-radius: 12px;
}

/* Bong bóng chat (Tùy chỉnh sâu hơn cần can thiệp HTML class của Gradio, 
nhưng đây là nền tảng chung) */
.message-row.user-row .message {
    background: linear-gradient(to right, #2563eb, #3b82f6) !important;
    border-radius: 12px 12px 0 12px !important;
}
.message-row.bot-row .message {
    background: #334155 !important;
    border-radius: 12px 12px 12px 0 !important;
}

/* === 8. SCROLLBAR TÙY CHỈNH === */
::-webkit-scrollbar {
    width: 8px;
    height: 8px;
}
::-webkit-scrollbar-track {
    background: #0f172a; 
}
::-webkit-scrollbar-thumb {
    background: #475569; 
    border-radius: 4px;
}
::-webkit-scrollbar-thumb:hover {
    background: #64748b; 
}
#chatbot {
    background: linear-gradient(180deg, #0b1220, #0f172a);
    border-radius: 18px;
    padding: 12px;
}

#chat_header {
    background: rgba(255,255,255,0.04);
    padding: 16px;
    border-radius: 16px;
    margin-bottom: 10px;
}

.gr-chat-message.user {
    background: linear-gradient(135deg, #6d28d9, #9333ea);
    color: white;
    border-radius: 16px;
}

.gr-chat-message.bot {
    background: rgba(255,255,255,0.06);
    color: #e5e7eb;
    border-radius: 16px;
}
#ai_header .ai-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 14px 18px;
    border-radius: 14px;
    background: linear-gradient(
        135deg,
        rgba(99,102,241,0.12),
        rgba(168,85,247,0.08)
    );
    border: 1px solid rgba(255,255,255,0.06);
    box-shadow: 0 10px 30px rgba(0,0,0,0.25);
}

#ai_header .ai-left {
    display: flex;
    align-items: center;
    gap: 14px;
}

#ai_header .ai-avatar {
    width: 44px;
    height: 44px;
    border-radius: 12px;
    background: linear-gradient(135deg, #6366f1, #a855f7);
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 22px;
}

#ai_header .ai-title {
    font-size: 22px;
    font-weight: 700;
    color: white;
}

#ai_header .ai-subtitle {
    font-size: 13px;
    opacity: 0.75;
}

#ai_header .ai-status {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 13px;
    font-weight: 600;
    color: #22c55e;
}

#ai_header .pulse {
    width: 14px;
    height: 14px;
    background: #22c55e;
    border-radius: 50%;
    animation: pulse 1.4s infinite;
}

@keyframes pulse {
    0% { box-shadow: 0 0 0 0 rgba(34,197,94,0.6); }
    70% { box-shadow: 0 0 0 8px rgba(34,197,94,0); }
    100% { box-shadow: 0 0 0 0 rgba(34,197,94,0); }
}

/* Nút gửi (mũi tên) */
button.gr-button {
    height: 64px !important;        /* Cao hơn */
    min-width: 72px !important;     /* Rộng hơn */
    border-radius: 14px !important; /* Bo tròn đẹp */
    font-size: 100px !important;     /* To hơn (fallback) */
}
#send_btn_to {
    font-size: 24px !important;  /* Chỉnh cỡ mũi tên to lên */
    height: 55px !important;     /* Chỉnh chiều cao nút to lên */
}
/* SVG mũi tên bên trong */
button.gr-button svg {
    width: 36px !important;
    height: 34px !important;
}
/* Bubble AI trả lời */
.ai-message,
.gr-chatbot .message.bot {
    background: linear-gradient(
        135deg,
        rgba(99, 102, 241, 0.18),
        rgba(168, 85, 247, 0.18)
    );
    border: 1px solid rgba(139, 92, 246, 0.35);
    border-radius: 16px;
    padding: 16px 18px;
    color: #e5e7eb;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.25);
    backdrop-filter: blur(6px);
}
/* Bubble user */
.gr-chatbot .message.user {
    background: linear-gradient(
        135deg,
        #6366f1,
        #8b5cf6
    );
    border-radius: 16px;
    padding: 14px 16px;
    color: white;
    box-shadow: 0 6px 18px rgba(99, 102, 241, 0.45);
}
.suggestion-btn,
button.suggestion {
    background: linear-gradient(
        135deg,
        rgba(255, 255, 255, 0.06),
        rgba(255, 255, 255, 0.02)
    );
    border: 1px solid rgba(255, 255, 255, 0.12);
    border-radius: 14px;
    padding: 14px 18px;
    color: #e5e7eb;
    font-weight: 500;
    transition: all 0.25s ease;
    backdrop-filter: blur(6px);
}
.suggestion-btn:hover,
button.suggestion:hover {
    transform: translateY(-2px) scale(1.02);
    background: linear-gradient(
        135deg,
        rgba(99, 102, 241, 0.35),
        rgba(168, 85, 247, 0.35)
    );
    box-shadow: 0 10px 28px rgba(139, 92, 246, 0.35);
}
.suggestion-btn span:first-child {
    font-size: 18px;
    margin-right: 8px;
}

/* Base style cho 3 nút */
button.btn-blue {
    background: linear-gradient(135deg, #2563eb, #3b82f6);
    box-shadow: 0 8px 22px rgba(59,130,246,0.45);
}

button.btn-purple {
    background: linear-gradient(135deg, #7c3aed, #a855f7);
    box-shadow: 0 8px 22px rgba(168,85,247,0.45);
}

button.btn-pink {
    background: linear-gradient(135deg, #db2777, #ec4899);
    box-shadow: 0 8px 22px rgba(236,72,153,0.45);
}

/* Hover chung */
button.btn-blue:hover,
button.btn-purple:hover,
button.btn-pink:hover {
    transform: translateY(-2px) scale(1.03);
    filter: brightness(1.15);
}


/* --- HIỆU ỨNG PHÁT SÁNG KHI ẤN (ACTIVE/FOCUS) --- */

/* 1. Nút Xanh (Blue) - Phát sáng xanh dương */
button.btn-blue:active, 
button.btn-blue:focus {
    /* Lớp 1: Sáng tâm, Lớp 2: Tỏa rộng ra ngoài */
    box-shadow: 0 0 15px rgba(59, 130, 246, 1), 0 0 30px rgba(59, 130, 246, 0.7) !important;
    transform: scale(0.98); /* Nhún nhẹ xuống tạo cảm giác bấm thật */
    border-color: #f9a8d4 !important; /* Viền sáng lên */
}


/* 2. Nút Tím (Purple) - Phát sáng tím mộng mơ */
button.btn-purple:active, 
button.btn-purple:focus {
    box-shadow: 0 0 15px rgba(168, 85, 247, 1), 0 0 30px rgba(168, 85, 247, 0.7) !important;
    transform: scale(0.98);
    border-color: #d8b4fe !important;
}

/* 3. Nút Hồng (Pink) - Phát sáng hồng rực */
button.btn-pink:active, 
button.btn-pink:focus {
    box-shadow: 0 0 15px rgba(236, 72, 153, 1), 0 0 30px rgba(236, 72, 153, 0.7) !important;
    transform: scale(0.98);
    border-color: #f9a8d4 !important;
}

/* Tùy chỉnh ô nhập liệu */
#custom_msg textarea {
    background-color: #13141f !important;  /* Nền rất tối (gần đen) để nổi chữ */
    border: 2px solid #4f46e5 !important;   /* Viền màu tím xanh (Indigo) */
    border-radius: 12px !important;         /* Bo tròn góc mềm mại */
    color: #ffffff !important;              /* Chữ màu trắng sáng */
    font-size: 20px !important;             /* Chữ to rõ hơn */
    transition: all 0.3s ease;              /* Hiệu ứng chuyển động mượt */
}

/* 2. Hiệu ứng khi bấm chuột vào (Focus) */
#custom_msg textarea:focus {
    border-color: #a855f7 !important;       /* Đổi viền sang màu tím sáng hơn */
    box-shadow: 0 0 15px rgba(168, 85, 247, 0.5) !important; /* Hiệu ứng phát sáng (Glow) */
    background-color: #1e1e2e !important;   /* Nền sáng lên một chút */
}

/* 3. Tùy chỉnh placeholder (dòng chữ mờ gợi ý) */
#custom_msg textarea::placeholder {
    color: #8888aa !important;              /* Màu chữ gợi ý xám xanh dễ đọc */
    font-style: italic;
}
/* 1. Trạng thái bình thường (Chưa nhập gì) */
#custom_msg textarea {
    background-color: #13141f !important;  
    border: 2px solid #4f46e5 !important;   /* Viền Tím tối */
    border-radius: 12px !important;
    color: #ffffff !important;
    transition: all 0.3s ease;
}

/* 2. Trạng thái Focus (Khi bấm chuột vào để gõ) */
#custom_msg textarea:focus {
    border-color: #a855f7 !important;       /* Viền Tím sáng */
    background-color: #1e1e2e !important;
}

/* 3. TRẠNG THÁI QUAN TRỌNG: KHI CÓ VĂN BẢN (Text detected) */
/* Logic: Khi không còn hiện placeholder (tức là đã có chữ) thì phát sáng */
#custom_msg textarea:not(:placeholder-shown) {
    border-color: #d946ef !important;       /* Chuyển sang viền Hồng rực (Magenta) */
    box-shadow: 0 0 20px rgba(217, 70, 239, 0.5) !important; /* Hiệu ứng Neon Glow mạnh */
    background-color: #2e1065 !important;   /* Nền hơi ửng tím */
}

/* Tùy chỉnh màu chữ placeholder cho đẹp */
#custom_msg textarea::placeholder {
    color: #6b7280 !important;
}
Để làm cho vùng tiêu đề (ai-header) có viền màu và hiệu ứng phát sáng nhẹ (glow), bạn cần thêm CSS vào class .ai-header.

Dưới đây là đoạn code CSS tối ưu để tạo cảm giác "công nghệ" nhưng vẫn tinh tế, không bị chói mắt.

Cách thực hiện
Bạn thêm đoạn CSS sau vào biến custom_css của bạn:

CSS

/* Thêm vào phần custom_css */
/* 1. Định nghĩa chuyển động phát sáng */
@keyframes permanent-glow {
    0% {
        box-shadow: 0 0 10px rgba(139, 92, 246, 0.3); /* Sáng nhẹ */
        border-color: rgba(139, 92, 246, 0.4);
    }
    50% {
        box-shadow: 0 0 25px rgba(139, 92, 246, 0.75); /* Sáng rực rỡ nhất */
        border-color: rgba(139, 92, 246, 0.9);
    }
    100% {
        box-shadow: 0 0 10px rgba(139, 92, 246, 0.3); /* Quay về sáng nhẹ */
        border-color: rgba(139, 92, 246, 0.4);
    }
}

/* 2. Áp dụng vào class .ai-header */
.ai-header {
    /* Các thuộc tính cơ bản giữ nguyên */
    border-radius: 12px !important;
    background: rgba(30, 25, 45, 0.6) !important;
    padding: 15px 20px !important;
    
    /* Kích hoạt hiệu ứng phát sáng vĩnh viễn */
    /* animation: tên_keyframe | thời_gian | kiểu_chạy | lặp_vô_tận */
    animation: permanent-glow 3s infinite ease-in-out !important;
    
    border: 1px solid rgba(139, 92, 246, 0.5) !important; /* Giá trị mặc định */
}

#custom_msg textarea {
    /* 1. Nền tối pha chút tím và trong suốt (Match với Header) */
    background: rgba(30, 25, 45, 0.6) !important; 
    
    /* 2. Viền tím mảnh, tinh tế hơn viền đậm cũ */
    border: 1px solid rgba(139, 92, 246, 0.5) !important; 
    
    /* 3. Hiệu ứng tỏa sáng nhẹ (Soft Glow) */
    box-shadow: 0 0 15px rgba(139, 92, 246, 0.2) !important;
    
    /* 4. Bo góc đồng bộ */
    border-radius: 12px !important;
    
    /* Màu chữ trắng sáng */
    color: #ffffff !important;
    
    /* Hiệu ứng chuyển đổi mượt */
    transition: all 0.3s ease-in-out;
}

/* --- KHI BẤM VÀO (FOCUS) --- */
#custom_msg textarea:focus {
    /* Sáng rực lên giống trạng thái active của Header */
    border-color: rgba(139, 92, 246, 1.0) !important; /* Viền rõ hơn */
    box-shadow: 0 0 25px rgba(139, 92, 246, 0.6) !important; /* Tỏa sáng mạnh hơn */
    
    /* Nền đậm hơn chút để dễ đọc chữ khi đang gõ */
    background: rgba(30, 25, 45, 0.9) !important; 
}

/* --- (TÙY CHỌN) KHI CÓ CHỮ THÌ ĐỔI MÀU KHÁC --- */
/* Nếu bạn muốn giữ hiệu ứng "có chữ thì đổi màu hồng" như cũ thì giữ đoạn này */
/* Nếu muốn đồng bộ màu tím luôn thì XÓA đoạn này đi */
#custom_msg textarea:not(:placeholder-shown) {
    border-color: #d946ef !important; /* Hồng Magenta */
    box-shadow: 0 0 20px rgba(217, 70, 239, 0.4) !important;

#custom_msg textarea {
    /* 1. Nền trong suốt hơn (0.3) để thấy background phía sau */
    background: rgba(30, 25, 45, 0.3) !important; 
    
    /* 2. Hiệu ứng làm mờ hậu cảnh (QUAN TRỌNG để giống kính) */
    backdrop-filter: blur(10px) !important;
    -webkit-backdrop-filter: blur(10px) !important; /* Cho Safari/Mac */
    
    /* 3. Viền tím mảnh giống Header */
    border: 1px solid rgba(139, 92, 246, 0.5) !important; 
    
    /* 4. Phát sáng nhẹ */
    box-shadow: 0 0 15px rgba(139, 92, 246, 0.2) !important;
    
    /* 5. Màu chữ và bo góc */
    color: #ffffff !important;
    border-radius: 12px !important;
}

/* Khi bấm vào để gõ */
#custom_msg textarea:focus {
    /* Tăng độ đậm nền lên một chút để dễ đọc chữ hơn */
    background: rgba(30, 25, 45, 0.7) !important; 
    border-color: rgba(139, 92, 246, 1.0) !important;
    box-shadow: 0 0 20px rgba(139, 92, 246, 0.5) !important;
}

/* Nhắm vào hàng chứa ô input và nút */
#input_row_container {
    /* 1. Loại bỏ bóng/viền mặc định của Gradio gây ra cái "viền trắng" */
    box-shadow: none !important;
    border: none !important;
    background: transparent !important; /* Làm nền trong suốt */

    /* 2. (Tùy chọn) Nếu bạn muốn tạo một viền tím bao quanh CẢ ô nhập và nút */
    /* Nếu không thích thì xóa 4 dòng dưới đi */
    /*
    border: 1px solid rgba(139, 92, 246, 0.3) !important;
    border-radius: 14px !important; 
    padding: 4px !important;
    box-shadow: 0 0 15px rgba(139, 92, 246, 0.1) !important;
    */
}

/* Đảm bảo các phần tử con bên trong (nếu có container phụ) cũng trong suốt */
#input_row_container > * {
    background: transparent !important;
    border: none !important;
    box-shadow: none !important;
}
/* --- CSS CHO THANH NAVIGATION (NAVBAR) --- */

/* 1. Tác động vào container chứa các nút bấm */
.custom-nav > .tab-nav {
    border-bottom: 1px solid rgba(139, 92, 246, 0.2) !important; /* Đường kẻ mờ ngăn cách header */
    margin-bottom: 20px !important; /* Khoảng cách với nội dung bên dưới */
}

/* 2. Các nút bấm (Tab Button) */
.custom-nav button {
    font-size: 18px !important;    /* Chữ to */
    font-weight: 700 !important;   /* Chữ đậm */
    color: #9ca3af !important;     /* Màu xám mặc định */
    transition: all 0.3s ease;
    border: none !important;
    background: transparent !important;
    padding: 10px 20px !important; /* Khoảng cách xung quanh chữ */
}

/* 3. TRẠNG THÁI ĐƯỢC CHỌN (SELECTED) - QUAN TRỌNG */
.custom-nav button.selected {
    color: #e879f9 !important; /* Chữ màu Hồng tím */
    
    /* Hiệu ứng chữ phát sáng (Neon Text) */
    text-shadow: 0 0 15px rgba(232, 121, 249, 0.8), 
                 0 0 30px rgba(217, 70, 239, 0.4) !important;
                 
    /* Gạch chân phát sáng */
    border-bottom: 3px solid #e879f9 !important;
    box-shadow: 0 4px 15px -5px rgba(232, 121, 249, 0.5) !important; /* Bóng sáng dưới chân */
}

/* 4. Hiệu ứng khi rê chuột (Hover) */
.custom-nav button:hover {
    color: #d8b4fe !important;
    text-shadow: 0 0 10px rgba(216, 180, 254, 0.5) !important;
    background: rgba(255, 255, 255, 0.05) !important; /* Nền sáng nhẹ khi rê vào */
    border-radius: 8px 8px 0 0 !important;
}


/* --- TÙY BIẾN KHUNG CHATBOT --- */

/* 1. Xóa nền xám mặc định của toàn bộ khung chat */
#chatbot {
    background: transparent !important;
    border: none !important;
    height: 500px !important; /* Tăng chiều cao lên chút cho thoáng */
}

/* 2. TÙY BIẾN BONG BÓNG TIN NHẮN CỦA BOT (AI) */
/* Gradio thường dùng class .bot hoặc .message.bot */
#chatbot .bot, 
#chatbot .message.bot {
    /* Hiệu ứng kính mờ (Glassmorphism) giống Header */
    background: rgba(30, 25, 45, 0.6) !important;
    border: 1px solid rgba(139, 92, 246, 0.4) !important; /* Viền tím nhạt */
    backdrop-filter: blur(5px) !important;
    
    /* Bo góc: Góc trên bên trái vuông (tạo cảm giác bong bóng nói) */
    border-radius: 4px 20px 20px 20px !important;
    
    /* Màu chữ và hiệu ứng */
    color: #e2e8f0 !important; /* Trắng xám dễ đọc */
    box-shadow: 0 4px 15px rgba(0, 0, 0, 0.2) !important;
    padding: 15px !important;
}

/* 3. TÙY BIẾN BONG BÓNG TIN NHẮN CỦA USER (NGƯỜI DÙNG) */
#chatbot .user, 
#chatbot .message.user {
    /* Màu Gradient Tím - Hồng (Nổi bật) */
    background: linear-gradient(135deg, #7c3aed, #db2777) !important;
    border: none !important;
    
    /* Bo góc: Góc trên bên phải vuông */
    border-radius: 20px 4px 20px 20px !important;
    
    /* Màu chữ trắng tinh */
    color: #ffffff !important;
    font-weight: 500 !important;
    
    /* Phát sáng nhẹ */
    box-shadow: 0 4px 15px rgba(219, 39, 119, 0.4) !important;
    padding: 15px !important;
}

/* 4. Tùy chỉnh Avatar (nếu có) */
#chatbot .avatar img {
    border: 2px solid #a855f7 !important; /* Viền avatar màu tím */
    box-shadow: 0 0 10px rgba(168, 85, 247, 0.5);
}

/* 5. Ẩn thanh Label thừa thãi (nếu show_label=False chưa ẩn hết) */
#chatbot > .label {
    display: none !important;
}

/* CSS cho tiêu đề chính "E-commerce AI Prediction & Assistant" */

#main_header h1 {
    /* 1. Viền màu tím (sử dụng mã màu tím từ các nút bấm của bạn) */
    border: 2px solid #7c3aed !important;

    /* 2. Hiệu ứng phát sáng màu tím (box-shadow) */
    /* offset-x | offset-y | blur-radius | color (với độ trong suốt) */
    box-shadow: 0 0 20px rgba(124, 58, 237, 0.6) !important;

    /* 3. Bo tròn góc để viền mềm mại hơn */
    border-radius: 12px !important;

    /* 4. Thêm khoảng cách giữa chữ và viền */
    padding: 10px 20px !important;

    /* 5. Căn giữa văn bản (nếu chưa được căn giữa) */
    text-align: center !important;

    /* 6. Đảm bảo màu chữ trắng để nổi bật trên nền tối */
    color: white !important;

    /* 7. Hiệu ứng chuyển đổi mượt mà (cho hover) */
    transition: all 0.3s ease-in-out;
}

/* (Tùy chọn) Hiệu ứng khi di chuột vào (hover) để sáng mạnh hơn */
#main_header h1:hover {
    border-color: #a855f7 !important; /* Màu tím sáng hơn */
    box-shadow: 0 0 30px rgba(168, 85, 247, 0.8) !important; /* Phát sáng mạnh hơn và rộng hơn */
}

/* Khung chứa (Container) - Hiệu ứng kính mờ */
.bi-header-container {
    background: rgba(255, 255, 255, 0.04); /* Nền siêu mờ */
    border: 1px solid rgba(255, 255, 255, 0.1); /* Viền mỏng */
    border-radius: 20px; /* Bo góc tròn trịa */
    padding: 30px;
    text-align: center;
    box-shadow: 0 8px 32px 0 rgba(0, 0, 0, 0.2); /* Bóng đổ tạo chiều sâu */
    backdrop-filter: blur(8px); /* Làm mờ hậu cảnh sau kính */
    margin-bottom: 20px;
}

/* Tiêu đề chính - Chữ Gradient chuyển màu */
.bi-title {
    font-size: 2.5rem !important;
    font-weight: 800 !important;
    margin-bottom: 10px;
    text-transform: uppercase;
    letter-spacing: 2px;
    
    /* Tạo màu Gradient Tím -> Xanh */
    background: linear-gradient(to right, #c084fc, #6366f1, #3b82f6);
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
}

/* Phụ đề - Màu xám sáng */
.bi-subtitle {
    font-size: 1.1rem;
    color: #cbd5e1;
    font-weight: 300;
    line-height: 1.6;
}
.bi-subtitle i {
    color: #94a3b8;
    font-size: 0.9rem;
}
"""


with gr.Blocks(
    title="E-commerce AI System",
    theme=theme,
    css=custom_css
) as ui:
    store_df = gr.State()

    gr.Markdown("# E-commerce AI Prediction & Assistant", elem_id="main_header")

    with gr.Tabs(elem_classes="custom-nav"):

        # === TAB 1 ===
        with gr.Tab("Single Prediction"):
            with gr.Row():
                with gr.Column():
                    user_id = gr.Textbox(
                        label="User ID", 
                        value=1000, 
                        placeholder="e.g. 1000"
                        )
                    product_id = gr.Textbox(
                        label="Product ID", 
                        value=1000, 
                        placeholder="e.g. 1000"
                        )
                with gr.Column():
                    price = gr.Number(
                        label="Price ($)", 
                        value=100.0, 
                        precision=2)
                    brand = gr.Textbox(
                        value="nvidia",
                        label="Brand",
                        placeholder='e.g. nvidia'
                    )
                with gr.Column():
                    act_count = gr.Slider(
                        1, 50, 
                        value=5, 
                        step=1, 
                        label="Activity Count", 
                        info="Number of user interactions (views, clicks, etc.)")
                    weekday = gr.Dropdown(
                        ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"],
                        value="Sunday",
                        label="Weekday", 
                        info="Day when the activity happened"
                    )

            btn_pred = gr.Button("Predict", 
                                 variant="primary", 
                                 size="lg")
            out_pred = gr.Markdown(label="Prediction Result\n_Chưa có kết quả_", 
                                    elem_classes="big-result")
            btn_pred.click(
                predict_single,
                [user_id, product_id, price, brand, act_count, weekday],
                out_pred
            )
            

        # === TAB 2 ===
        with gr.Tab("Upload file CSV"):
            with gr.Row():
                file_in = gr.File(
                    label="Upload CSV",
                    file_types=[".csv"]
                )
            with gr.Row():
                btn_preview = gr.Button("Preview CSV", variant="primary")

            preview_df = gr.Dataframe(
                label="Preview (First 10 rows)",
                interactive=False
            )

            # Preview 10 dòng đầu
            btn_preview.click(
                preview_csv,
                inputs=file_in,
                outputs=[store_df, preview_df]
            )

            
        # === TAB 3 ===
        with gr.Tab("AI Chatbot"):
            # ===== HEADER =====
            gr.HTML(
                """
                <div class="ai-header">
                    <div class="ai-left">
                        <div class="ai-avatar">🤖</div>
                        <div>
                            <div class="ai-title">AI Growth Assistant</div>
                            <div class="ai-subtitle">
                                Smart insights for E-commerce Optimization
                            </div>
                        </div>
                    </div>

                    <div class="ai-status">
                        <span class="pulse"></span>
                        <span>LIVE</span>
                    </div>
                </div>
                """,
                elem_id="ai_header"
            )

            # ===== CHAT AREA =====
            chatbot = gr.Chatbot(
                height=420,
                show_label=False,
                elem_id="chatbot", 
                value=initial_message, 
                # Thêm dòng này để hiện Avatar (User icon người, Bot icon robot)
                avatar_images=("https://cdn-icons-png.flaticon.com/128/2172/2172002.png", "https://cdn-icons-png.flaticon.com/128/19025/19025678.png"),
            )

            # ===== INPUT AREA =====

            with gr.Row(elem_id="input_row_container"):
                msg = gr.Textbox(
                    placeholder="Ask about retention, cart abandonment, or marketing attribution...",
                    show_label=False,
                    scale=20, 
                    elem_id="custom_msg", 
                    container=False
                )
                send_btn = gr.Button("➤", scale=2, variant="primary", elem_id="send_btn_to")

            # ===== SUGGESTED PROMPTS =====
            with gr.Row():
                p1 = gr.Button("📊 Analyze current performance", elem_classes="btn-blue")
                p2 = gr.Button("🧠 Improve conversion rate", elem_classes="btn-purple")
                p3 = gr.Button("🚀 Growth strategy suggestions", elem_classes="btn-pink")

            # ===== EVENTS =====
            msg.submit(
                chat_interface,
                inputs=[msg, chatbot],
                outputs=[msg, chatbot]
            )

            send_btn.click(
                chat_interface,
                inputs=[msg, chatbot],
                outputs=[msg, chatbot]
            )

            p1.click(
                lambda: "Analyze current model performance",
                outputs=msg
            )

            p2.click(
                lambda: "How can I improve conversion rate?",
                outputs=msg
            )

            p3.click(
                lambda: "Suggest growth strategies for my e-commerce",
                outputs=msg
            )

        # ===TAB 4 ===
        with gr.Tab("Dashboard"):
            with gr.Row():
                gr.HTML(
                    """
                        <div style="
                            display: flex; 
                            flex-direction: column; 
                            align-items: center; 
                            justify-content: center; 
                            text-align: center;
                            background: rgba(255, 255, 255, 0.04); 
                            border: 1px solid rgba(255, 255, 255, 0.1);
                            border-radius: 20px; 
                            padding: 15px; 
                            margin-bottom: 20px;
                            box-shadow: 0 4px 20px rgba(0,0,0,0.2);
                            backdrop-filter: blur(10px);
                        ">
                            <div style="
                                font-size: 2.0rem; 
                                font-weight: 900; 
                                text-transform: uppercase;
                                margin-bottom: 10px;
                                background: linear-gradient(90deg, #a855f7, #3b82f6, #06b6d4);
                                -webkit-background-clip: text;
                                -webkit-text-fill-color: transparent;
                                font-family: sans-serif;
                            ">
                                Business Intelligence Hub
                            </div>
                            
                            <div style="
                                font-size: 1.2rem; 
                                color: #cbd5e1; 
                                font-weight: 300; 
                                max-width: 600px;
                                line-height: 1.2;
                            ">
                                Centralized data analytics system & Key performance indicator visualization.<br>
                                <span style="color: #94a3b8; font-size: 1rem; font-style: italic;">
                                    (Click the button below to update to the latest report)
                                </span>
                            </div>
                        </div>
                    """
                )
            
            # Nút bấm to, màu nổi bật (variant='primary') để kích hoạt
            with gr.Row():
                btn_analyze = gr.Button("Dashboard Update & Insight Analysis", variant="primary", scale=3)
            
            # HÀNG 1: TỔNG QUAN HIỆU SUẤT
            with gr.Row():
                with gr.Column(scale=1): # Cột trái
                    plot_funnel = gr.Plot(label="Conversion Funnel")
                
                with gr.Column(scale=1): # Cột phải
                    plot_price = gr.Plot(label="Price Distribution")

            # HÀNG 2: PHÂN TÍCH HÀNH VI
            with gr.Row():
                with gr.Column(scale=1): # Cột trái
                    plot_hourly = gr.Plot(label="Hourly Patterns")
                
                with gr.Column(scale=1): # Cột phải
                    plot_latency = gr.Plot(label="Purchase Latency")

            btn_analyze.click(
                fn=update_full_dashboard,   
                inputs=store_df,       
                outputs=[plot_funnel, plot_price, plot_hourly, plot_latency] 
            )
if __name__ == "__main__":
    ui.launch(share=True)

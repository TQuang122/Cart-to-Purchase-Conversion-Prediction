import pandas as pd
import numpy as np
import gradio as gr
import random 
# --- 1. LOGIC DỰ ĐOÁN ---

def predict_single(event_time, product_id, category_id, category_code, brand, price, user_id, user_session):
    # --- ĐOẠN NÀY LÀ LOGIC GIẢ LẬP CỦA BẠN ---
    # Ví dụ: trả về xác suất 85% và trạng thái "Mua"
    probability = random.randint(40, 60) 
    label = "purchase" if probability > 50 else "not purchase"


    # Thiết lập màu sắc Dynamic dựa trên kết quả
    if probability >= 50:
        main_color = "#00ff88"  # Xanh Neon
        glow_color = "rgba(0, 255, 136, 0.5)"
        gradient_start = "#c75acd"
        gradient_end = "#c469b8"
    else:
        main_color = "#ff4b2b"  # Đỏ Neon
        glow_color = "rgba(255, 75, 43, 0.5)"
        gradient_start = "#ff4b2b"
        gradient_end = "#ff416c"
    # Tạo HTML cho vòng tròn phần trăm (CSS lồng vào)
    html_result = f"""
    <div style="
        display: flex; 
        align-items: center; 
        justify-content: space-around; 
        padding: 30px; 
        background: #111827; 
        border-radius: 20px; 
        border: 2px solid {main_color}; 
        box-shadow: 0 0 25px {glow_color}; 
        max-width: 550px; 
        margin: 20px auto;
        transition: all 0.5s ease;
    ">
        <div style="position: relative; width: 130px; height: 130px; filter: drop-shadow(0 0 8px {glow_color});">
            <svg viewBox="0 0 36 36" style="transform: rotate(-90deg); width: 100%; height: 100%;">
                <defs>
                    <linearGradient id="grad1" x1="0%" y1="0%" x2="100%" y2="100%">
                        <stop offset="0%" style="stop-color:{gradient_start};stop-opacity:1" />
                        <stop offset="100%" style="stop-color:{gradient_end};stop-opacity:1" />
                    </linearGradient>
                </defs>
                <circle cx="18" cy="18" r="15.9155" fill="none" stroke="#2d3748" stroke-width="3" />
                <circle cx="18" cy="18" r="15.9155" fill="none" 
                        stroke="url(#grad1)" 
                        stroke-width="3.5" 
                        stroke-dasharray="{probability}, 100" 
                        stroke-linecap="round" 
                        style="transition: stroke-dasharray 1s ease-in-out;" />
            </svg>
            <div style="
                position: absolute; 
                top: 50%; 
                left: 50%; 
                transform: translate(-50%, -50%); 
                color: white; 
                font-family: 'Inter', sans-serif;
                font-size: 22px; 
                font-weight: 800;
                text-shadow: 0 0 10px rgba(255,255,255,0.3);
            ">
                {probability}%
            </div>
        </div>

        <div style="text-align: left; font-family: 'Inter', -apple-system, sans-serif;">
            <p style="color: #94a3b8; margin: 0; font-size: 14px; font-weight: 600; text-transform: uppercase; letter-spacing: 2.5px;">
                Predict results
            </p>
            <h2 style="
                color: white; 
                margin: 8px 0 0 0; 
                font-size: 38px; 
                font-weight: 900; 
                letter-spacing: -1px;
                background: linear-gradient(to right, white, {main_color});
                -webkit-background-clip: text;
                -webkit-text-fill-color: transparent;
            ">
                {label}
            </h2>
        </div>
    </div>
    """
    return html_result

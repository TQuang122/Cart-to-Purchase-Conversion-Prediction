import gradio as gr
import pandas as pd
import random
import time
import google.generativeai as genai
import os
import matplotlib.pyplot as plt
import seaborn as sns
from show_chart import plot_cart_abandonment_latency, plot_funnel_analysis, plot_hourly_conversion, plot_price_distribution, update_full_dashboard
from css import custom_css
from chatbot_function import build_prompt, chat_interface, initial_message
from upload_csv_func import preview_csv
from predict_func import predict_single


# --- UI ---


theme = gr.themes.Soft(
    primary_hue="indigo",
    neutral_hue="slate",
).set(
    body_background_fill="#0f172a",
    block_background_fill="#1e293b",
    body_text_color="white",
)






with gr.Blocks(
    title="E-commerce AI System",
    theme=theme,
    css=custom_css
) as ui:
    store_df = gr.State()
    gr.Markdown("# 🛒 E-commerce AI Prediction & Assistant", elem_id="main_header")
    with gr.Tabs(elem_classes="custom-nav"):
        # === TAB OVERVIEW ===
        with gr.Tab("Overview"):
            gr.HTML(
            """"
                <div id="home-wrapper">

                <div id="home-header">
                    <div id="home-title">
                    Customer Churn Prediction – End-to-End MLOps Pipeline
                    </div>
                    <div id="home-desc">
                    This project implements a complete <b>MLOps pipeline</b> for customer churn prediction,
                    covering the entire machine learning lifecycle from data ingestion to production deployment.
                    </div>
                </div>

                <div class="pipeline-grid">

                    <div class="pipeline-card">
                    <div class="pipeline-title">📦 Data Pipeline</div>
                    <p>
                        Version-controlled data with <b>DVC</b>, feature engineering using <b>Feast</b>,
                        and Redis-backed online feature serving.
                    </p>
                    </div>

                    <div class="pipeline-card">
                    <div class="pipeline-title">🤖 Model Pipeline</div>
                    <p>
                        <b>XGBoost</b> training with <b>MLflow</b> experiment tracking,
                        model registry, and automated evaluation.
                    </p>
                    </div>

                    <div class="pipeline-card">
                    <div class="pipeline-title">🚀 Serving Pipeline</div>
                    <p>
                        <b>FastAPI</b>-based prediction service integrated with
                        <b>Gradio UI</b> and monitoring components.
                    </p>
                    </div>

                    <div class="pipeline-card">
                    <div class="pipeline-title">🛠 Infrastructure</div>
                    <p>
                        Kubernetes and Docker orchestration for <b>PostgreSQL</b>, <b>MinIO</b>,
                        <b>MLflow</b>, <b>Kafka</b>, <b>Airflow</b>, and monitoring stack.
                    </p>
                    </div>

                </div>

                <p style="margin-top:28px; opacity:0.8;">
                    Designed for <b>scalability</b>, <b>reproducibility</b>, and
                    <b>production-grade deployment</b>.
                </p>

                </div>
                """          
                ,
                elem_id="home"
                )
        # === TAB 1 ===
        with gr.Tab("Single Prediction"):
            with gr.Row():
                # Cột 1: Thông tin Thời gian & Sản phẩm
                with gr.Column(scale=1):
                    gr.Markdown("### General information")
                    event_time = gr.Textbox(
                        label="Event Time", 
                        value="2019-10-31 15:01:18 UTC", 
                        elem_classes=["glow-input"] # Thêm hiệu ứng viền phát sáng
                    )
                    product_id = gr.Textbox(
                        label="Product ID", 
                        value="1201495", 
                        elem_classes=["glow-input"] # Thêm hiệu ứng viền phát sáng
                    )
                    brand = gr.Textbox(
                        label="Brand",
                        value="prestigio", 
                        elem_classes=["glow-input"] # Thêm hiệu ứng viền phát sáng
                    )

                # Cột 2: Danh mục & Giá
                with gr.Column(scale=1):
                    gr.Markdown("### Product details")
                    category_id = gr.Textbox(
                        label="Category ID", 
                        value="2172371436436455700", 
                        elem_classes=["glow-input"] # Thêm hiệu ứng viền phát sáng
                    )
                    category_code = gr.Textbox(
                        label="Category Code", 
                        value="electronics.tablet", 
                        elem_classes=["glow-input"] # Thêm hiệu ứng viền phát sáng
                    )
                    price = gr.Number(
                        label="Price ($)", 
                        value=84.92, 
                        precision=2, 
                        elem_classes=["glow-input"] # Thêm hiệu ứng viền phát sáng
                    )

                # Cột 3: Người dùng & Session
                with gr.Column(scale=1):
                    gr.Markdown("### User Information")
                    user_id = gr.Textbox(
                        label="User ID", 
                        value="56440934", 
                        elem_classes=["glow-input"] # Thêm hiệu ứng viền phát sáng
                    )
                    user_session = gr.Textbox(
                        label="User Session", 
                        value="a0845802-0530-4d7b-96bc-4103d", 
                        elem_classes=["glow-input"] # Thêm hiệu ứng viền phát sáng
                    )

            with gr.Row():
                btn_pred = gr.Button("🚀 Predict Now", variant="primary", size="lg")
            # Phần hiển thị kết quả (Vòng tròn phần trăm)
            gr.Markdown("---")
            with gr.Row():
                with gr.Row():
                    out_pred = gr.HTML(
                        value="""
                                <div style='
                                display: flex; 
                                flex-direction: column; 
                                align-items: center; 
                                justify-content: center; 
                                padding: 40px; 
                                background: radial-gradient(circle at center, #1f2937 0%, #111827 100%); 
                                border-radius: 20px; 
                                border: 1px solid #374151;
                                min-height: 180px;
                                position: relative;
                                overflow: hidden;
                                box-shadow: 0 10px 30px rgba(0,0,0,0.5);
                            '>
                                <div class="shimmer" style="
                                    position: absolute;
                                    top: 0; left: -150%;
                                    width: 50%; height: 100%;
                                    background: linear-gradient(to right, transparent, rgba(96, 165, 250, 0.1), transparent);
                                    transform: skewX(-20deg);
                                    animation: move 3s infinite;
                                "></div>

                                <div style="
                                    width: 60px; 
                                    height: 60px; 
                                    border: 2px solid #374151; 
                                    border-top: 2px solid #60a5fa; 
                                    border-right: 2px solid #60a5fa;
                                    border-radius: 50%; 
                                    margin-bottom: 20px;
                                    animation: spin 2s linear infinite;
                                    box-shadow: 0 0 15px rgba(96, 165, 250, 0.3);
                                "></div>
                                
                                <div style='text-align: center; z-index: 1;'>
                                    <h3 style='color: #ffffff; margin: 0; font-family: "Inter", sans-serif; font-size: 20px; font-weight: 600; letter-spacing: 1px;'>
                                        SYSTEM STANDBY
                                    </h3>
                                    <p style='color: #9ca3af; margin: 8px 0 0 0; font-family: "Inter", sans-serif; font-size: 14px; line-height: 1.5;'>
                                        Model is ready. Please provide input data<br>
                                        and click <b style="color: #60a5fa;">Predict Now</b>
                                    </p>
                                </div>

                                <style>
                                    @keyframes spin {
                                        from { transform: rotate(0deg); }
                                        to { transform: rotate(360deg); }
                                    }
                                    @keyframes move {
                                        0% { left: -150%; }
                                        100% { left: 150%; }
                                    }
                                </style>
                            </div>
                            """,
                    container=False
                    )

            # Sự kiện Click
            btn_pred.click(
                predict_single,
                [event_time, product_id, category_id, category_code, brand, price, user_id, user_session],
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

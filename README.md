# Cart-to-Purchase Conversion Prediction Using E-commerce Behavioral Data

[![Python](https://img.shields.io/badge/Python-3.10+-blue.svg)](https://www.python.org/downloads/)
[![MLflow](https://img.shields.io/badge/MLflow-Latest-orange.svg)](https://mlflow.org/)
[![Feast](https://img.shields.io/badge/Feast-Feature_Store-red.svg)](https://feast.dev/)
[![Kubernetes](https://img.shields.io/badge/Kubernetes-Ready-326CE5.svg)](https://kubernetes.io/)
[![Docker](https://img.shields.io/badge/Docker-Compose-2496ED.svg)](https://www.docker.com/)

We formulate cart-to-purchase conversion as a conditional prediction problem, where the target is defined only after an add-to-cart event has occurred.

## 📖 Table of Contents

- [Overview](#overview)
- [Data Source](#data-source)
- [Architecture](#architecture)
<!-- - [Features](#features)
- [Project Structure](#project-structure)
- [Prerequisites](#prerequisites)
- [Quick Start](#quick-start)
- [Pipelines](#pipelines)
- [Infrastructure](#infrastructure)
- [Monitoring & Observability](#monitoring--observability)
- [Development](#development)
- [References](#references) -->

---

## 🎯 Overview

This project implements a complete MLOps pipeline for **customer churn prediction**, covering the entire machine learning lifecycle:

- **Data Pipeline**: Version-controlled data with DVC, feature engineering with Feast, and Redis-backed online feature serving
- **Model Pipeline**: XGBoost model training with MLflow experiment tracking, model registry, and automated evaluation
- **Serving Pipeline**: FastAPI-based prediction service with Gradio UI and monitoring integration
- **Infrastructure**: Kubernetes and Docker orchestration for PostgreSQL, MinIO, MLflow, Kafka, Airflow, and monitoring stack

The system is designed for scalability, reproducibility, and production deployment.

---
## 📊 Data Source

> eCommerce Behavior Data from Multi Category Store

The dataset can be found [here](https://www.kaggle.com/datasets/mkechinov/ecommerce-behavior-data-from-multi-category-store/data). This dataset contains behavior data from over 285 million user events on a large multi-category eCommerce website.

The data spans 7 months (October 2019 to April 2020) and captures user-product interactions like views, cart additions/removals, and purchases. Each event represents a many-to-many relationship between users and products.

The dataset was collected by the Open CDP project, an open source customer data platform that enables tracking and analysis of user behavior data.

### File Structure

| Field         | Description                                                          |
| ------------- | -------------------------------------------------------------------- |
| event_time    | UTC timestamp when the event occurred                                |
| event_type    | Type of user interaction event                                       |
| product_id    | Unique identifier for the product                                    |
| category_id   | Product category identifier                                          |
| category_code | Product category taxonomy (when available for meaningful categories) |
| brand         | Brand name (lowercase, may be missing)                               |
| price         | Product price (float)                                                |
| user_id       | Permanent user identifier                                            |
| user_session  | Temporary session ID that changes after long user inactivity         |

### Event Types

The dataset captures four types of user interactions:

- **view**: User viewed a product
- **cart**: User added a product to shopping cart
- **remove_from_cart**: User removed a product from shopping cart
- **purchase**: User purchased a product

### Modeling: Customer Cart-to-Purchase Conversion Prediction

The core modeling task is to predict whether a product added to a shopping cart will result in a completed purchase.

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                      MLOps Infrastructure                       │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌───────────────────┐      ┌──────────────────┐                │
│  │  Data Pipeline    │      │  Model Pipeline  │                │
│  ├───────────────────┤      ├──────────────────┤                │
│  │ • DVC (S3/MinIO)  │      │ • MLflow Track   │                │
│  │ • Feast Features  │─────▶│ • XGBoost Model  │                │
│  │ • Redis Online    │      │ • Model Registry │                │
│  └───────────────────┘      └────────┬─────────┘                │
│           │                          │                          │
│           │                          ▼                          │
│           │                  ┌──────────────────┐               │
│           └─────────────────▶│ Serving Pipeline │               │
│                              ├──────────────────┤               │
│                              │ • FastAPI        │               │
│                              │ • Gradio UI      │               │
│                              │ • Monitoring     │               │
│                              └──────────────────┘               │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │              Infrastructure Services                       │ │
│  ├────────────────────────────────────────────────────────────┤ │
│  │ PostgreSQL | MinIO | MLflow | Kafka | Airflow | Monitoring │ │
│  └────────────────────────────────────────────────────────────┘ │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
``` 

## Gemini Chatbot Setup

The React chatbot widget uses the backend endpoint `POST /chat`, and the backend calls Gemini securely with a server-side key.

1. Set your key in the backend environment:

```bash
export GEMINI_API_KEY="your_new_gemini_api_key"
# Optional: force a specific model if needed
export GEMINI_MODEL="gemini-2.5-flash"
```

2. Prepare backend runtime (required before serving):

```bash
# Recommended: use the project serving env
conda activate propensity_mlops

cd serving_pipeline
python -m pip install -r requirements.txt
```

3. Start backend API:

```bash
cd serving_pipeline
uvicorn api.main:app --host 127.0.0.1 --port 8000
```

4. Start frontend:

```bash
cd serving_pipeline/react-ui
npm run dev
```

Security note: do not place Gemini keys in frontend code or commit them to the repository.

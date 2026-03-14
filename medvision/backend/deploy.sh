#!/bin/bash
set -euo pipefail

# ── MedVision — Cloud Run deployment script ──────────────────────────────────

PROJECT_ID=$(gcloud config get-value project)
REGION="us-central1"
SERVICE_NAME="medvision"
IMAGE="gcr.io/${PROJECT_ID}/${SERVICE_NAME}"

echo "========================================"
echo "  Deploying MedVision"
echo "  Project : ${PROJECT_ID}"
echo "  Region  : ${REGION}"
echo "========================================"

# Enable required GCP APIs
echo "→ Enabling GCP services…"
gcloud services enable \
  run.googleapis.com \
  firestore.googleapis.com \
  storage.googleapis.com \
  cloudbuild.googleapis.com \
  logging.googleapis.com \
  --project="${PROJECT_ID}"

# Create Firestore database in native mode if it doesn't exist
echo "→ Ensuring Firestore database exists…"
gcloud firestore databases create \
  --location="${REGION}" \
  --project="${PROJECT_ID}" 2>/dev/null || echo "   (Firestore already exists)"

# Create session logs bucket if it doesn't exist
BUCKET_NAME="medvision-session-logs-${PROJECT_ID}"
echo "→ Ensuring GCS bucket ${BUCKET_NAME} exists…"
gsutil mb -p "${PROJECT_ID}" -l US "gs://${BUCKET_NAME}" 2>/dev/null || echo "   (Bucket already exists)"

# Seed Firestore with WHO protocols
echo "→ Seeding Firestore WHO protocols…"
GOOGLE_CLOUD_PROJECT="${PROJECT_ID}" python seed_firestore.py

# Build and push Docker image to Container Registry
echo "→ Building container image…"
gcloud builds submit \
  --tag "${IMAGE}" \
  --project="${PROJECT_ID}"

# Deploy to Cloud Run
echo "→ Deploying to Cloud Run…"
gcloud run deploy "${SERVICE_NAME}" \
  --image "${IMAGE}" \
  --platform managed \
  --region "${REGION}" \
  --allow-unauthenticated \
  --memory 2Gi \
  --cpu 2 \
  --min-instances 1 \
  --max-instances 10 \
  --timeout 3600 \
  --set-env-vars "GOOGLE_CLOUD_PROJECT=${PROJECT_ID},GOOGLE_CLOUD_LOCATION=${REGION}" \
  --project="${PROJECT_ID}"

echo ""
echo "========================================"
echo "  SUCCESS: MedVision deployed!"
echo "========================================"

SERVICE_URL=$(gcloud run services describe "${SERVICE_NAME}" \
  --region "${REGION}" \
  --format "value(status.url)" \
  --project="${PROJECT_ID}")

echo "  URL     : ${SERVICE_URL}"
echo "  Health  : ${SERVICE_URL}/health"
echo ""
echo "Set this in your frontend .env:"
echo "  VITE_CLOUD_RUN_URL=${SERVICE_URL}"
echo "========================================"

#!/bin/bash
set -euo pipefail

# ── MedVision — Cloud Run deployment script ──────────────────────────────────

PROJECT_ID=$(gcloud config get-value project)
REGION="us-central1"
SERVICE_NAME="medvision"
IMAGE="gcr.io/${PROJECT_ID}/${SERVICE_NAME}"

# GEMINI_API_KEY must be set in the shell before running this script
if [[ -z "${GEMINI_API_KEY:-}" ]]; then
  echo "ERROR: GEMINI_API_KEY is not set."
  echo "  export GEMINI_API_KEY=your_key_from_aistudio.google.com"
  exit 1
fi

echo "========================================"
echo "  Deploying MedVision"
echo "  Project : ${PROJECT_ID}"
echo "  Region  : ${REGION}"
echo "========================================"

# Enable required GCP APIs
echo "→ Enabling GCP services…"
gcloud services enable \
  run.googleapis.com \
  cloudbuild.googleapis.com \
  logging.googleapis.com \
  secretmanager.googleapis.com \
  --project="${PROJECT_ID}"

# Create or update GEMINI_API_KEY secret in Secret Manager
echo "→ Uploading GEMINI_API_KEY to Secret Manager…"
if gcloud secrets describe gemini-api-key --project="${PROJECT_ID}" &>/dev/null; then
  echo -n "${GEMINI_API_KEY}" | gcloud secrets versions add gemini-api-key \
    --data-file=- --project="${PROJECT_ID}"
  echo "   (secret updated)"
else
  echo -n "${GEMINI_API_KEY}" | gcloud secrets create gemini-api-key \
    --data-file=- --replication-policy=automatic --project="${PROJECT_ID}"
  echo "   (secret created)"
fi

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
  --set-secrets "GEMINI_API_KEY=gemini-api-key:latest" \
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

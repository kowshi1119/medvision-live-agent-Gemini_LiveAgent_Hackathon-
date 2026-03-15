terraform {
  required_version = ">= 1.5"
  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 5.0"
    }
  }
}

variable "project_id" {
  description = "GCP Project ID"
  type        = string
}

variable "region" {
  description = "GCP region for Cloud Run and Firestore"
  type        = string
  default     = "us-central1"
}

variable "image" {
  description = "Container image URL (gcr.io/PROJECT_ID/medvision)"
  type        = string
}

provider "google" {
  project = var.project_id
  region  = var.region
}

# ── APIs ──────────────────────────────────────────────────────────────────────

resource "google_project_service" "run" {
  service            = "run.googleapis.com"
  disable_on_destroy = false
}

resource "google_project_service" "firestore" {
  service            = "firestore.googleapis.com"
  disable_on_destroy = false
}

resource "google_project_service" "storage" {
  service            = "storage.googleapis.com"
  disable_on_destroy = false
}

resource "google_project_service" "cloudbuild" {
  service            = "cloudbuild.googleapis.com"
  disable_on_destroy = false
}

resource "google_project_service" "logging" {
  service            = "logging.googleapis.com"
  disable_on_destroy = false
}

resource "google_project_service" "secretmanager" {
  service            = "secretmanager.googleapis.com"
  disable_on_destroy = false
}

# ── Firestore ─────────────────────────────────────────────────────────────────

resource "google_firestore_database" "default" {
  name                        = "(default)"
  location_id                 = var.region
  type                        = "FIRESTORE_NATIVE"
  delete_protection_state     = "DELETE_PROTECTION_ENABLED"
  deletion_policy             = "DELETE"

  depends_on = [google_project_service.firestore]
}

# ── Cloud Storage ─────────────────────────────────────────────────────────────

resource "google_storage_bucket" "session_logs" {
  name          = "medvision-session-logs-${var.project_id}"
  location      = "US"
  force_destroy = false

  lifecycle_rule {
    condition {
      age = 90
    }
    action {
      type = "Delete"
    }
  }

  versioning {
    enabled = false
  }

  uniform_bucket_level_access = true

  depends_on = [google_project_service.storage]
}

# ── Service Account ───────────────────────────────────────────────────────────

resource "google_service_account" "medvision" {
  account_id   = "medvision-sa"
  display_name = "MedVision Cloud Run Service Account"
}

resource "google_project_iam_member" "firestore_user" {
  project = var.project_id
  role    = "roles/datastore.user"
  member  = "serviceAccount:${google_service_account.medvision.email}"
}

resource "google_project_iam_member" "storage_object_admin" {
  project = var.project_id
  role    = "roles/storage.objectAdmin"
  member  = "serviceAccount:${google_service_account.medvision.email}"
}

resource "google_project_iam_member" "logging_writer" {
  project = var.project_id
  role    = "roles/logging.logWriter"
  member  = "serviceAccount:${google_service_account.medvision.email}"
}

resource "google_project_iam_member" "aiplatform_user" {
  project = var.project_id
  role    = "roles/aiplatform.user"
  member  = "serviceAccount:${google_service_account.medvision.email}"
}

# ── Secret Manager — GEMINI_API_KEY ───────────────────────────────────────────
# The secret shell is created here; the actual value must be uploaded once:
#   echo -n "YOUR_KEY" | gcloud secrets versions add gemini-api-key --data-file=- --project=PROJECT_ID

resource "google_secret_manager_secret" "gemini_api_key" {
  secret_id = "gemini-api-key"

  replication {
    auto {}
  }

  depends_on = [google_project_service.secretmanager]
}

resource "google_secret_manager_secret_iam_member" "medvision_sa_access" {
  secret_id = google_secret_manager_secret.gemini_api_key.id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.medvision.email}"
}

# ── Cloud Run ─────────────────────────────────────────────────────────────────

resource "google_cloud_run_v2_service" "medvision" {
  name     = "medvision"
  location = var.region
  ingress  = "INGRESS_TRAFFIC_ALL"

  template {
    service_account = google_service_account.medvision.email

    scaling {
      min_instance_count = 1
      max_instance_count = 10
    }

    containers {
      image = var.image

      resources {
        limits = {
          cpu    = "2"
          memory = "2Gi"
        }
        cpu_idle = false
      }

      env {
        name  = "GOOGLE_CLOUD_PROJECT"
        value = var.project_id
      }

      env {
        name  = "GOOGLE_CLOUD_LOCATION"
        value = var.region
      }

      env {
        name  = "MEDVISION_SESSION_BUCKET"
        value = google_storage_bucket.session_logs.name
      }

      # GEMINI_API_KEY injected at runtime from Secret Manager
      env {
        name = "GEMINI_API_KEY"
        value_source {
          secret_key_ref {
            secret  = google_secret_manager_secret.gemini_api_key.secret_id
            version = "latest"
          }
        }
      }

      liveness_probe {
        http_get {
          path = "/health"
          port = 8080
        }
        initial_delay_seconds = 10
        period_seconds        = 30
        failure_threshold     = 3
      }

      startup_probe {
        http_get {
          path = "/health"
          port = 8080
        }
        initial_delay_seconds = 5
        period_seconds        = 5
        failure_threshold     = 10
      }
    }

    timeout = "3600s"
  }

  depends_on = [
    google_project_service.run,
    google_firestore_database.default,
    google_storage_bucket.session_logs,
    google_secret_manager_secret_iam_member.medvision_sa_access,
  ]
}

# ── Allow unauthenticated invocations ─────────────────────────────────────────

resource "google_cloud_run_v2_service_iam_member" "public" {
  name     = google_cloud_run_v2_service.medvision.name
  location = var.region
  role     = "roles/run.invoker"
  member   = "allUsers"
}

# ── Outputs ───────────────────────────────────────────────────────────────────

output "service_url" {
  description = "Cloud Run service URL"
  value       = google_cloud_run_v2_service.medvision.uri
}

output "bucket_name" {
  description = "Session logs GCS bucket name"
  value       = google_storage_bucket.session_logs.name
}

output "service_account_email" {
  description = "Cloud Run service account email"
  value       = google_service_account.medvision.email
}

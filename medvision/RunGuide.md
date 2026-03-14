# How to Run MedVision

This guide provides the necessary steps to deploy the backend and run the frontend of the MedVision project.

## Prerequisites

Before you begin, ensure you have the following installed and configured:

*   **Google Cloud SDK (`gcloud`)**: Authenticated with a project that has billing enabled.
    *   Run `gcloud auth application-default login` to authenticate.
*   **Node.js**: Version 20 or newer.
*   **Python**: Version 3.11 or newer.

---

## 1. Deploy the Backend

The backend is designed to be deployed as a serverless container on Google Cloud Run. A deployment script is provided to automate the entire process.

```bash
# 1. Navigate to the backend directory
cd medvision/backend

# 2. Set your Google Cloud project ID
gcloud config set project YOUR_PROJECT_ID

# 3. Make the deployment script executable and run it
chmod +x deploy.sh && ./deploy.sh
```

This script will:
*   Enable the required Google Cloud APIs.
*   Build the Docker container image using Google Cloud Build.
*   Deploy the image to Cloud Run.
*   Seed the Firestore database with the necessary WHO protocols.

At the end of the script, it will output the **Cloud Run URL**. Copy this URL for the next step.
**Example URL:** `https://medvision-abc123-uc.a.run.app`

---

## 2. Run the Frontend Locally

The frontend is a React application built with Vite.

```bash
# 1. Navigate to the frontend directory
cd medvision/frontend

# 2. Create a local environment file from the example
cp .env.example .env

# 3. Edit the .env file and set the backend URL
# Open .env in your editor and replace the placeholder with the
# Cloud Run URL you copied from the backend deployment step.
#
# VITE_CLOUD_RUN_URL=https://medvision-abc123-uc.a.run.app

# 4. Install the necessary Node.js dependencies
npm install

# 5. Start the local development server
npm run dev
```

After running `npm run dev`, your browser should open to `http://localhost:3000`, where you can interact with the MedVision application.

---

## 3. Verify the Deployment (Optional)

You can quickly check if the backend is running correctly by sending a request to its health check endpoint.

```bash
# Replace with your actual Cloud Run URL
curl https://medvision-abc123-uc.a.run.app/health

# Expected response:
# {"status":"ok","version":"1.0.0"}
```

---
## 4. Deploy with Terraform (Optional)

For infrastructure-as-code enthusiasts, you can also deploy the backend resources using Terraform.

```bash
# 1. First, build and push the container image to Google Container Registry
gcloud builds submit --tag gcr.io/YOUR_PROJECT_ID/medvision --project YOUR_PROJECT_ID

# 2. Navigate to the terraform directory
cd medvision/backend/terraform

# 3. Initialize Terraform
terraform init

# 4. Apply the configuration
terraform apply -var="project_id=YOUR_PROJECT_ID" -var="image=gcr.io/YOUR_PROJECT_ID/medvision"
```

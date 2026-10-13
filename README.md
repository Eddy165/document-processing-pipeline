# Document Processing Pipeline

A serverless document-processing application for uploading resumes/documents, extracting text and metadata, storing results in DynamoDB, and searching processed documents.

## Architecture

```text
Browser
  |
  | Upload / Search
  v
API Gateway
  |                     
  +--> Upload Lambda ----> S3 (original document)
  |
  +--> Search Lambda ----> DynamoDB
                              ^
                              |
S3 ObjectCreated ---> Process Lambda
                         |      |
                         |      +--> extracts PDF/DOCX/TXT text
                         +----------> stores metadata + extracted text
```

## AWS Services

- **Amazon S3**: original document storage
- **AWS Lambda**: upload URL, document processing, search API
- **Amazon DynamoDB**: searchable document metadata and extracted text
- **Amazon API Gateway**: REST API
- **Amazon CloudWatch**: logs and monitoring
- **Amazon IAM**: least-privilege permissions

## Supported files

- PDF (`.pdf`)
- Microsoft Word (`.docx`)
- Plain text (`.txt`)

The processor extracts common resume metadata such as name, email, phone, skills, and word count. Metadata extraction is intentionally lightweight and deterministic so the demo works without an external AI API.

## Repository structure

```text
backend/
  lambda_functions.py       # API + processing handlers
  requirements.txt          # Lambda Python dependencies
frontend/
  index.html
  app.js
  styles.css
lambda/
  build_layer.ps1           # Windows packaging helper
infra/
  template.yaml             # AWS SAM infrastructure
requirements.txt             # local tooling
README.md
```

## 1. Run locally

Install Python 3.11+ and Node.js.

```powershell
cd document-processing-pipeline
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
```

For a fast frontend-only demo, open `frontend/index.html` in a browser. To run the real AWS backend, deploy the SAM stack below.

## 2. Deploy to AWS with SAM

Install AWS CLI and AWS SAM CLI, then configure credentials:

```powershell
aws configure
```

Build and deploy:

```powershell
sam build
sam deploy --guided
```

The guided deployment creates:

- `DocumentBucket`
- `DocumentTable`
- API Gateway endpoints
- upload Lambda
- processor Lambda
- search Lambda
- required IAM policies

After deployment, SAM prints `ApiUrl`.

## 3. Connect the frontend

Open `frontend/app.js` and replace:

```js
const API_BASE_URL = "YOUR_API_GATEWAY_URL";
```

with the `ApiUrl` output from SAM, then open `frontend/index.html`.

## API

### Create upload URL

`POST /upload-url`

```json
{
  "fileName": "john_resume.pdf",
  "contentType": "application/pdf"
}
```

Response:

```json
{
  "uploadUrl": "...",
  "documentId": "uuid",
  "key": "uploads/uuid-john_resume.pdf"
}
```

The browser uploads directly to S3 using the presigned URL. This avoids sending large files through Lambda.

### Search documents

`GET /documents?q=python`

Returns matching documents based on filename, extracted text, email, name, and skills.

### Processing

An S3 `ObjectCreated` event invokes the processor Lambda. It extracts text, detects metadata, and writes a `PROCESSED` record to DynamoDB.

## Important production hardening

This academic/demo project is intentionally compact. Before production, add authentication (Cognito), antivirus scanning, file-size/content validation, encryption with a customer-managed KMS key, pagination, stronger search (OpenSearch), PII controls, retry/dead-letter handling, and structured audit logging.

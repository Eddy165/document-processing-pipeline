
import base64
import boto3
import io
import json
import os
import re
import uuid
from decimal import Decimal
from datetime import datetime, timezone
from urllib.parse import quote, unquote_plus
from botocore.config import Config

s3 = boto3.client(
    "s3",
    region_name="ap-south-1",
    endpoint_url="https://s3.ap-south-1.amazonaws.com",
    config=Config(signature_version="s3v4"),
)

ddb = boto3.resource("dynamodb")
table = ddb.Table(os.environ["TABLE_NAME"])

ALLOWED = {
    "application/pdf": ".pdf",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document": ".docx",
    "text/plain": ".txt",
}

MAX_BYTES = 10 * 1024 * 1024


# Convert DynamoDB Decimal values into JSON-compatible values.
def json_serializable(value):
    if isinstance(value, Decimal):
        if value % 1 == 0:
            return int(value)
        return float(value)

    if isinstance(value, dict):
        return {
            key: json_serializable(item)
            for key, item in value.items()
        }

    if isinstance(value, list):
        return [json_serializable(item) for item in value]

    return value


def response(status, body):
    return {
        "statusCode": status,
        "headers": {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*",
        },
        "body": json.dumps(json_serializable(body)),
    }


def clean_filename(name):
    name = os.path.basename(name or "document")
    return re.sub(r"[^A-Za-z0-9._-]", "_", name)[:120]


def upload_url(event, _context):
    try:
        body = json.loads(event.get("body") or "{}")
        filename = clean_filename(body.get("fileName"))
        content_type = body.get(
            "contentType", "application/octet-stream"
        )

        if content_type not in ALLOWED:
            return response(
                400,
                {
                    "error": (
                        "Only PDF, DOCX and TXT files are supported."
                    )
                },
            )

        document_id = str(uuid.uuid4())
        key = f"uploads/{document_id}-{filename}"

        url = s3.generate_presigned_url(
            "put_object",
            Params={
                "Bucket": os.environ["BUCKET_NAME"],
                "Key": key,
                "ContentType": content_type,
            },
            ExpiresIn=900,
        )

        table.put_item(
            Item={
                "documentId": document_id,
                "status": "UPLOADING",
                "fileName": filename,
                "s3Key": key,
                "contentType": content_type,
                "createdAt": datetime.now(timezone.utc).isoformat(),
            }
        )

        return response(
            200,
            {
                "uploadUrl": url,
                "documentId": document_id,
                "key": key,
            },
        )

    except Exception as exc:
        print(f"Upload URL error: {exc}")
        return response(500, {"error": "Failed to generate upload URL."})


def extract_pdf(data):
    from pypdf import PdfReader

    reader = PdfReader(io.BytesIO(data))
    return "\n".join(
        page.extract_text() or ""
        for page in reader.pages
    )


def extract_docx(data):
    from docx import Document

    doc = Document(io.BytesIO(data))
    return "\n".join(p.text for p in doc.paragraphs)


def extract_text(key, data, content_type):
    ext = os.path.splitext(key.lower())[1]

    if content_type == "application/pdf" or ext == ".pdf":
        return extract_pdf(data)

    if ext == ".docx":
        return extract_docx(data)

    return data.decode("utf-8", errors="ignore")


def metadata(text, filename):
    email = re.search(
        r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}",
        text,
    )

    phone = re.search(
        r"(?:\+?\d[\d\s().-]{7,}\d)",
        text,
    )

    skills_catalog = [
        "Python", "Java", "JavaScript", "TypeScript", "React",
        "Node.js", "AWS", "Azure", "Docker", "Kubernetes", "SQL",
        "MongoDB", "Git", "C", "C++", "Machine Learning",
        "TensorFlow", "PyTorch", "Figma",
    ]

    low = text.lower()
    skills = [
        skill for skill in skills_catalog
        if skill.lower() in low
    ]

    lines = [
        line.strip()
        for line in text.splitlines()
        if line.strip()
    ]

    guessed_name = ""

    if lines and not re.search(
        r"@|resume|curriculum|cv",
        lines[0],
        re.I,
    ):
        guessed_name = lines[0][:100]

    return {
        "name": guessed_name,
        "email": email.group(0) if email else "",
        "phone": phone.group(0) if phone else "",
        "skills": skills,
        "wordCount": len(re.findall(r"\b\w+\b", text)),
        "characterCount": len(text),
        "fileName": filename,
    }


def process_s3(event, _context):
    for record in event.get("Records", []):
        bucket = record["s3"]["bucket"]["name"]
        key = unquote_plus(record["s3"]["object"]["key"])

        if not key.startswith("uploads/"):
            continue

        obj = s3.get_object(Bucket=bucket, Key=key)
        data = obj["Body"].read()

        if len(data) > MAX_BYTES:
            raise ValueError("File exceeds 10 MB limit")

        content_type = obj.get("ContentType", "")
        filename = key.rsplit("/", 1)[-1].split("-", 1)[-1]
        document_id = key.split("/", 1)[1].split("-", 1)[0]

        text_value = extract_text(key, data, content_type)
        meta = metadata(text_value, filename)
        now = datetime.now(timezone.utc).isoformat()

        table.put_item(
            Item={
                "documentId": document_id,
                "status": "PROCESSED",
                "s3Key": key,
                "contentType": content_type,
                "createdAt": now,
                "processedAt": now,
                "text": text_value[:400000],
                "metadata": meta,
                "fileName": filename,
            }
        )

    return {"statusCode": 200}


def search(event, _context):
    q = (
        (event.get("queryStringParameters") or {})
        .get("q") or ""
    ).strip().lower()

    scan_kwargs = {
        "FilterExpression": "#s = :p",
        "ExpressionAttributeNames": {"#s": "status"},
        "ExpressionAttributeValues": {":p": "PROCESSED"},
    }

    items = []

    while True:
        result = table.scan(**scan_kwargs)
        items.extend(result.get("Items", []))

        if "LastEvaluatedKey" not in result:
            break

        scan_kwargs["ExclusiveStartKey"] = result["LastEvaluatedKey"]

    if q:
        items = [
            item for item in items
            if q in json.dumps(item, default=str).lower()
        ]

    items.sort(
        key=lambda item: item.get("processedAt", ""),
        reverse=True,
    )

    for item in items:
        item.pop("text", None)

    return response(
        200,
        {
            "count": len(items),
            "documents": items[:100],
        },
    )


def handler(event, context):
    path = event.get("rawPath") or event.get("path") or ""

    method = (
        event.get("requestContext", {})
        .get("http", {})
        .get("method")
        or event.get("httpMethod", "")
    )

    if method == "POST" and path.endswith("/upload-url"):
        return upload_url(event, context)

    if method == "GET" and path.endswith("/documents"):
        return search(event, context)

    return response(404, {"error": "Not found"})

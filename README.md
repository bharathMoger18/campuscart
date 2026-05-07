# CampusCart 🛒

A full-stack e-commerce web application built for campus communities — containerized with Docker, deployed on AWS, and delivered through an automated GitHub Actions CI/CD pipeline.

---

## Architecture Overview

```
Internet
    ↓
Elastic IP (static)
    ↓
AWS VPC (10.0.0.0/16) — ap-south-1
Public/Private Subnets across 2 Availability Zones
    ↓
Security Group (ports 80, 443, 22)
    ↓
EC2 t2.micro (Ubuntu 22.04)
IAM Role → AWS SSM Parameter Store (18 secrets)
    ↓
Docker Compose
┌─────────────────────────────────┐
│  nginx:80  ← reverse proxy      │
│       ↓                         │
│  web:8000  ← Django/Daphne      │
│       ↓            ↓            │
│  db:5432       redis:6379       │
└─────────────────────────────────┘
    ↑
GitHub Actions CI/CD
(push to main → build → ECR → deploy)
```

---

## Tech Stack

| Layer | Technology |
|---|---|
| Backend | Django 5.2, Django REST Framework |
| ASGI Server | Daphne |
| Real-time | Django Channels, Redis |
| Database | PostgreSQL |
| Payments | Stripe |
| Auth | JWT (SimpleJWT) |
| Push Notifications | VAPID |
| Frontend | HTML, CSS, JavaScript |
| Containerization | Docker, Docker Compose |
| Cloud | AWS (EC2, VPC, IAM, SSM, ECR) |
| CI/CD | GitHub Actions |
| Reverse Proxy | Nginx |
| Secrets | AWS SSM Parameter Store |

---

## Features

- JWT Authentication (register, login, email verification, password reset)
- Product listings with search, filters, and pagination
- Cart and wishlist management
- Order creation and tracking
- Stripe payment integration with webhooks
- Real-time chat using WebSockets (Django Channels)
- Browser push notifications (VAPID)
- Product reviews and ratings
- Seller dashboard

---

## Project Structure

```
campuscart/
├── .github/
│   └── workflows/
│       └── deploy.yml          ← GitHub Actions CI/CD pipeline
├── aws/
│   ├── vpc-network.sh          ← VPC, subnets, IGW, route tables, key pair
│   ├── ec2-launch.sh           ← EC2 instance + Elastic IP
│   ├── security-setup.sh       ← IAM, Security Group, ECR, SSM parameters
│   └── ssm-params-template.txt ← SSM parameter checklist
├── scripts/
│   ├── provision.sh            ← One-time EC2 server setup
│   └── deploy.sh               ← Zero-intervention deployment script
├── campuscart-backend/
│   ├── Dockerfile
│   ├── entrypoint.sh
│   ├── campuscart/             ← Django project (settings, urls, asgi)
│   ├── users/
│   ├── products/
│   ├── cart/
│   ├── orders/
│   ├── payments/
│   ├── chat/
│   ├── push/
│   ├── reviews/
│   └── wishlist/
├── nginx/
│   ├── Dockerfile
│   └── nginx.conf
├── frontend/                   ← HTML/CSS/JS
├── docker-compose.yml          ← Local development
├── docker-compose.prod.yml     ← Production override (ECR image)
└── infrastructure.md           ← AWS resource documentation
```

---

## Running Locally with Docker

The entire application runs with one command:

```bash
# Clone the repository
git clone https://github.com/bharathMoger18/campuscart.git
cd campuscart

# Create .env from example
cp campuscart-backend/.env.example campuscart-backend/.env
# Edit .env with your values

# Start all 4 containers
docker compose up --build

# Visit http://localhost
```

**What runs:**
- `nginx` — reverse proxy on port 80
- `web` — Django/Daphne on port 8000 (internal)
- `db` — PostgreSQL on port 5432 (internal)
- `redis` — Redis on port 6379 (internal)

Only port 80 is exposed. All other ports are internal to the Docker network.

---

## AWS Deployment

All infrastructure is defined as code in the `aws/` directory.

### Prerequisites

- AWS CLI configured (`aws configure`)
- Region: `ap-south-1`
- Verify: `aws sts get-caller-identity`

### Execution Order

```bash
# Step 1 — Network infrastructure
chmod +x aws/vpc-network.sh
./aws/vpc-network.sh
# Creates: VPC, 4 subnets (2 AZs), IGW, route tables, SSH key pair

# Step 2 — Security, IAM, SSM
chmod +x aws/security-setup.sh
./aws/security-setup.sh
# Creates: Security Group, IAM Role, Instance Profile, ECR repo, 18 SSM params
# SAVE the GitHub Actions IAM credentials printed at end — shown once only

# Step 3 — EC2 + Elastic IP
chmod +x aws/ec2-launch.sh
./aws/ec2-launch.sh
# Creates: EC2 t2.micro, Elastic IP
# Note the Elastic IP from output

# Step 4 — Update SSM with real values
# See aws/ssm-params-template.txt for the complete list
aws ssm put-parameter \
    --name "/campuscart/ALLOWED_HOSTS" \
    --value "YOUR_ELASTIC_IP,localhost,127.0.0.1" \
    --type "String" --overwrite --region ap-south-1
# Update all other CHANGE_ME parameters

# Step 5 — Provision the server (run once)
scp -i ~/campuscart-key.pem scripts/provision.sh ubuntu@YOUR_ELASTIC_IP:/home/ubuntu/
ssh -i ~/campuscart-key.pem ubuntu@YOUR_ELASTIC_IP \
    "chmod +x provision.sh && ./provision.sh"

# Step 6 — Verify
curl -I http://YOUR_ELASTIC_IP
curl http://YOUR_ELASTIC_IP/api/v1/products/
```

### AWS Resources Created

| Resource | Details |
|---|---|
| VPC | 10.0.0.0/16 |
| Public Subnets | 10.0.1.0/24 (ap-south-1a), 10.0.2.0/24 (ap-south-1b) |
| Private Subnets | 10.0.3.0/24 (ap-south-1a), 10.0.4.0/24 (ap-south-1b) |
| EC2 | t2.micro, Ubuntu 22.04 LTS |
| IAM Role | Least privilege — SSM read + ECR pull only |
| SSM Parameters | 18 secrets under /campuscart/* |
| ECR Repository | campuscart-web |

---

## CI/CD Pipeline

Every push to `main` triggers the GitHub Actions pipeline automatically.

```
git push origin main
        ↓
Job 1 — Build and Push (~3 min)
  checkout → AWS credentials → ECR login
  → docker build → push to ECR with git SHA tag

        ↓ (only if Job 1 succeeds)

Job 2 — Deploy (~1 min)
  SSH into EC2 → git pull → deploy.sh <git-sha>
  → ECR pull → docker compose up → health check
```

**Total time:** ~4 minutes from push to live. Zero manual steps.

### Required GitHub Secrets

| Secret | Description |
|---|---|
| `AWS_ACCESS_KEY_ID` | From security-setup.sh output |
| `AWS_SECRET_ACCESS_KEY` | From security-setup.sh output (shown once) |
| `AWS_REGION` | `ap-south-1` |
| `ECR_REPO_NAME` | `campuscart-web` |
| `EC2_HOST` | Elastic IP from ec2-launch.sh |
| `EC2_SSH_KEY` | Full content of `~/campuscart-key.pem` |

See `docs/github-secrets-setup.md` for complete setup instructions.

---

## Secrets Management

All application secrets are stored in AWS SSM Parameter Store under `/campuscart/*`. Zero secrets are hardcoded in the codebase or Docker images.

The `provision.sh` script fetches all 18 parameters in a single API call at server setup time:

```bash
aws ssm get-parameters-by-path \
    --path /campuscart/ \
    --with-decryption \
    --recursive \
    --region ap-south-1
```

Sensitive parameters (passwords, API keys, private keys) use `SecureString` type — encrypted at rest using AWS KMS.

---

## Teardown

Tear down all AWS resources immediately after verification to avoid charges:

```bash
# See infrastructure.md for the complete teardown commands
# Correct order: EIP → EC2 → SG → IGW → Subnets → Route Tables → VPC → ECR → SSM → IAM
```

Follow the exact order in `infrastructure.md`. AWS will reject deletion of resources that still have dependencies.

---

## Documentation

All teaching documents are in the `docs/` directory:

| File | Contents |
|---|---|
| `aws-concepts.html` | AWS infrastructure concepts (VPC, subnets, EC2, etc.) |
| `aws-interview-qa.html` | 20 AWS interview Q&As with CampusCart context |
| `security-concepts.html` | IAM, Security Groups, SSM, KMS concepts |
| `provisioning-concepts.html` | Docker, Bash scripting, server provisioning |
| `cicd-concepts.html` | GitHub Actions, CI/CD concepts |
| `github-secrets-setup.md` | Step-by-step GitHub Secrets setup guide |

---

## Local Development (without Docker)

```bash
cd campuscart-backend

# Create and activate virtual environment
python3 -m venv venv
source venv/bin/activate

# Install dependencies
pip install -r requirements.txt

# Setup environment variables
cp .env.example .env
# Edit .env with your values

# Run migrations
python manage.py migrate

# Collect static files
python manage.py collectstatic

# Start Redis (required for WebSockets)
redis-server

# Start Daphne
daphne -b 0.0.0.0 -p 8000 campuscart.asgi:application
```

---

## License

MIT

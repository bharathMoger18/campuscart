# GitHub Secrets Setup Guide
## CampusCart — Soldier 6 Pre-Flight Checklist

> **Who this document is for:** Soldier 6.
> Before you run a single AWS script, read this entire document.
> Before you trigger the GitHub Actions pipeline, complete every step in this document.
> The pipeline will fail with authentication errors if any secret is missing or wrong.

---

## Overview

GitHub Actions workflows cannot hardcode credentials — that would expose them publicly in the repository. Instead, the `deploy.yml` workflow reads 6 secrets from GitHub's encrypted secret store at runtime. These secrets must exist **before** the first push to main triggers the pipeline.

Some secrets (AWS credentials, ECR repo name) are available immediately. Others (EC2 host IP, SSH key) are only available after you run the AWS provisioning scripts.

**Follow this order:**
1. Run all AWS scripts (Soldiers 2 + 3 + 6)
2. Collect the values listed in this document
3. Create all 6 secrets in GitHub
4. Push to main (or use workflow_dispatch) to trigger the pipeline

---

## The 6 Required Secrets

### Secret 1 — `AWS_ACCESS_KEY_ID`

| Field | Value |
|-------|-------|
| **Secret name** | `AWS_ACCESS_KEY_ID` |
| **What it is** | The access key ID for the `campuscart-github-actions` IAM user |
| **Format** | `AKIAIOSFODNN7EXAMPLE` — starts with `AKIA`, 20 characters |
| **Where to get it** | Printed to terminal when Soldier 3's `aws/security-setup.sh` runs. Look for the line: `Access Key ID: AKIA...` |
| **When available** | After running `security-setup.sh` |

---

### Secret 2 — `AWS_SECRET_ACCESS_KEY`

| Field | Value |
|-------|-------|
| **Secret name** | `AWS_SECRET_ACCESS_KEY` |
| **What it is** | The secret access key for the `campuscart-github-actions` IAM user |
| **Format** | 40-character alphanumeric string: `wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY` |
| **Where to get it** | Printed to terminal when Soldier 3's `aws/security-setup.sh` runs. Look for the line: `Secret Access Key: ...` |
| **When available** | After running `security-setup.sh` |

> ⚠️ **CRITICAL:** The secret access key is shown **exactly once** when the IAM user is created. If you miss it, you must rotate the key in IAM and update this secret. Copy it immediately when it appears. Store it somewhere safe (password manager) before entering it into GitHub.

---

### Secret 3 — `AWS_REGION`

| Field | Value |
|-------|-------|
| **Secret name** | `AWS_REGION` |
| **What it is** | The AWS region where all CampusCart resources live |
| **Value** | `ap-south-1` |
| **Where to get it** | Fixed value — Mumbai region. All resources (EC2, ECR, SSM, VPC) are in ap-south-1 |
| **When available** | Immediately — no scripts needed |

---

### Secret 4 — `ECR_REPO_NAME`

| Field | Value |
|-------|-------|
| **Secret name** | `ECR_REPO_NAME` |
| **What it is** | The name of the ECR repository where Docker images are pushed |
| **Value** | `campuscart-web` |
| **Where to get it** | Fixed value — the ECR repository created by Soldier 3's `security-setup.sh`. Verify: `aws ecr describe-repositories --region ap-south-1` |
| **When available** | After running `security-setup.sh` (to confirm it exists), but the value is already known |

---

### Secret 5 — `EC2_HOST`

| Field | Value |
|-------|-------|
| **Secret name** | `EC2_HOST` |
| **What it is** | The Elastic IP address of the production EC2 instance |
| **Format** | IPv4 address: `13.234.56.78` (example — yours will differ) |
| **Where to get it** | Printed when Soldier 2's `aws/ec2-launch.sh` runs. Also retrievable with: `aws ec2 describe-addresses --region ap-south-1 --query 'Addresses[0].PublicIp' --output text` |
| **When available** | After running `ec2-launch.sh` |

> ⚠️ **IMPORTANT:** Use the **Elastic IP** — not the EC2's public IPv4 DNS hostname and not the private IP.
> - Elastic IP is static: it does NOT change when the EC2 is rebooted.
> - The public IPv4 DNS (e.g., `ec2-13-234-56-78.ap-south-1.compute.amazonaws.com`) also works, but changes if the instance is stopped/started.
> - The private IP (10.x.x.x) is not reachable from GitHub Actions' runners — it's inside the VPC.

---

### Secret 6 — `EC2_SSH_KEY`

| Field | Value |
|-------|-------|
| **Secret name** | `EC2_SSH_KEY` |
| **What it is** | The **full text content** of the private key PEM file for the `campuscart-key` key pair |
| **Format** | Multi-line text starting with `-----BEGIN RSA PRIVATE KEY-----` |
| **Where to get it** | The file `~/campuscart-key.pem` on your local machine. This was downloaded when Soldier 2's `vpc-network.sh` created the key pair. |
| **When available** | After running `vpc-network.sh` |

> ⚠️ **CRITICAL — Read carefully:**
>
> The secret value must be the **full file content**, not the file path.
>
> **Correct value (what to paste):**
> ```
> -----BEGIN RSA PRIVATE KEY-----
> MIIEowIBAAKCAQEA3mGgGrxnzf7pYnxPZ2... (many lines)
> ...more base64 content...
> -----END RSA PRIVATE KEY-----
> ```
>
> **Wrong — do NOT do this:**
> ```
> ~/campuscart-key.pem           ← this is a path, not the key
> campuscart-key.pem             ← this is a filename, not the key
> ```
>
> **How to get the content correctly:**
> ```bash
> # On your local machine where the .pem file is stored:
> cat ~/campuscart-key.pem
> # Copy everything the command prints — including the header and footer lines
> ```
> Then paste that copied text as the secret value in GitHub.

---

## Step-by-Step: Adding Secrets in GitHub UI

### Navigation

```
GitHub → Your Repository → Settings tab
→ Secrets and variables (left sidebar)
→ Actions
→ Repository secrets section
→ "New repository secret" button
```

Direct URL (replace `bharathMoger18/campuscart` with your repo):
```
https://github.com/bharathMoger18/campuscart/settings/secrets/actions
```

### Adding Each Secret

For **each** of the 6 secrets above:

1. Click **"New repository secret"**
2. Enter the **Name** exactly as shown (case-sensitive: `AWS_ACCESS_KEY_ID`, not `aws_access_key_id`)
3. Paste the **Value**
4. Click **"Add secret"**

The secret will appear in the list with a masked value. You can update a secret later but cannot view it again.

---

## Verification Checklist

After adding all 6 secrets, verify the list shows exactly these names:

```
✅ AWS_ACCESS_KEY_ID
✅ AWS_SECRET_ACCESS_KEY
✅ AWS_REGION
✅ ECR_REPO_NAME
✅ EC2_HOST
✅ EC2_SSH_KEY
```

If any are missing, the pipeline will fail with an authentication or connection error at the corresponding step.

---

## Triggering the First Pipeline Run

After all 6 secrets are set, you have two options:

### Option A — Push a commit (normal flow)

```bash
# Make any small change (e.g., add a blank line to README)
echo "" >> README.md
git add README.md
git commit -m "chore: trigger first CI/CD pipeline run"
git push origin main
```

### Option B — Manual trigger (no code change needed)

1. Go to: `https://github.com/bharathMoger18/campuscart/actions`
2. Click **"Deploy CampusCart"** in the left sidebar (the workflow name)
3. Click **"Run workflow"** dropdown (top right of the workflow runs list)
4. Select branch: `main`
5. Click **"Run workflow"** button

---

## Watching the Pipeline Run

1. Go to the **Actions** tab in GitHub
2. Click the running workflow (yellow spinner = in progress)
3. You'll see two jobs: **Build and Push to ECR** and **Deploy to EC2**
4. Click any job to expand its steps and see live logs

**Expected timeline:**
- Job 1 (Build and Push): ~3–4 minutes
- Job 2 (Deploy to EC2): ~1–2 minutes
- Total: ~4–5 minutes from push to live

**Success:** Both jobs show green checkmarks ✅

**Failure:** One job shows red ✗. Click it to see the logs. Common first-run failures:
- `Could not connect to ECR` → AWS credentials incorrect (check secrets 1 & 2)
- `Repository does not exist` → ECR repo name wrong (check secret 4)
- `Permission denied (publickey)` → SSH key wrong or malformed (check secret 6)
- `Connection timed out` → EC2 host wrong or port 22 blocked (check secret 5 and security group)

---

## Secret Rotation

If you need to rotate any secret (e.g., the IAM access key was compromised):

1. Create the new credential first (new IAM access key, new EC2 key pair, etc.)
2. Go to the GitHub Secrets page
3. Click the secret name → **"Update"**
4. Paste the new value
5. Click **"Save changes"**
6. Trigger a new workflow run to verify the new credential works
7. Delete the old credential from AWS IAM / EC2 key pairs

Never delete the GitHub Secret before you have the new value ready.

---

## After the Pipeline Works — Soldier 6 Complete

Once you see a successful pipeline run with green checkmarks, verify the application is live:

```bash
# From your local machine:
curl -I http://<EC2_HOST>
# Expected: HTTP/1.1 200 OK (or 301/302 redirect)
```

Or simply open `http://<EC2_HOST>` in a browser.

At this point, every future `git push origin main` will automatically build, push, and deploy CampusCart without any manual intervention.

---

*Soldier 5 — CI/CD Pipeline — GitHub Actions deploy.yml*
*Part of the CampusCart DevOps Portfolio — 5 of 6 soldiers complete*

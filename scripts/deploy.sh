#!/usr/bin/env bash
# ==============================================================================
# CampusCart — scripts/deploy.sh
# ==============================================================================
# PURPOSE:
#   Runs on EVERY deployment. Called by GitHub Actions (Soldier 5) after a new
#   Docker image has been built and pushed to ECR. This script pulls the new
#   image and restarts the application with zero manual intervention.
#
# USAGE:
#   ./scripts/deploy.sh <image-tag>
#   Example: ./scripts/deploy.sh a3f1c9d2e8b4567890abcdef1234567890abcdef
#
# CALLED BY GITHUB ACTIONS AS:
#   ssh -i campuscart-key.pem ubuntu@ELASTIC_IP \
#     "cd /app/campuscart && ./scripts/deploy.sh ${{ github.sha }}"
#
# WHAT THIS SCRIPT DOES (in order):
#   1. Validates the image tag argument is provided
#   2. Constructs the full ECR image URI from account ID + region + tag
#   3. Authenticates Docker with ECR (fresh 12-hour token on every deploy)
#   4. Pulls the new image from ECR (while old container keeps serving traffic)
#   5. Exports WEB_IMAGE so docker-compose.prod.yml can read it
#   6. Runs docker compose with both base + prod override files (--no-build)
#   7. Polls container health for up to 150 seconds
#   8. Exits 0 on success (GitHub Actions marks deployment green)
#      Exits 1 on failure with logs (GitHub Actions marks deployment red)
#
# DOES NOT:
#   - Build any Docker image (--no-build is mandatory)
#   - Modify any files on disk (no .env changes, no file edits)
#   - Require any manual SSH or intervention
#
# INTERVIEW EXPLANATION:
#   "After GitHub Actions pushes a new image to ECR, it SSHes into the EC2
#    and calls deploy.sh with the git commit SHA as the image tag. The script
#    authenticates with ECR using the EC2's IAM role, pulls the new image —
#    while the old container is still running and serving traffic — then runs
#    docker compose with the production override file to restart only the web
#    service with the new image. It polls for health and exits with the right
#    code so GitHub Actions knows if the deployment succeeded or failed.
#    Zero manual intervention from git push to live production."
#
# TIMING:
#   ECR pull:         30–60 seconds (only changed layers downloaded)
#   Container restart: 2–5 seconds  (brief downtime window)
#   Health poll:      5–30 seconds  (until container is healthy)
#   Total:            ~2 minutes end to end
# ==============================================================================

# ── STRICT MODE ────────────────────────────────────────────────────────────────
# -e : Exit immediately on any command failure.
#      Critical for a deployment script — if the ECR pull fails, we must NOT
#      proceed to restart the containers with a non-existent image.
# -u : Treat unset variables as errors.
#      Prevents silent bugs — e.g., if IMAGE_TAG is empty, we'd pull ":latest"
#      instead of a specific version. With -u, that's a hard error.
# -o pipefail : Pipeline fails if any command in it fails.
#      The ECR login uses a pipe: "get-login-password | docker login".
#      With pipefail, if get-login-password fails, the whole pipe fails.
set -euo pipefail

# ── CONSTANTS ──────────────────────────────────────────────────────────────────
readonly REGION="ap-south-1"
# AWS region where ECR and all CampusCart resources live.

readonly ECR_REPO="campuscart-web"
# The ECR repository name. Created by Soldier 3's security-setup.sh.
# Full repo path: ACCOUNT_ID.dkr.ecr.ap-south-1.amazonaws.com/campuscart-web

readonly APP_DIR="/app/campuscart"
# Application directory where docker-compose.yml lives.
# provision.sh cloned the repository here.

readonly HEALTH_CHECK_ATTEMPTS=30
# How many times to poll for container health before giving up.
# 30 attempts × 5 seconds = 150 seconds maximum wait time.

readonly HEALTH_CHECK_SLEEP=5
# Seconds to wait between each health check attempt.

# ── LOGGING HELPERS ────────────────────────────────────────────────────────────
# Consistent, timestamped output. Every line has a prefix so you can grep
# deploy logs easily: grep "\[DEPLOY\]" /var/log/syslog
readonly LOG_PREFIX="[DEPLOY]"

log()     { echo "${LOG_PREFIX} $(date '+%H:%M:%S') INFO  → $*"; }
success() { echo "${LOG_PREFIX} $(date '+%H:%M:%S') OK    → $*"; }
warn()    { echo "${LOG_PREFIX} $(date '+%H:%M:%S') WARN  → $*" >&2; }
fail()    { echo "${LOG_PREFIX} $(date '+%H:%M:%S') ERROR → $*" >&2; exit 1; }

section() {
  echo ""
  echo "──────────────────────────────────────────────────────────────"
  echo "  $*"
  echo "──────────────────────────────────────────────────────────────"
}

# ==============================================================================
# STEP 1 — VALIDATE ARGUMENT
# ==============================================================================
# The image tag is the git commit SHA from GitHub Actions.
# Example: "a3f1c9d2e8b4567890abcdef1234567890abcdef"
#
# WHY we require an explicit image tag (not "latest"):
#   Using "latest" is a common anti-pattern in production deployments.
#   Problems with "latest":
#   1. Not reproducible — "latest" points to a different image every push.
#      If you need to roll back, "latest" might already point to the broken image.
#   2. Not auditable — you can't tell which code version is running just from
#      the tag name.
#   3. Docker may not re-pull "latest" if it's already cached, even if ECR has
#      a newer version. A specific SHA always triggers a pull.
#
#   With a commit SHA as the tag:
#   - Every deployment is traceable to an exact git commit
#   - Rollback = call deploy.sh with the previous commit's SHA
#   - "docker inspect" on the running container shows exactly which commit is live
#
# THE :? OPERATOR:
#   "${1:?message}" — bash parameter expansion.
#   If $1 is unset OR empty, bash immediately exits with the error message.
#   This is a clean, one-line guard. The alternative (if [ -z "$1" ]; then fail)
#   is more verbose. :? is idiomatic bash for "this argument is required."

section "STEP 1: Validating deployment arguments"

IMAGE_TAG="${1:?ERROR: Image tag is required. Usage: ./deploy.sh <image-tag>}"
# $1 = first command-line argument = the git commit SHA passed by GitHub Actions
# If GitHub Actions calls this script without an argument, the script exits here
# with a clear error message. This prevents a silent bad deployment.

log "Image tag received: ${IMAGE_TAG}"

# Basic validation: image tag should not be empty or suspiciously short
if [ "${#IMAGE_TAG}" -lt 7 ]; then
  fail "Image tag '${IMAGE_TAG}' looks invalid. Expected a git commit SHA (7+ characters)."
fi
# ${#IMAGE_TAG} = length of the IMAGE_TAG string.
# Full SHA is 40 chars. GitHub Actions short SHA is 7+ chars.
# A tag shorter than 7 chars is almost certainly a mistake.

log "Image tag validation passed ✓ (length: ${#IMAGE_TAG} chars)"

# ==============================================================================
# STEP 2 — CONSTRUCT ECR IMAGE URI
# ==============================================================================
# The full ECR image URI format is:
#   ACCOUNT_ID.dkr.ecr.REGION.amazonaws.com/REPO_NAME:TAG
#
# We fetch the Account ID dynamically using "aws sts get-caller-identity"
# instead of hardcoding it. Why?
#   - If this codebase is ever used in a different AWS account (staging, etc.),
#     the script works without modification.
#   - It's self-documenting — the script tells you exactly which account it's
#     deploying to, which is useful in logs.
#   - Hardcoded IDs are a maintenance burden and a minor security concern.
#
# aws sts get-caller-identity:
#   STS = Security Token Service.
#   get-caller-identity returns information about the IAM identity making the call.
#   On EC2 with an IAM role, this returns the role's assumed identity.
#   --query Account: JMESPath query to extract just the Account ID field.
#   --output text: Return as plain text (no JSON quotes around the number).

section "STEP 2: Constructing ECR image URI"

log "Fetching AWS Account ID from STS (using EC2 IAM role)..."
ACCOUNT_ID=$(aws sts get-caller-identity \
  --query Account \
  --output text \
  --region "${REGION}")

if [ -z "${ACCOUNT_ID}" ]; then
  fail "Could not fetch AWS Account ID. Check IAM Instance Profile is attached."
fi

log "AWS Account ID: ${ACCOUNT_ID}"

# Construct the full ECR registry URL
ECR_REGISTRY="${ACCOUNT_ID}.dkr.ecr.${REGION}.amazonaws.com"
# Example: 021859068764.dkr.ecr.ap-south-1.amazonaws.com

# Construct the full image URI with the specific tag
ECR_IMAGE_URI="${ECR_REGISTRY}/${ECR_REPO}:${IMAGE_TAG}"
# Example: 021859068764.dkr.ecr.ap-south-1.amazonaws.com/campuscart-web:a3f1c9d

log "ECR Registry:  ${ECR_REGISTRY}"
log "ECR Image URI: ${ECR_IMAGE_URI}"

# ==============================================================================
# STEP 3 — AUTHENTICATE WITH ECR
# ==============================================================================
# ECR is a private Docker registry. Every docker pull requires authentication.
# We re-authenticate on every deployment run — this ensures we always have a
# fresh token and never hit a "token expired" error mid-deployment.
#
# HOW ECR AUTH WORKS:
#   1. "aws ecr get-login-password" calls the ECR API using the EC2's IAM role
#      credentials (from the Instance Metadata Service — no aws configure needed).
#      ECR validates the IAM identity and returns a temporary password — a
#      base64-encoded auth token valid for 12 hours.
#   2. This token is piped to "docker login --username AWS --password-stdin URL"
#      Docker stores the token in ~/.docker/config.json.
#   3. All subsequent docker pull/push to this registry use the stored token.
#
# WHY --password-stdin (not --password TOKEN):
#   Passing the password on the command line exposes it in:
#   - "ps aux" output (all users on the system can see it)
#   - Shell history (~/.bash_history)
#   - System logs that capture process arguments
#   With --password-stdin, the token flows through stdin in memory only.
#   It's never written to disk or visible in process listings.
#
# WHY username is literally "AWS":
#   This is how ECR's token-based auth protocol works. The username is always
#   the string "AWS" regardless of which IAM identity you're authenticating as.
#   The identity is encoded in the token itself, not in the username.

section "STEP 3: Authenticating Docker with ECR"

log "Getting ECR auth token via IAM Instance Profile..."
log "Piping token directly to docker login (never stored in a variable or file)..."

aws ecr get-login-password --region "${REGION}" | \
  docker login \
    --username AWS \
    --password-stdin \
    "${ECR_REGISTRY}"
# If this fails (no ECR permission, wrong region, no IAM role), the pipeline
# fails here and the script exits. We never proceed to pull a non-existent image.

success "Docker authenticated with ECR ✓"

# ==============================================================================
# STEP 4 — PULL THE NEW IMAGE
# ==============================================================================
# We pull the new image BEFORE stopping the old container.
# This is the key to near-zero-downtime deployment:
#
# TIMELINE:
#   T+0s:   deploy.sh starts. Old container running, serving traffic.
#   T+0s:   docker pull starts. Old container STILL running, serving traffic.
#   T+60s:  docker pull completes. Old container STILL running, serving traffic.
#   T+60s:  docker compose up starts. Old container stops, new one starts.
#   T+63s:  New container running and healthy. Traffic resumes.
#
# If we stopped the old container FIRST and then pulled, there would be a
# 60-second window with no running container — completely unavailable.
# By pulling first, the downtime window is just the 2-5 second container
# restart, not the entire image download time.
#
# WHY --no-pull is NOT used here:
#   We explicitly pull before compose up to ensure the image is in the local
#   cache. If we let compose up pull it, the timing is less predictable.
#   Pre-pulling is an explicit, observable step in the deployment log.
#
# docker pull only downloads changed layers:
#   Docker images are made of layers. If 8 of 10 layers are the same as the
#   previous deployment (base Python image, system packages), only the 2 changed
#   layers (your code, pip packages) are downloaded. This is why pulls are fast
#   even for large images.

section "STEP 4: Pulling new image from ECR"

log "Pulling image: ${ECR_IMAGE_URI}"
log "Note: Only changed layers are downloaded (Docker layer cache)"

docker pull "${ECR_IMAGE_URI}"
# If the image tag doesn't exist in ECR (GitHub Actions failed to push it),
# docker pull fails here and the script exits. The old container keeps running.
# This is correct behavior — fail fast, don't break production with a bad deploy.

success "Image pulled successfully ✓"

# Show the image size to confirm what was downloaded
IMAGE_SIZE=$(docker image inspect "${ECR_IMAGE_URI}" \
  --format '{{.Size}}' 2>/dev/null | \
  awk '{printf "%.1f MB", $1/1024/1024}' || echo "unknown")
log "Image size: ${IMAGE_SIZE}"

# ==============================================================================
# STEP 5 — SET WEB_IMAGE ENVIRONMENT VARIABLE
# ==============================================================================
# docker-compose.prod.yml references ${WEB_IMAGE} for the web service's image.
# We export it here so Docker Compose can read it from the shell environment.
#
# HOW DOCKER COMPOSE READS ENVIRONMENT VARIABLES:
#   When docker compose runs, it reads the calling shell's environment for
#   variable substitution in compose files. Any ${VAR} in a compose file is
#   replaced with the value of VAR from the shell environment.
#
# WHY export (not just assign):
#   "export WEB_IMAGE=..." makes the variable available to child processes.
#   Docker Compose is a child process of this script. Without export, the
#   variable is only in the current shell's scope and docker compose can't see it.
#   "WEB_IMAGE=value docker compose ..." would also work (inline env var),
#   but export is cleaner for readability.
#
# WHAT DOCKER-COMPOSE.PROD.YML DOES WITH IT:
#   services:
#     web:
#       build: !reset {}      <- removes build directive from base file
#       image: ${WEB_IMAGE}   <- uses this exported variable
#   This tells Docker Compose: don't build from source, use this ECR image.

section "STEP 5: Setting WEB_IMAGE for Docker Compose"

export WEB_IMAGE="${ECR_IMAGE_URI}"
# Export makes it visible to docker compose (a child process of this script).

log "WEB_IMAGE exported: ${WEB_IMAGE}"

# Verify docker-compose.prod.yml exists — if it's missing, we'd silently
# deploy without the override and might try to build from source.
if [ ! -f "${APP_DIR}/docker-compose.prod.yml" ]; then
  fail "docker-compose.prod.yml not found at ${APP_DIR}/docker-compose.prod.yml"
fi
log "docker-compose.prod.yml found ✓"

# Verify docker-compose.yml (base file) also exists
if [ ! -f "${APP_DIR}/docker-compose.yml" ]; then
  fail "docker-compose.yml not found at ${APP_DIR}/docker-compose.yml"
fi
log "docker-compose.yml found ✓"

# ==============================================================================
# STEP 6 — RESTART APPLICATION WITH NEW IMAGE
# ==============================================================================
# This is the actual deployment step. We use two compose files:
#   -f docker-compose.yml         : Base file (nginx, web, db, redis config)
#   -f docker-compose.prod.yml    : Production override (web uses ECR image)
#
# HOW DOCKER COMPOSE MERGES THE TWO FILES:
#   Docker Compose reads both files and deep-merges them. The second file's
#   values override the first file's values for any matching keys.
#   For the web service:
#     Base file has:     build: { context: ./campuscart-backend }
#     Override file has: build: !reset {}   ← removes the build key entirely
#                        image: ${WEB_IMAGE} ← adds the image key
#   Result: web service uses ECR image, no build directive.
#   For nginx, db, redis: override file doesn't mention them, so they're
#   untouched — they keep their base file configuration exactly.
#
# WHY --no-build IS CRITICAL:
#   Without --no-build, docker compose checks for a build: directive and
#   rebuilds if found. Even though docker-compose.prod.yml removes it with
#   !reset, --no-build is an absolute safety net. On a t2.micro (1GB RAM),
#   building the Django image means:
#   - pip install 50+ packages (downloads ~200MB)
#   - Compiling C extensions: psycopg2 (PostgreSQL adapter), Pillow (imaging),
#     cryptography (Rust-based)
#   - This takes 5-10 minutes and frequently OOM-kills the build process
#   - Leaves the server in a broken state with no running containers
#   --no-build guarantees this NEVER happens in production. Ever.
#
# WHY "up -d" instead of "restart":
#   "docker compose restart" just restarts the existing containers with the
#   same image — it does NOT pick up a new image. "up -d" detects that the
#   image has changed and recreates the container with the new image.
#   This is a critical distinction — "restart" would appear to succeed but
#   you'd still be running the old code.

section "STEP 6: Deploying new image with Docker Compose"

log "Running docker compose with base + production override files..."
log "Command: docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --no-build"

cd "${APP_DIR}"
# Must cd to APP_DIR so docker compose finds docker-compose.yml and .env
# in the current directory. Docker Compose looks for these files relative
# to where the command is run from.

docker compose \
  -f docker-compose.yml \
  -f docker-compose.prod.yml \
  up -d \
  --no-build \
  --remove-orphans
# up              : Ensure all services are running. Start/recreate changed ones.
# -d              : Detached mode — return immediately, don't stream logs.
# --no-build      : NEVER build from source. Fail if image not found locally.
# --remove-orphans: Remove containers for services not defined in compose files.
#                   Keeps the environment clean if services were renamed/removed.

success "Docker Compose executed successfully ✓"

# ==============================================================================
# STEP 7 — WAIT FOR CONTAINER HEALTH
# ==============================================================================
# "docker compose up -d" returns immediately after starting containers.
# The containers are "running" but not necessarily "ready."
# The Django application goes through these states after container start:
#
#   1. Container starts → entrypoint.sh runs
#   2. entrypoint.sh runs: python manage.py migrate (connects to PostgreSQL)
#   3. manage.py migrate runs all pending migrations
#   4. Daphne ASGI server starts on 0.0.0.0:8000
#   5. Django loads all apps, middleware, URLs
#   6. Health check endpoint (/health/ or /) starts returning 200
#   7. Container status transitions from "starting" → "healthy"
#
# Steps 2-6 can take 10-30 seconds depending on migration count.
# We poll until the container is "healthy" or we time out.
#
# HOW DOCKER HEALTH CHECKS WORK:
#   The docker-compose.yml web service has a healthcheck: block that defines
#   a command to run periodically inside the container (e.g., curl localhost:8000).
#   Docker runs this command every N seconds. If it exits 0, container = healthy.
#   If it fails repeatedly, container = unhealthy.
#   We check docker compose ps output for "healthy" status.
#
# EXIT CODES:
#   0 = deployment successful (GitHub Actions marks job as passed ✅)
#   1 = deployment failed     (GitHub Actions marks job as failed ❌, sends alert)
#   Using the right exit codes is what makes GitHub Actions CI/CD work correctly.

section "STEP 7: Waiting for application to become healthy"

log "Polling container health (max ${HEALTH_CHECK_ATTEMPTS} attempts, ${HEALTH_CHECK_SLEEP}s intervals)..."
log "Maximum wait time: $((HEALTH_CHECK_ATTEMPTS * HEALTH_CHECK_SLEEP)) seconds"

HEALTHY=false

for i in $(seq 1 "${HEALTH_CHECK_ATTEMPTS}"); do
  # Get the status of the web container specifically
  # docker compose ps --format json gives us structured output
  # We check for the word "healthy" in the web service status
  WEB_STATUS=$(docker compose ps web --format json 2>/dev/null | \
    python3 -c "
import sys, json
try:
    data = json.load(sys.stdin)
    # Handle both single object and array responses
    if isinstance(data, list):
        print(data[0].get('Health', data[0].get('State', 'unknown')))
    else:
        print(data.get('Health', data.get('State', 'unknown')))
except:
    print('unknown')
" 2>/dev/null || echo "unknown")
  # python3 -c: inline Python to parse the JSON output from docker compose ps.
  # We use Python for JSON parsing because bash has no native JSON support.
  # The Health field shows: "healthy", "unhealthy", "starting", or empty string.
  # The State field shows: "running", "exited", "created".

  log "Attempt ${i}/${HEALTH_CHECK_ATTEMPTS}: web container status = '${WEB_STATUS}'"

  if [ "${WEB_STATUS}" = "healthy" ]; then
    HEALTHY=true
    success "Web container is healthy ✓"
    break
  elif [ "${WEB_STATUS}" = "running" ]; then
    # Container is running but health check hasn't passed yet.
    # This is normal during startup — keep waiting.
    log "Container running, waiting for health check to pass..."
  elif [ "${WEB_STATUS}" = "unhealthy" ]; then
    # Health check has failed. No point waiting the full timeout.
    warn "Container is UNHEALTHY. Failing fast."
    HEALTHY=false
    break
  elif [ "${WEB_STATUS}" = "exited" ]; then
    # Container crashed immediately. No point waiting.
    warn "Container has EXITED (crashed). Failing fast."
    HEALTHY=false
    break
  fi

  sleep "${HEALTH_CHECK_SLEEP}"
done

# ==============================================================================
# STEP 8 — REPORT RESULT AND EXIT
# ==============================================================================
# Always print the final container state and relevant logs.
# On success: clean summary, exit 0.
# On failure: detailed logs for diagnosis, exit 1.
#
# WHY exit codes matter for GitHub Actions:
#   GitHub Actions treats the SSH command exit code as the step result.
#   exit 0 = step passes, workflow continues or marks deployment success.
#   exit 1 = step fails, workflow marks the job as failed, sends notifications.
#   Without correct exit codes, GitHub Actions would show "deployment succeeded"
#   even when the application is broken — the worst kind of false confidence.

section "STEP 8: Deployment result"

# Always show final container status regardless of success/failure
log "Final container status:"
docker compose ps

if [ "${HEALTHY}" = "true" ]; then
  # ── SUCCESS PATH ─────────────────────────────────────────────────────────────
  echo ""
  echo "  ╔══════════════════════════════════════════════════╗"
  echo "  ║        ✅  DEPLOYMENT SUCCESSFUL  ✅             ║"
  echo "  ╚══════════════════════════════════════════════════╝"
  echo ""
  success "Image deployed:  ${ECR_IMAGE_URI}"
  success "Deployed tag:    ${IMAGE_TAG}"
  success "Deployed at:     $(date '+%Y-%m-%d %H:%M:%S %Z')"

  # Show image digest to confirm exactly what's running
  IMAGE_DIGEST=$(docker image inspect "${ECR_IMAGE_URI}" \
    --format '{{.RepoDigests}}' 2>/dev/null | \
    tr -d '[]' | \
    awk '{print $1}' || echo "unknown")
  success "Image digest:    ${IMAGE_DIGEST}"

  echo ""
  log "Application is live and serving traffic."
  log "Verify at: http://\$(curl -s http://169.254.169.254/latest/meta-data/public-ipv4)"
  echo ""

  exit 0
  # exit 0 = success. GitHub Actions SSH step exits 0. Job marked as passed.

else
  # ── FAILURE PATH ─────────────────────────────────────────────────────────────
  echo ""
  echo "  ╔══════════════════════════════════════════════════╗"
  echo "  ║        ❌  DEPLOYMENT FAILED  ❌                 ║"
  echo "  ╚══════════════════════════════════════════════════╝"
  echo ""
  warn "Deployment of image tag '${IMAGE_TAG}' failed."
  warn "The web container did not become healthy within $((HEALTH_CHECK_ATTEMPTS * HEALTH_CHECK_SLEEP)) seconds."
  echo ""

  # Print detailed logs to help diagnose what went wrong
  echo "── web container logs (last 80 lines) ─────────────────────────"
  docker compose logs --tail=80 web || true
  # || true: Even if docker compose logs fails, don't exit — we want to
  # show as much diagnostic info as possible before exiting with code 1.

  echo ""
  echo "── db container logs (last 20 lines) ──────────────────────────"
  docker compose logs --tail=20 db || true

  echo ""
  echo "── All container inspect ───────────────────────────────────────"
  docker compose ps -a || true
  # -a: Show all containers including stopped/exited ones.
  # A stopped container means it crashed — its exit code and status show why.

  echo ""
  warn "DIAGNOSIS TIPS:"
  warn "  1. Check web logs above for Django startup errors"
  warn "  2. Check db logs for PostgreSQL connection issues"
  warn "  3. Verify .env has correct DB_PASSWORD, DB_HOST=db, DB_PORT=5432"
  warn "  4. Run 'docker compose logs -f web' on EC2 for real-time logs"
  warn "  5. Verify the image tag exists in ECR: aws ecr list-images --repository-name campuscart-web"
  echo ""

  exit 1
  # exit 1 = failure. GitHub Actions SSH step exits 1. Job marked as failed.
  # Team is notified. No false confidence about a broken deployment.
fi

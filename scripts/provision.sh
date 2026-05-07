#!/usr/bin/env bash
# ==============================================================================
# CampusCart — scripts/provision.sh
# ==============================================================================
# PURPOSE:
#   Runs ONCE on a fresh Ubuntu 22.04 EC2 to set up the entire server from zero.
#   Takes a blank machine with nothing on it and produces a fully running
#   CampusCart application — Docker, AWS CLI, application code, secrets from
#   SSM, and all four containers running.
#
# USAGE:
#   chmod +x provision.sh
#   ./provision.sh
#
# IDEMPOTENT:
#   Safe to run multiple times. Every step checks if it's already done before
#   acting. Re-running after a failure simply continues from where it left off.
#   The .env is always recreated from SSM (SSM is the source of truth).
#
# RUNS AS:
#   ubuntu user (NOT root). Uses sudo only for privileged operations.
#
# PREREQUISITES ON EC2:
#   - Ubuntu 22.04 LTS AMI
#   - campuscart-ec2-profile (IAM Instance Profile) attached
#   - campuscart-sg (Security Group) attached
#   - All 18 SSM parameters created under /campuscart/*
#   - Elastic IP attached
#
# INTERVIEW EXPLANATION:
#   "A fresh EC2 has nothing on it. This script does everything automatically:
#    installs Docker from the official repository, installs AWS CLI v2,
#    clones the repository, fetches all 18 secrets from SSM Parameter Store
#    in a single API call, creates the .env file, detects the EC2's Elastic IP
#    from the Instance Metadata Service, logs into ECR, and starts the
#    application with docker compose. What took 30+ minutes manually now
#    happens in one command."
#
# TIMING:
#   First run:  5–8 minutes  (Docker images pulled for the first time)
#   Re-runs:    under 2 min  (Docker layer cache warm, most steps skipped)
# ==============================================================================

# ── STRICT MODE ────────────────────────────────────────────────────────────────
# -e : Exit immediately if any command returns a non-zero exit code.
#      Prevents the script from silently continuing after a failure.
# -u : Treat unset variables as errors. Prevents bugs from typos in var names.
# -o pipefail : If any command in a pipeline fails, the whole pipeline fails.
#               Without this, "false | true" would succeed because 'true' is
#               the last command. With pipefail, it correctly fails.
set -euo pipefail

# ── CONSTANTS ──────────────────────────────────────────────────────────────────
# All configuration in one place — easy to change, easy to audit.

readonly REGION="ap-south-1"
# AWS region where our ECR, SSM, and other resources live.
# ap-south-1 = Mumbai — closest region for India-based deployment.

readonly ECR_ACCOUNT_ID="021859068764"
# AWS Account ID used to construct the ECR registry URL.
# Format: ACCOUNT_ID.dkr.ecr.REGION.amazonaws.com

readonly ECR_REPO="campuscart-web"
# The ECR repository name created by Soldier 3's security-setup.sh.

readonly SSM_PATH="/campuscart/"
# The path prefix for all CampusCart parameters in SSM Parameter Store.
# All 18 params live under /campuscart/KEY_NAME.

readonly APP_DIR="/app/campuscart"
# Application code lives here, not in /home/ubuntu.
# /app is the clean, professional location for application code on Linux.
# Follows the principle: home directories are for users, /app is for apps.

readonly REPO_URL="https://github.com/bharathMoger18/campuscart.git"
# The GitHub repository to clone.

readonly LOG_PREFIX="[CampusCart]"
# Prefix for all log lines — makes it easy to grep the provision output.

# ── LOGGING HELPER ─────────────────────────────────────────────────────────────
# Consistent, timestamped log output.
# Every step is logged so you can see exactly what happened and when.
# In an interview: "Every step is logged with timestamps so we have a full
# audit trail of what the provisioning script did and in what order."

log()  { echo "${LOG_PREFIX} $(date '+%H:%M:%S') INFO  → $*"; }
skip() { echo "${LOG_PREFIX} $(date '+%H:%M:%S') SKIP  → $*"; }
warn() { echo "${LOG_PREFIX} $(date '+%H:%M:%S') WARN  → $*" >&2; }
fail() { echo "${LOG_PREFIX} $(date '+%H:%M:%S') ERROR → $*" >&2; exit 1; }

# ── SEPARATOR FOR READABILITY ──────────────────────────────────────────────────
section() {
  echo ""
  echo "══════════════════════════════════════════════════════════════"
  echo "  $*"
  echo "══════════════════════════════════════════════════════════════"
}

# ==============================================================================
# PREFLIGHT CHECKS
# ==============================================================================
# Verify we're running in the right environment before making any changes.
# Fail fast with a clear message rather than silently doing the wrong thing.

section "PREFLIGHT: Verifying environment"

# Verify we are NOT running as root.
# Running as root is dangerous — mistakes can damage the OS.
# The ubuntu user has passwordless sudo for privileged operations.
if [ "$(id -u)" -eq 0 ]; then
  fail "Do not run as root. Run as ubuntu user: ./provision.sh"
fi
log "Running as user: $(whoami) ✓"

# Verify we are on Ubuntu — this script uses apt-get and Ubuntu-specific paths.
if ! grep -q "Ubuntu" /etc/os-release 2>/dev/null; then
  fail "This script requires Ubuntu. Detected: $(cat /etc/os-release | grep PRETTY_NAME)"
fi
log "OS: $(grep PRETTY_NAME /etc/os-release | cut -d= -f2 | tr -d '"') ✓"

# Verify internet connectivity before we try to download anything.
# Checks connectivity to the AWS endpoint we'll be using most.
log "Checking internet connectivity..."
if ! curl -s --max-time 5 https://aws.amazon.com > /dev/null; then
  fail "No internet connectivity. Check the EC2's route table and Internet Gateway."
fi
log "Internet connectivity: ✓"

# Verify the IAM Instance Profile is attached by checking if IMDS responds.
# If IMDS doesn't respond, the EC2 has no IAM identity and cannot call AWS APIs.
# 169.254.169.254 is the Instance Metadata Service — only reachable from within EC2.
log "Checking IAM Instance Profile via IMDS..."
IMDS_TOKEN=$(curl -s -X PUT "http://169.254.169.254/latest/api/token" -H "X-aws-ec2-metadata-token-ttl-seconds: 21600" --max-time 3)
if ! curl -s --max-time 3 -H "X-aws-ec2-metadata-token: $IMDS_TOKEN" http://169.254.169.254/latest/meta-data/iam/info > /dev/null; then
  fail "IMDS not responding. Ensure an IAM Instance Profile is attached to this EC2."
fi
log "IAM Instance Profile: attached ✓"

# ==============================================================================
# STEP 1 — SYSTEM UPDATE
# ==============================================================================
# WHY we update first:
#   1. Security: The AMI image was created weeks/months ago. Package lists are
#      stale. Without updating, we might install packages with known CVEs.
#   2. Compatibility: Docker installation requires the package manager to know
#      about packages like apt-transport-https and ca-certificates. If the
#      package lists are outdated, these may not be found.
#   3. Dependency resolution: apt resolves dependencies based on its cached
#      package lists. Stale lists can lead to dependency conflicts.
#
# apt-get update: Refreshes the package lists from all configured repositories.
#                 Does NOT upgrade any installed package — just updates the index.
# apt-get upgrade: Upgrades all installed packages to latest versions.
#                  DEBIAN_FRONTEND=noninteractive prevents interactive prompts
#                  (e.g., "Restart services?" questions that would hang the script).

section "STEP 1: System Update"
log "Updating system package lists and upgrading installed packages..."
log "This ensures security patches are applied before we install anything."

export DEBIAN_FRONTEND=noninteractive
# The DEBIAN_FRONTEND variable tells apt-get how to handle interactive prompts.
# "noninteractive" = assume defaults for all prompts, never pause for input.
# Without this, the script might hang waiting for a human to press Enter.

sudo apt-get update -y
# -y flag: Automatically answer "yes" to all prompts.
# In a script, we never want apt asking "Do you want to continue? [Y/n]"

sudo apt-get upgrade -y -o Dpkg::Options::="--force-confdef" -o Dpkg::Options::="--force-confold"
# --force-confdef: Use the default action for any config file question.
# --force-confold: Keep existing config files unchanged if they've been modified.
# These options prevent the script from hanging when apt encounters modified
# config files and asks "Keep the local version? Install the package maintainer's version?"

sudo apt-get install -y curl gnupg lsb-release ca-certificates apt-transport-https unzip git
# Install prerequisites needed for subsequent steps:
# curl            — download Docker GPG key, AWS CLI installer, IMDS queries
# gnupg           — verify Docker's GPG key signature (cryptographic trust)
# lsb-release     — detect Ubuntu version for the correct Docker repo URL
# ca-certificates — verify HTTPS certificates when downloading from docker.com
# apt-transport-https — allow apt to use HTTPS repositories (Docker's repo)
# unzip           — extract the AWS CLI v2 zip package
# git             — clone the CampusCart repository

log "System update complete ✓"

# ==============================================================================
# STEP 2 — INSTALL DOCKER (Official Docker Repository)
# ==============================================================================
# WHY the official Docker repo and NOT apt-get install docker.io:
#
#   Ubuntu's own packages include "docker.io" but it's maintained by Ubuntu,
#   not Docker. It's typically 1-2 major versions behind. For example,
#   Ubuntu 22.04 ships Docker 20.x while Docker's official release is 26.x.
#
#   More critically, Ubuntu's docker.io does NOT include docker-compose-plugin
#   (Compose v2). Our project uses "docker compose" (v2 syntax), not
#   "docker-compose" (the old v1 Python tool).
#
#   The official Docker repository provides:
#   - docker-ce           : Docker Engine (current release)
#   - docker-ce-cli       : Docker CLI (the "docker" command)
#   - containerd.io       : Container runtime (used by Docker under the hood)
#   - docker-compose-plugin: Compose v2, enables "docker compose" command
#
# INSTALLATION PROCESS:
#   1. Add Docker's official GPG key → verify package authenticity
#   2. Add Docker's apt repository → get packages from Docker, not Ubuntu
#   3. apt-get install docker-ce docker-ce-cli containerd.io docker-compose-plugin

section "STEP 2: Installing Docker"

# IDEMPOTENCY CHECK: Skip if Docker is already installed.
# "command -v docker" returns the path to docker if found, exits 0 if found.
# "&>/dev/null" discards both stdout and stderr (we don't need the path printed).
if command -v docker &>/dev/null; then
  skip "Docker already installed: $(docker --version)"
  skip "docker compose version: $(docker compose version)"
else
  log "Docker not found. Installing from official Docker repository..."

  # ── Step 2a: Add Docker's official GPG key ──────────────────────────────────
  # GPG keys are used to cryptographically sign packages.
  # Before trusting packages from Docker's repository, we verify they were
  # signed by Docker, Inc. using their private GPG key. We store their
  # public key in our system's keyring at /etc/apt/keyrings/docker.gpg.
  log "Adding Docker's official GPG key..."
  sudo install -m 0755 -d /etc/apt/keyrings
  # install -d creates the directory. -m 0755 sets permissions.
  # /etc/apt/keyrings is the standard location for apt repository keys in Ubuntu 22.04+.

  curl -fsSL https://download.docker.com/linux/ubuntu/gpg | \
    sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
  # curl flags:
  #   -f: Fail silently on HTTP errors (don't download an error page as the key)
  #   -s: Silent mode (no progress bar)
  #   -S: Show error if -s is used and curl fails
  #   -L: Follow redirects
  # gpg --dearmor: Converts the ASCII-armored GPG key to binary format
  #   that apt expects. The key from Docker's server is in ASCII format
  #   (starts with "-----BEGIN PGP PUBLIC KEY BLOCK-----").

  sudo chmod a+r /etc/apt/keyrings/docker.gpg
  # Make the key readable by apt (which may run as a different user).

  # ── Step 2b: Add Docker's repository to apt sources ─────────────────────────
  # We add a new file to /etc/apt/sources.list.d/ pointing to Docker's repo.
  # The "signed-by" field links this repo to the specific GPG key we just added
  # — apt will ONLY accept packages from this repo if they're signed by that key.
  log "Adding Docker repository to apt sources..."
  echo \
    "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] \
    https://download.docker.com/linux/ubuntu \
    $(lsb_release -cs) stable" | \
    sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
  # dpkg --print-architecture: Returns "amd64" on x86_64, "arm64" on Graviton.
  #   We use this so the script works on both Intel/AMD and ARM-based EC2s.
  # lsb_release -cs: Returns the Ubuntu codename — "jammy" for Ubuntu 22.04.
  #   Docker maintains separate package repos per Ubuntu release.
  # tee /dev/null: Write to the file but suppress stdout output.

  # Refresh package lists to include Docker's new repository
  sudo apt-get update -y

  # ── Step 2c: Install Docker packages ────────────────────────────────────────
  log "Installing docker-ce, docker-ce-cli, containerd.io, docker-compose-plugin..."
  sudo apt-get install -y \
    docker-ce \
    docker-ce-cli \
    containerd.io \
    docker-buildx-plugin \
    docker-compose-plugin
  # docker-ce           : The Docker daemon (dockerd) — the core service
  # docker-ce-cli       : The docker CLI tool you type commands into
  # containerd.io       : The low-level container runtime docker-ce uses
  # docker-buildx-plugin: BuildKit plugin for advanced build features
  # docker-compose-plugin: Adds "docker compose" (v2) subcommand to the Docker CLI
  #
  # WHY NOT "docker-compose" (separate package)?
  # The old "docker-compose" is a standalone Python tool with a hyphen.
  # docker-compose-plugin is the new Go binary, a proper Docker CLI plugin.
  # Our project uses "docker compose" (no hyphen) = v2. Never install both.

  # ── Step 2d: Start and enable Docker daemon ──────────────────────────────────
  log "Starting Docker daemon and enabling it on boot..."
  sudo systemctl start docker
  # systemctl start: Starts the Docker daemon now.
  # Without this, dockerd isn't running and docker commands fail.

  sudo systemctl enable docker
  # systemctl enable: Configures Docker to start automatically when the EC2
  # reboots. Without this, a reboot would leave Docker stopped and the
  # application not running. This is critical for production servers.

  # ── Step 2e: Add ubuntu user to the docker group ─────────────────────────────
  # The Docker socket /var/run/docker.sock is owned by root:docker with
  # permissions 660. Without being in the docker group, every docker command
  # requires sudo. We add ubuntu to the docker group so docker commands work
  # normally without sudo.
  log "Adding ubuntu user to docker group (no more sudo for docker commands)..."
  sudo usermod -aG docker ubuntu
  # usermod -aG: Add user to a supplementary group.
  # -a: APPEND to existing groups (without -a, you'd REPLACE all groups).
  # -G docker: Add to the docker group specifically.
  #
  # IMPORTANT: Group membership doesn't take effect in the current shell session.
  # A new login session is required. For the rest of this script, we use
  # "sg docker -c 'command'" to run docker commands in the docker group context.
  # After provision.sh completes and the operator logs out+in, docker works normally.

  log "Docker installation complete ✓"
  docker --version
  docker compose version
fi

# ==============================================================================
# STEP 3 — INSTALL AWS CLI v2
# ==============================================================================
# WHY AWS CLI v2 and NOT "apt-get install awscli":
#
#   Ubuntu's apt repository provides AWS CLI v1 — a Python-based tool that's
#   significantly older. AWS CLI v2 is a compiled Go binary with:
#   - Better performance (no Python startup overhead)
#   - Full SSM support including --with-decryption for SecureString params
#   - Improved output filtering and --output json/text/yaml options
#   - Better error messages
#   - Faster installation (single binary, no pip dependencies)
#
# We download the official installer from Amazon's servers and install to
# /usr/local/aws-cli/ with a symlink at /usr/local/bin/aws.

section "STEP 3: Installing AWS CLI v2"

# IDEMPOTENCY CHECK: Skip if AWS CLI is already installed.
# "aws --version" exits 0 if aws binary exists and is executable.
if command -v aws &>/dev/null; then
  skip "AWS CLI already installed: $(aws --version)"
else
  log "AWS CLI not found. Downloading AWS CLI v2 installer..."

  # Download to /tmp — it's a temporary work area, cleaned on reboot.
  # No need to clutter /app or /home/ubuntu with installer files.
  curl -fsSL "https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip" \
    -o /tmp/awscliv2.zip
  # The official AWS CLI v2 distribution is a zip containing a shell installer.
  # URL is always the same for the latest version — Amazon updates it in place.

  log "Extracting AWS CLI installer..."
  unzip -q /tmp/awscliv2.zip -d /tmp/
  # -q: Quiet mode (no file-by-file extraction output)
  # -d /tmp/: Extract to /tmp/aws/

  log "Installing AWS CLI v2 to /usr/local/aws-cli/..."
  sudo /tmp/aws/install
  # The installer:
  #   1. Copies the aws binary to /usr/local/aws-cli/v2/current/bin/aws
  #   2. Creates symlink /usr/local/bin/aws → the binary above
  #   3. /usr/local/bin is in the default PATH, so "aws" works immediately

  # Clean up installer files — good housekeeping
  rm -rf /tmp/awscliv2.zip /tmp/aws/
  log "AWS CLI v2 installed ✓: $(aws --version)"
fi

# Verify the IAM role can make AWS API calls.
# This confirms: IAM Instance Profile is attached + permissions are correct.
# aws sts get-caller-identity returns the identity that the current credentials represent.
log "Verifying AWS credentials from IAM Instance Profile..."
CALLER_IDENTITY=$(aws sts get-caller-identity --output text --query 'Arn' 2>&1)
log "Running as AWS identity: ${CALLER_IDENTITY}"
# In an interview: "We call STS to verify the IAM role is properly attached.
# If this fails, we know the IAM Instance Profile isn't set up correctly before
# we try to call SSM or ECR."

# ==============================================================================
# STEP 4 — INSTALL GIT
# ==============================================================================
# Git is needed to clone the CampusCart repository.
# It was installed in Step 1 along with other prerequisites,
# but we verify it here explicitly for clarity.

section "STEP 4: Verifying Git"

if command -v git &>/dev/null; then
  skip "Git already available: $(git --version)"
else
  log "Installing git..."
  sudo apt-get install -y git
  log "Git installed ✓: $(git --version)"
fi

# ==============================================================================
# STEP 5 — CREATE /app DIRECTORY AND CLONE REPOSITORY
# ==============================================================================
# WHY /app and not /home/ubuntu:
#   /home/ubuntu is a user's personal home directory — it's the wrong place
#   for production application code. The Linux Filesystem Hierarchy Standard
#   uses /opt/ or custom /app/ for application code.
#   Using /app:
#   - Clear separation between user space and application space
#   - Other users and scripts can find the app at a predictable path
#   - Doesn't pollute the home directory
#   - Conventional in professional Linux environments
#
# We create /app owned by ubuntu so all subsequent operations (git clone,
# creating .env, docker compose) work without sudo.

section "STEP 5: Setting up application directory and cloning repository"

# Create /app directory owned by ubuntu
if [ ! -d "/app" ]; then
  log "Creating /app directory..."
  sudo mkdir -p /app
  sudo chown ubuntu:ubuntu /app
  # mkdir -p: Create parent directories as needed (no error if already exists)
  # chown ubuntu:ubuntu: Set owner to ubuntu user, ubuntu group
  log "/app directory created and owned by ubuntu ✓"
else
  skip "/app directory already exists"
fi

# Clone or update the repository
if [ -d "${APP_DIR}/.git" ]; then
  # IDEMPOTENCY: Repo already cloned — just pull the latest code.
  # We check for .git directory specifically (not just APP_DIR) because
  # the directory might exist but be empty or incomplete.
  skip "Repository already cloned at ${APP_DIR}"
  log "Pulling latest code from main branch..."
  cd "${APP_DIR}"
  git pull origin main
  log "Repository updated to: $(git log --oneline -1)"
else
  log "Cloning CampusCart repository to ${APP_DIR}..."
  git clone "${REPO_URL}" "${APP_DIR}"
  # Clones into /app/campuscart
  # This is where docker-compose.yml, scripts/, nginx/, campuscart-backend/ all live
  log "Repository cloned ✓"
  log "Latest commit: $(git -C ${APP_DIR} log --oneline -1)"
fi

# ==============================================================================
# STEP 6 — FETCH ALL 18 SSM PARAMETERS AND CREATE .env
# ==============================================================================
# The .env file is NEVER committed to Git. It doesn't exist on a fresh EC2.
# We create it here by fetching all 18 parameters from AWS SSM Parameter Store.
#
# WHY SSM Parameter Store:
#   - Secrets like DJANGO_SECRET_KEY, DB_PASSWORD, STRIPE_SECRET_KEY must
#     never be in Git — even in a private repository.
#   - SSM SecureString params are encrypted at rest using KMS.
#   - Access is controlled by IAM — only campuscart-ec2-role can read these.
#   - Single source of truth — rotate a secret in SSM, re-run provision.sh,
#     the new value is picked up automatically.
#
# WHY get-parameters-by-path (ONE call) not 18 individual get-parameter calls:
#   - 1 API call vs 18 API calls (less network overhead, faster)
#   - 1 IAM authorization check vs 18 (more efficient)
#   - Atomic: either all 18 come back or none do (no partial .env)
#   - Cleaner code — no list of 18 individual parameter names to maintain
#
# WHY --with-decryption:
#   6 of our 18 params are SecureString type — encrypted at rest by KMS.
#   Without this flag, SSM returns the ciphertext (the encrypted bytes) —
#   completely useless for the application. With this flag, SSM calls KMS
#   to decrypt the values before returning them.
#   This works because campuscart-ec2-role has kms:Decrypt permission.
#
# WHY --recursive:
#   Our parameters are at /campuscart/KEY_NAME — one level deep.
#   --recursive fetches all parameters at any depth under the path prefix.
#
# OUTPUT FORMAT (--output text with --query 'Parameters[*].[Name,Value]'):
#   /campuscart/DEBUG<TAB>False
#   /campuscart/DJANGO_SECRET_KEY<TAB>s3cr3tValue...
#   ... 16 more lines ...
#
# BASH PARSING (while IFS=$'\t' read -r name value):
#   IFS=$'\t' sets the field separator to a TAB character for this read.
#   read -r name value: reads one line, splits on IFS into 'name' and 'value'.
#   ${name##/campuscart/}: bash parameter expansion — strips the longest
#   prefix matching "/campuscart/" from the start of $name.
#   Result: "DJANGO_SECRET_KEY=s3cr3tValue..." written to .env

section "STEP 6: Fetching secrets from SSM Parameter Store → creating .env"

# NOTE: We ALWAYS recreate .env from SSM, even if it already exists.
# SSM is the single source of truth. If a parameter was rotated or added,
# re-running provision.sh picks up the new value. Never skip this step.
if [ -f "${APP_DIR}/.env" ]; then
  warn ".env already exists — recreating from SSM (SSM is source of truth)"
  rm -f "${APP_DIR}/.env"
fi

log "Fetching all parameters under ${SSM_PATH} from SSM..."
log "Using --with-decryption to decrypt SecureString parameters via KMS..."

# The single API call that fetches all 18 parameters at once
SSM_OUTPUT=$(aws ssm get-parameters-by-path \
  --path "${SSM_PATH}" \
  --with-decryption \
  --recursive \
  --region "${REGION}" \
  --query 'Parameters[*].[Name,Value]' \
  --output text)
# We store the output in a variable first, then parse it.
# This way if the SSM call fails, we fail before creating a partial .env.

# Verify we actually got parameters back
if [ -z "${SSM_OUTPUT}" ]; then
  fail "SSM returned no parameters under ${SSM_PATH}. Verify parameters exist and IAM role has ssm:GetParametersByPath permission."
fi

# Count how many parameters we fetched
PARAM_COUNT=$(echo "${SSM_OUTPUT}" | wc -l | tr -d ' ')
log "Fetched ${PARAM_COUNT} parameters from SSM"

# Parse the tab-separated output and write KEY=VALUE lines to .env
log "Writing .env to ${APP_DIR}/.env..."
while IFS=$'\t' read -r name value; do
  # Strip the /campuscart/ prefix to get just the key name
  # ${name##/campuscart/} is bash parameter expansion:
  #   ## = remove the longest matching prefix
  #   /campuscart/ = the prefix to remove
  # Input:  /campuscart/DJANGO_SECRET_KEY
  # Output: DJANGO_SECRET_KEY
  key="${name##${SSM_PATH}}"

  # Write KEY=VALUE to .env
  # Note: Values with spaces or special characters are handled correctly
  # because we're writing them as-is, not interpreting them as shell.
  echo "${key}=${value}"
done <<< "${SSM_OUTPUT}" > "${APP_DIR}/.env"
# <<< "${SSM_OUTPUT}" is a "here-string" — feeds the variable content as stdin.
# > "${APP_DIR}/.env" redirects the entire while loop output to the .env file.
# This is atomic — the file is written only after the loop completes.

# Secure the .env file — only ubuntu user should be able to read it
chmod 600 "${APP_DIR}/.env"
# 600 = owner can read+write, group and others have no access.
# The .env contains database passwords, Stripe keys, etc.
# Even though this EC2 only has the ubuntu user, it's good security practice.

# Verify .env was created with the right number of lines
ENV_LINE_COUNT=$(wc -l < "${APP_DIR}/.env")
log ".env created with ${ENV_LINE_COUNT} parameters, permissions: $(stat -c '%a' ${APP_DIR}/.env) ✓"

# ==============================================================================
# STEP 7 — SET ALLOWED_HOSTS FROM INSTANCE METADATA SERVICE
# ==============================================================================
# WHY we detect the IP at runtime instead of hardcoding it:
#   Every new EC2 launch gets a different Elastic IP (until it's explicitly
#   attached). If we hardcoded the IP in provision.sh, we'd need to edit the
#   script every time we launch a new EC2. By querying IMDS, the script is
#   self-configuring — it discovers its own public IP and sets ALLOWED_HOSTS.
#
# WHAT IS IMDS (Instance Metadata Service):
#   A special HTTP endpoint at 169.254.169.254 — reachable ONLY from within
#   the EC2. The IP 169.254.x.x is a link-local address — non-routable,
#   packets never leave the host. IMDS returns data about the running instance:
#   public IP, private IP, instance ID, availability zone, IAM credentials, etc.
#
# WHY ALLOWED_HOSTS matters for Django:
#   Django's ALLOWED_HOSTS security setting rejects requests with Host headers
#   that don't match the configured values. Without the correct IP in
#   ALLOWED_HOSTS, every HTTP request returns a 400 Bad Request error.

section "STEP 7: Detecting EC2 public IP and setting ALLOWED_HOSTS"

log "Querying IMDS for public IPv4 address..."
IMDS_TOKEN2=$(curl -s -X PUT "http://169.254.169.254/latest/api/token" -H "X-aws-ec2-metadata-token-ttl-seconds: 21600" --max-time 3)
EC2_PUBLIC_IP=$(curl -s --max-time 5 -H "X-aws-ec2-metadata-token: $IMDS_TOKEN2" http://169.254.169.254/latest/meta-data/public-ipv4)
# curl -s: Silent mode — no progress bar
# --max-time 5: Fail after 5 seconds if IMDS doesn't respond
# This returns just the IP address as plain text: "13.126.123.45"

if [ -z "${EC2_PUBLIC_IP}" ]; then
  warn "Could not detect public IP from IMDS. ALLOWED_HOSTS may be incorrect."
  warn "Ensure the EC2 has a public IP or Elastic IP attached."
  EC2_PUBLIC_IP="localhost"
  # Fallback to localhost — the application will still run but won't accept
  # traffic from the internet until ALLOWED_HOSTS is corrected.
fi

log "EC2 Public IP detected: ${EC2_PUBLIC_IP}"

# Update ALLOWED_HOSTS in the .env file.
# The SSM parameter has CHANGE_ME_EC2_ELASTIC_IP as placeholder.
# We replace it with the actual IP detected from IMDS.
# sed -i: Edit file in-place (modify the file directly, no temp file needed)
# "s/ALLOWED_HOSTS=.*/ALLOWED_HOSTS=.../" — substitute regex with new value
sed -i "s/ALLOWED_HOSTS=.*/ALLOWED_HOSTS=${EC2_PUBLIC_IP}/" "${APP_DIR}/.env"

# Verify the replacement worked
CURRENT_ALLOWED_HOSTS=$(grep "^ALLOWED_HOSTS=" "${APP_DIR}/.env" | cut -d= -f2)
log "ALLOWED_HOSTS set to: ${CURRENT_ALLOWED_HOSTS} ✓"

# ==============================================================================
# STEP 8 — ECR LOGIN
# ==============================================================================
# Before we can pull Docker images from our private ECR repository, Docker
# needs to authenticate with ECR. ECR is a private registry — no auth, no pull.
#
# HOW ECR AUTHENTICATION WORKS:
#   Step 1: Call "aws ecr get-login-password" using our IAM role's credentials.
#           ECR validates our IAM identity and returns a temporary token (password)
#           valid for 12 hours.
#   Step 2: Pipe that token to "docker login --username AWS --password-stdin REGISTRY_URL"
#           Docker stores the token in its credential store (~/.docker/config.json).
#   After this, docker pull/push to that registry works automatically for 12 hours.
#
# WHY --password-stdin (not --password TOKEN):
#   Passing the password as a command-line argument would expose it in the
#   process list (visible via "ps aux" to all users) and in shell history.
#   --password-stdin reads from stdin (the pipe) — the token flows in memory
#   and is never visible to other processes or in logs.
#
# WHY username is always "AWS":
#   ECR uses token-based authentication. The "AWS" username is a fixed
#   convention — it's what ECR expects for all token-based logins regardless
#   of which IAM identity you're authenticating as.

section "STEP 8: Authenticating with Amazon ECR"

ECR_REGISTRY="${ECR_ACCOUNT_ID}.dkr.ecr.${REGION}.amazonaws.com"
log "ECR Registry URL: ${ECR_REGISTRY}"
log "Authenticating Docker with ECR using IAM Instance Profile credentials..."

# Get the ECR auth token using the EC2's IAM role (no access keys needed)
# and pipe it directly to docker login
sg docker -c "aws ecr get-login-password --region ${REGION} | \
  docker login \
    --username AWS \
    --password-stdin \
    ${ECR_REGISTRY}"
# sg docker -c "...": Run the command in the context of the docker group.
# This is needed because adding ubuntu to the docker group in Step 2 doesn't
# take effect until a new login session. sg docker temporarily activates the
# docker group for this command only.
log "ECR authentication successful ✓"

# ==============================================================================
# STEP 9 — INITIAL APPLICATION STARTUP
# ==============================================================================
# Start all four Docker containers: nginx, web (Django/Daphne), db (PostgreSQL),
# redis (for Django Channels WebSockets).
#
# FIRST RUN vs SUBSEQUENT RUNS:
#   First provision: Docker images may not exist in ECR yet if GitHub Actions
#   hasn't run. We use "docker compose up --build" to build from source as a
#   fallback. This is the ONLY time we build on EC2 — only when no ECR image exists.
#
#   All subsequent deployments: deploy.sh handles image updates by pulling from
#   ECR and running "docker compose up -d --no-build" with docker-compose.prod.yml.
#   provision.sh is not involved in subsequent deployments.
#
# WHY docker compose up -d:
#   -d = detached mode. The command returns immediately without streaming logs.
#   In background mode, all containers run as daemon processes managed by
#   Docker's daemon (dockerd). If a container crashes, Docker's restart policy
#   (restart: unless-stopped in docker-compose.yml) automatically restarts it.

section "STEP 9: Starting CampusCart application with Docker Compose"

cd "${APP_DIR}"
log "Working directory: $(pwd)"

# Check if an ECR image exists (GitHub Actions may have pushed one already)
ECR_IMAGE_URI="${ECR_REGISTRY}/${ECR_REPO}:latest"
log "Checking if ECR image exists: ${ECR_IMAGE_URI}"

if sg docker -c "docker pull ${ECR_IMAGE_URI}" 2>/dev/null; then
  log "ECR image found. Starting application with pre-built image..."
  # Set the WEB_IMAGE variable so docker-compose.prod.yml can use it
  export WEB_IMAGE="${ECR_IMAGE_URI}"
  sg docker -c "
    export WEB_IMAGE=${ECR_IMAGE_URI}
    docker compose \
      -f docker-compose.yml \
      -f docker-compose.prod.yml \
      up -d --no-build
  "
  # -f docker-compose.yml: The base compose file (nginx, web, db, redis)
  # -f docker-compose.prod.yml: The production override (web uses ECR image)
  # up: Ensure all services are running
  # -d: Detached mode (background)
  # --no-build: Never build from source — only use pre-built images
else
  warn "No ECR image found (GitHub Actions may not have run yet)."
  warn "Building from source code as first-time fallback..."
  warn "NOTE: This build on t2.micro may take 5-10 minutes and use significant RAM."
  warn "This is the ONLY time we build on EC2. Subsequent deployments use ECR images."
  sg docker -c "docker compose up -d --build"
  # --build: Force rebuild of images from source Dockerfiles.
  # This is acceptable for first provision only. After Soldier 5 (GitHub Actions)
  # is set up, all deployments will use pre-built ECR images via deploy.sh.
fi

log "Docker Compose startup initiated ✓"

# ==============================================================================
# STEP 10 — VERIFY APPLICATION HEALTH
# ==============================================================================
# After starting containers, we wait for them to be healthy and verify the
# application is actually responding to HTTP requests.
#
# WHY wait and verify:
#   "docker compose up -d" returns immediately — it starts the containers but
#   doesn't wait for them to be ready. The Django application needs time to:
#   - Run database migrations (entrypoint.sh runs manage.py migrate)
#   - Connect to PostgreSQL (may take a few seconds to be ready)
#   - Load all Django apps and middleware
#   - Bind to port 8000 (Daphne ASGI server)
#   Nginx needs the web container to be healthy before it can proxy requests.
#
# We poll every 5 seconds for up to 150 seconds (30 attempts).
# If not healthy by then, we print logs to diagnose the problem and exit 1.

section "STEP 10: Verifying application health"

log "Waiting for all containers to start and become healthy..."
log "Will poll every 5 seconds for up to 150 seconds (30 attempts)..."

ATTEMPTS=30
SLEEP_SECONDS=5

for i in $(seq 1 ${ATTEMPTS}); do
  # Check the status of all containers
  CONTAINER_STATUS=$(sg docker -c "docker compose ps" 2>/dev/null)

  # Count how many containers are running (not just started)
  RUNNING_COUNT=$(echo "${CONTAINER_STATUS}" | grep -c "running" || true)

  log "Attempt ${i}/${ATTEMPTS}: ${RUNNING_COUNT} container(s) running..."

  if [ "${RUNNING_COUNT}" -ge 4 ]; then
    # All 4 containers (nginx, web, db, redis) are running
    log "All containers are running ✓"

    # Additional check: verify nginx is actually serving HTTP requests
    log "Verifying HTTP response from nginx on port 80..."
    HTTP_STATUS=$(curl -s -o /dev/null -w "%{http_code}" \
      --max-time 10 \
      "http://localhost" 2>/dev/null || echo "000")
    # curl flags:
    #   -s: Silent (no progress output)
    #   -o /dev/null: Discard the response body
    #   -w "%{http_code}": Print only the HTTP status code
    #   --max-time 10: Give up after 10 seconds
    # || echo "000": If curl fails entirely (connection refused), return "000"

    if [ "${HTTP_STATUS}" = "200" ] || [ "${HTTP_STATUS}" = "301" ] || [ "${HTTP_STATUS}" = "302" ]; then
      log "HTTP response: ${HTTP_STATUS} — Application is serving traffic ✓"
      break
    else
      log "HTTP response: ${HTTP_STATUS} — Application not yet ready, waiting..."
    fi
  fi

  if [ "${i}" -eq "${ATTEMPTS}" ]; then
    warn "Containers did not reach healthy state in $((ATTEMPTS * SLEEP_SECONDS)) seconds."
    warn "Printing recent logs for diagnosis:"
    echo "── docker compose ps ──────────────────────────"
    sg docker -c "docker compose ps"
    echo "── web container logs (last 50 lines) ─────────"
    sg docker -c "docker compose logs --tail=50 web"
    echo "── db container logs (last 20 lines) ──────────"
    sg docker -c "docker compose logs --tail=20 db"
    fail "Provisioning failed at health check. Review logs above."
  fi

  sleep "${SLEEP_SECONDS}"
done

# ==============================================================================
# PROVISIONING COMPLETE — SUMMARY
# ==============================================================================

section "PROVISIONING COMPLETE"

echo ""
echo "  ██████╗ ██████╗ ███╗   ██╗███████╗"
echo "  ██╔══██╗██╔═══██╗████╗  ██║██╔════╝"
echo "  ██║  ██║██║   ██║██╔██╗ ██║█████╗  "
echo "  ██║  ██║██║   ██║██║╚██╗██║██╔══╝  "
echo "  ██████╔╝╚██████╔╝██║ ╚████║███████╗"
echo "  ╚═════╝  ╚═════╝ ╚═╝  ╚═══╝╚══════╝"
echo ""
log "CampusCart is now running on this EC2!"
echo ""

# Print the final container status
sg docker -c "docker compose ps"

echo ""
log "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
log "Application URL:  http://${EC2_PUBLIC_IP}"
log ".env location:    ${APP_DIR}/.env"
log "App directory:    ${APP_DIR}"
log "Docker group:     NOTE: Log out and back in for docker commands without sudo"
log "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
log "Subsequent deployments are handled by: scripts/deploy.sh <image-tag>"
log "GitHub Actions (Soldier 5) will call this automatically on every push to main."
echo ""
log "Provisioning completed successfully 🎖️"

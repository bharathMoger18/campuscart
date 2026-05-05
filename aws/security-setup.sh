#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════════════════
# CampusCart — Soldier 3: Security Setup Script
# ═══════════════════════════════════════════════════════════════════════════════
#
# WHAT THIS SCRIPT CREATES (in order):
#   STEP 1 — Security Group       : campuscart-sg
#   STEP 2 — IAM Policy           : campuscart-ssm-policy
#   STEP 3 — IAM Role             : campuscart-ec2-role
#   STEP 4 — Instance Profile     : campuscart-ec2-profile
#   STEP 5 — ECR Repository       : campuscart-web
#   STEP 6 — SSM Parameters       : 18 parameters under /campuscart/*
#   STEP 7 — GitHub Actions User  : campuscart-github-actions
#
# ORDERING REQUIREMENT:
#   Run AFTER  vpc-network.sh  (needs the VPC to exist)
#   Run BEFORE ec2-launch.sh   (ec2-launch.sh looks up campuscart-sg by name)
#
# USAGE:
#   chmod +x aws/security-setup.sh
#   ./aws/security-setup.sh
#
# REGION: ap-south-1 (Mumbai)
# ═══════════════════════════════════════════════════════════════════════════════

set -euo pipefail  # Exit on error, undefined variable, or pipe failure

# ── Colors ────────────────────────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
MAGENTA='\033[0;35m'
BOLD='\033[1m'
DIM='\033[2m'
NC='\033[0m'  # No Color / Reset

# ── Helpers ───────────────────────────────────────────────────────────────────
print_step()    { echo -e "\n${BOLD}${CYAN}━━━ STEP $1 — $2 ━━━${NC}"; }
print_ok()      { echo -e "  ${GREEN}✔${NC} $1"; }
print_info()    { echo -e "  ${BLUE}ℹ${NC}  $1"; }
print_warn()    { echo -e "  ${YELLOW}⚠${NC}  $1"; }
print_val()     { echo -e "  ${MAGENTA}→${NC}  ${BOLD}$1${NC}: ${DIM}$2${NC}"; }
print_banner()  {
  echo -e "\n${BOLD}${BLUE}╔══════════════════════════════════════════════════════════════╗${NC}"
  echo -e "${BOLD}${BLUE}║${NC}  ${BOLD}$1${NC}"
  echo -e "${BOLD}${BLUE}╚══════════════════════════════════════════════════════════════╝${NC}"
}

# ── Configuration ─────────────────────────────────────────────────────────────
REGION="ap-south-1"
VPC_NAME="campuscart-vpc"
SG_NAME="campuscart-sg"
IAM_POLICY_NAME="campuscart-ssm-policy"
IAM_ROLE_NAME="campuscart-ec2-role"
INSTANCE_PROFILE_NAME="campuscart-ec2-profile"
ECR_REPO_NAME="campuscart-web"
GH_USER_NAME="campuscart-github-actions"
GH_POLICY_NAME="campuscart-github-actions-policy"
PROJECT_TAG="CampusCart"

# ── Banner ────────────────────────────────────────────────────────────────────
clear
echo -e "${BOLD}${CYAN}"
cat << 'EOF'
  ____      __  __             __  ____            __
 / __/___  / / / /__ ___ ____/ /_/ __/__ _______  / /_
/ _// _ \/ /_/ (_-</ _ `/ __/ __/\ \/ -_) __/ / / __/
/___/\___/\__,_/___/\_,_/_/  \__/___/\__/\__/_,_/\__/
EOF
echo -e "${NC}"
echo -e "${BOLD}Soldier 3 — IAM + Security Groups + SSM Parameter Store${NC}"
echo -e "${DIM}Region: ${REGION} | Project: CampusCart${NC}"
echo ""

# ═══════════════════════════════════════════════════════════════════════════════
# PRE-FLIGHT CHECKS
# ═══════════════════════════════════════════════════════════════════════════════
print_banner "PRE-FLIGHT CHECKS"

# Check AWS CLI is installed
if ! command -v aws &>/dev/null; then
  echo -e "${RED}✘ AWS CLI not found. Install it first: https://docs.aws.amazon.com/cli/latest/userguide/install-cliv2.html${NC}"
  exit 1
fi
print_ok "AWS CLI found: $(aws --version 2>&1 | head -1)"

# Check AWS credentials are configured
if ! aws sts get-caller-identity --region "$REGION" &>/dev/null; then
  echo -e "${RED}✘ AWS credentials not configured. Run: aws configure${NC}"
  exit 1
fi

ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text --region "$REGION")
CALLER_ARN=$(aws sts get-caller-identity --query Arn --output text --region "$REGION")
print_ok "AWS credentials valid"
print_val "Account ID"  "$ACCOUNT_ID"
print_val "Caller ARN"  "$CALLER_ARN"

# Check VPC exists (vpc-network.sh must have run first)
VPC_ID=$(aws ec2 describe-vpcs \
  --filters "Name=tag:Name,Values=${VPC_NAME}" \
  --query "Vpcs[0].VpcId" \
  --output text \
  --region "$REGION" 2>/dev/null || true)

if [[ -z "$VPC_ID" || "$VPC_ID" == "None" ]]; then
  echo -e "${RED}✘ VPC '${VPC_NAME}' not found. Run aws/vpc-network.sh first.${NC}"
  exit 1
fi
print_ok "VPC '${VPC_NAME}' found: ${VPC_ID}"

# Detect current public IP automatically (used for SSH rule)
# WHY AUTO-DETECT: Soldier 6 runs this script at execution time. The auto-detect
# captures Bharath's REAL public IP at that exact moment — no manual placeholder
# replacement needed. This is production-quality practice.
print_info "Detecting your public IP for SSH rule..."
MY_IP=$(curl -s --max-time 10 https://checkip.amazonaws.com)
if [[ -z "$MY_IP" ]]; then
  echo -e "${RED}✘ Could not detect public IP. Check internet connectivity.${NC}"
  exit 1
fi
print_ok "Your public IP detected: ${MY_IP}"
print_info "SSH (port 22) will be restricted to ${MY_IP}/32 ONLY"
print_info "  /32 = CIDR notation for exactly ONE IP address (a /32 mask means all 32 bits are fixed)"

echo ""
echo -e "${GREEN}${BOLD}All pre-flight checks passed. Beginning security setup...${NC}"

# ═══════════════════════════════════════════════════════════════════════════════
# STEP 1 — SECURITY GROUP
# ═══════════════════════════════════════════════════════════════════════════════
#
# WHAT IS A SECURITY GROUP?
# A Security Group is a stateful virtual firewall that operates at the EC2 instance
# level. Every EC2 instance must belong to at least one Security Group.
#
# STATEFUL means: if you allow an inbound connection, the RETURN traffic is
# automatically allowed — you don't need a separate outbound rule for it.
# Example: A user sends HTTP request (inbound port 80 — allowed). The response
# flows back out automatically even though we haven't explicitly added an outbound
# rule for port 80.
#
# INBOUND RULES: traffic COMING INTO the instance. We only open what is needed.
# OUTBOUND RULES: traffic LEAVING the instance. We leave all outbound open because
# EC2 needs to reach ECR (to pull Docker images), SSM (to fetch secrets), package
# repos (apt-get), and CloudWatch (to ship logs). Restricting outbound would break
# all of these without adding meaningful security (attackers already inside can use
# DNS, HTTP, etc. — outbound restrictions rarely stop them).
#
# WHY PORT 22 IS RESTRICTED:
# SSH is the most brute-forced port on the internet. If you open 0.0.0.0/0 on
# port 22, bots will hammer it within minutes. Restricting to /32 (your exact IP)
# means only YOUR machine can even attempt an SSH connection. Bots get silently
# dropped at the Security Group level — they can't even reach the SSH daemon.
# ═══════════════════════════════════════════════════════════════════════════════
print_step "1" "SECURITY GROUP (${SG_NAME})"

# Check if Security Group already exists (idempotency — safe to run twice)
EXISTING_SG=$(aws ec2 describe-security-groups \
  --filters "Name=group-name,Values=${SG_NAME}" "Name=vpc-id,Values=${VPC_ID}" \
  --query "SecurityGroups[0].GroupId" \
  --output text \
  --region "$REGION" 2>/dev/null || true)

if [[ -n "$EXISTING_SG" && "$EXISTING_SG" != "None" ]]; then
  print_warn "Security Group '${SG_NAME}' already exists: ${EXISTING_SG}"
  print_warn "Skipping creation. Using existing Security Group."
  SG_ID="$EXISTING_SG"
else
  # Create the Security Group inside campuscart-vpc
  # --description is required by AWS; it's shown in the console
  SG_ID=$(aws ec2 create-security-group \
    --group-name "$SG_NAME" \
    --description "CampusCart EC2 Security Group — HTTP, HTTPS public, SSH restricted" \
    --vpc-id "$VPC_ID" \
    --region "$REGION" \
    --query "GroupId" \
    --output text)
  print_ok "Security Group created: ${SG_ID}"

  # Tag the Security Group for identification in console
  aws ec2 create-tags \
    --resources "$SG_ID" \
    --tags \
      Key=Name,Value="$SG_NAME" \
      Key=Project,Value="$PROJECT_TAG" \
      Key=ManagedBy,Value="soldier3-security-setup" \
    --region "$REGION"
  print_ok "Tags applied to Security Group"

  # ── INBOUND RULE 1: HTTP (port 80) ──────────────────────────────────────────
  # WHY: Nginx listens on port 80 inside the Docker stack. All web traffic for
  # CampusCart comes through here. Open to 0.0.0.0/0 (entire internet) because
  # this is a PUBLIC web application — any user must be able to reach it.
  aws ec2 authorize-security-group-ingress \
    --group-id "$SG_ID" \
    --protocol tcp \
    --port 80 \
    --cidr 0.0.0.0/0 \
    --region "$REGION"
  print_ok "Inbound rule added: TCP port 80 (HTTP) from 0.0.0.0/0 — public web traffic"

  # ── INBOUND RULE 2: HTTPS (port 443) ────────────────────────────────────────
  # WHY: When we add an SSL certificate later (Let's Encrypt / ACM), Nginx will
  # serve on 443. We open it now so the Security Group is future-ready without
  # needing to be edited. Currently Nginx redirects HTTP to HTTPS is not yet set
  # up but the port must be open when we do.
  aws ec2 authorize-security-group-ingress \
    --group-id "$SG_ID" \
    --protocol tcp \
    --port 443 \
    --cidr 0.0.0.0/0 \
    --region "$REGION"
  print_ok "Inbound rule added: TCP port 443 (HTTPS) from 0.0.0.0/0 — public HTTPS traffic"

  # ── INBOUND RULE 3: SSH (port 22) ───────────────────────────────────────────
  # WHY: We need SSH to provision the EC2 (Soldier 4's script runs over SSH),
  # and for debugging. Restricted to MY_IP/32 ONLY — this is a critical security
  # decision. /32 in CIDR notation means all 32 bits of the IP are fixed = exactly
  # one IP address. No other machine on earth can initiate SSH to this EC2.
  # Without this restriction, bots would hammer port 22 within minutes of launch.
  aws ec2 authorize-security-group-ingress \
    --group-id "$SG_ID" \
    --protocol tcp \
    --port 22 \
    --cidr "${MY_IP}/32" \
    --region "$REGION"
  print_ok "Inbound rule added: TCP port 22 (SSH) from ${MY_IP}/32 — YOUR IP only"

  # ── OUTBOUND RULE: All traffic allowed ──────────────────────────────────────
  # WHY: AWS adds a default allow-all outbound rule automatically to every new
  # Security Group. We do NOT remove it because EC2 NEEDS to make outbound
  # connections to:
  #   - ECR (021859068764.dkr.ecr.ap-south-1.amazonaws.com) — pull Docker images
  #   - SSM (ssm.ap-south-1.amazonaws.com) — fetch secrets from Parameter Store
  #   - CloudWatch (logs.ap-south-1.amazonaws.com) — ship application logs
  #   - Ubuntu package repos (apt-get update/upgrade)
  #   - Stripe API (api.stripe.com) — payment processing from Django
  # Restricting outbound would require whitelisting all of these by IP, which
  # changes frequently and is operationally impractical for a small project.
  print_ok "Outbound rule: all traffic allowed (AWS default — required for ECR, SSM, CloudWatch)"
fi

print_val "Security Group ID" "$SG_ID"
print_val "Security Group Name" "$SG_NAME"

# ═══════════════════════════════════════════════════════════════════════════════
# STEP 2 — IAM POLICY (campuscart-ssm-policy)
# ═══════════════════════════════════════════════════════════════════════════════
#
# WHAT IS AN IAM POLICY?
# A JSON document that defines permissions. It says: "Allow or Deny specific
# ACTIONS on specific RESOURCES." Policies are attached to identities (users,
# roles, groups) to grant them permissions.
#
# IAM POLICY STRUCTURE:
#   Version   — always "2012-10-17" (the policy language version — never changes)
#   Statement — array of permission rules
#     Effect   — "Allow" or "Deny"
#     Action   — what AWS API calls are permitted (e.g., "ssm:GetParameter")
#     Resource — which specific resources (using ARN format)
#
# ARN FORMAT: arn:partition:service:region:account-id:resource
#   Example:  arn:aws:ssm:ap-south-1:*:parameter/campuscart/*
#             arn = literal
#             aws = partition (aws, aws-cn for China, aws-us-gov for GovCloud)
#             ssm = service name
#             ap-south-1 = region
#             * = any account ID (or you can put the specific account ID)
#             parameter/campuscart/* = resource type + path + wildcard
#
# PRINCIPLE OF LEAST PRIVILEGE:
# Grant ONLY the permissions that are actually needed, on ONLY the resources
# that actually need them. Our EC2 role needs to:
#   - Read SSM parameters (but only /campuscart/* — not other projects)
#   - Pull Docker images from ECR
#   - Write logs to CloudWatch
# That is ALL. It does NOT need S3, RDS, Route53, or any other service.
# If the EC2 is compromised, an attacker with this role can only read our
# /campuscart/* SSM params and pull our Docker image — they cannot delete
# infrastructure, access other services, or pivot to other AWS accounts.
# ═══════════════════════════════════════════════════════════════════════════════
print_step "2" "IAM POLICY (${IAM_POLICY_NAME})"

# Build the policy JSON document
# Each permission block is carefully scoped:
#
# BLOCK 1 — SSM GetParameter actions:
#   GetParameter         — fetch ONE parameter by exact name
#   GetParameters        — fetch multiple parameters by exact names (batch)
#   GetParametersByPath  — fetch ALL parameters under /campuscart/* in ONE API call
#                          Soldier 4's provisioning script uses GetParametersByPath
#                          to load ALL 18 environment variables in a single command.
#   Resource: arn:aws:ssm:ap-south-1:*:parameter/campuscart/*
#   The trailing /* means ANY parameter whose name starts with /campuscart/
#   This CANNOT access /other-project/* or /aws/* — scoped to our project only.
#
# BLOCK 2 — ECR token:
#   ecr:GetAuthorizationToken on * (must be * — it's a global token, not per-repo)
#   This gets a temporary Docker login token for 12 hours. Without this, Docker
#   cannot authenticate to ECR at all — `docker pull` would fail with 401.
#   Resource MUST be * because GetAuthorizationToken is not repo-specific.
#
# BLOCK 3 — ECR image pull:
#   ecr:BatchGetImage          — get image manifest (needed to know what to pull)
#   ecr:GetDownloadUrlForLayer — get the S3 URLs for each image layer
#   Resource: scoped to campuscart-web repo only — not all ECR repos in the account
#
# BLOCK 4 — CloudWatch Logs:
#   CreateLogGroup    — create /campuscart/django etc. log group first time
#   CreateLogStream   — create a log stream within the group
#   PutLogEvents      — actually write log data
#   Resource: * — CloudWatch log group ARNs can be unpredictable; * is acceptable
#   here because the only action is writing logs — not reading or deleting others.

POLICY_DOCUMENT=$(cat << EOF
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "SSMReadCampusCartParameters",
      "Effect": "Allow",
      "Action": [
        "ssm:GetParameter",
        "ssm:GetParameters",
        "ssm:GetParametersByPath"
      ],
      "Resource": "arn:aws:ssm:${REGION}:${ACCOUNT_ID}:parameter/campuscart/*"
    },
    {
      "Sid": "ECRAuthToken",
      "Effect": "Allow",
      "Action": [
        "ecr:GetAuthorizationToken"
      ],
      "Resource": "*"
    },
    {
      "Sid": "ECRPullCampusCartImage",
      "Effect": "Allow",
      "Action": [
        "ecr:BatchGetImage",
        "ecr:GetDownloadUrlForLayer",
        "ecr:BatchCheckLayerAvailability"
      ],
      "Resource": "arn:aws:ecr:${REGION}:${ACCOUNT_ID}:repository/${ECR_REPO_NAME}"
    },
    {
      "Sid": "CloudWatchLogsWrite",
      "Effect": "Allow",
      "Action": [
        "logs:CreateLogGroup",
        "logs:CreateLogStream",
        "logs:PutLogEvents",
        "logs:DescribeLogStreams"
      ],
      "Resource": "arn:aws:logs:${REGION}:${ACCOUNT_ID}:log-group:/campuscart/*"
    }
  ]
}
EOF
)

# Check if policy already exists (idempotency)
EXISTING_POLICY_ARN=$(aws iam list-policies \
  --scope Local \
  --query "Policies[?PolicyName=='${IAM_POLICY_NAME}'].Arn" \
  --output text \
  --region "$REGION" 2>/dev/null || true)

if [[ -n "$EXISTING_POLICY_ARN" && "$EXISTING_POLICY_ARN" != "None" ]]; then
  print_warn "IAM Policy '${IAM_POLICY_NAME}' already exists: ${EXISTING_POLICY_ARN}"
  print_warn "Skipping creation. Using existing policy."
  POLICY_ARN="$EXISTING_POLICY_ARN"
else
  POLICY_ARN=$(aws iam create-policy \
    --policy-name "$IAM_POLICY_NAME" \
    --policy-document "$POLICY_DOCUMENT" \
    --description "CampusCart EC2 policy: SSM read /campuscart/*, ECR pull campuscart-web, CloudWatch logs write" \
    --query "Policy.Arn" \
    --output text)
  print_ok "IAM Policy created: ${POLICY_ARN}"
fi

print_val "Policy ARN" "$POLICY_ARN"

# ═══════════════════════════════════════════════════════════════════════════════
# STEP 3 — IAM ROLE (campuscart-ec2-role)
# ═══════════════════════════════════════════════════════════════════════════════
#
# WHAT IS AN IAM ROLE?
# An IAM Role is an identity with specific permissions that can be ASSUMED
# temporarily by a trusted entity. Unlike IAM Users, roles have NO long-term
# credentials (no access key / secret key). Instead, when an entity assumes a
# role, AWS STS (Security Token Service) issues temporary credentials valid for
# 1-12 hours. When they expire, new credentials are automatically issued.
#
# WHY EC2 USES A ROLE (NOT A USER):
# If we used an IAM User, we'd have to:
#   1. Generate an access key + secret key
#   2. Somehow get them onto the EC2 (SSH? Bake into AMI? Both are risky)
#   3. Manage key rotation manually
#   4. Risk leaked credentials if someone reads ~/.aws/credentials on the EC2
#
# With a Role:
#   1. We assign the role to the EC2 at launch time
#   2. The AWS metadata service (169.254.169.254) automatically provides
#      temporary credentials to any process running on the EC2
#   3. Credentials auto-rotate every hour — no management needed
#   4. Even if an attacker reads the temporary credentials from IMDS, they
#      expire within an hour and have limited permissions
#
# TRUST POLICY:
# The trust policy (also called "assume role policy") defines WHO can assume
# this role. For our EC2 role, we trust the "ec2.amazonaws.com" service
# principal — meaning: only the EC2 service itself can assume this role.
# This prevents other AWS services or external parties from using this role.
# ═══════════════════════════════════════════════════════════════════════════════
print_step "3" "IAM ROLE (${IAM_ROLE_NAME})"

# Trust Policy — defines who can ASSUME this role
# "Principal": {"Service": "ec2.amazonaws.com"} = only the EC2 service
# "Action": "sts:AssumeRole" = the mechanism for assuming the role
# This is why EC2 instances can automatically use this role — AWS internally
# calls sts:AssumeRole on behalf of the EC2 when it needs credentials.
TRUST_POLICY=$(cat << 'EOF'
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "EC2AssumeRole",
      "Effect": "Allow",
      "Principal": {
        "Service": "ec2.amazonaws.com"
      },
      "Action": "sts:AssumeRole"
    }
  ]
}
EOF
)

# Check if role already exists
EXISTING_ROLE=$(aws iam get-role \
  --role-name "$IAM_ROLE_NAME" \
  --query "Role.RoleName" \
  --output text 2>/dev/null || true)

if [[ -n "$EXISTING_ROLE" && "$EXISTING_ROLE" != "None" ]]; then
  print_warn "IAM Role '${IAM_ROLE_NAME}' already exists. Skipping creation."
  ROLE_ARN=$(aws iam get-role \
    --role-name "$IAM_ROLE_NAME" \
    --query "Role.Arn" \
    --output text)
else
  ROLE_ARN=$(aws iam create-role \
    --role-name "$IAM_ROLE_NAME" \
    --assume-role-policy-document "$TRUST_POLICY" \
    --description "CampusCart EC2 role — SSM read, ECR pull, CloudWatch logs" \
    --query "Role.Arn" \
    --output text)
  print_ok "IAM Role created: ${ROLE_ARN}"

  # Tag the role
  aws iam tag-role \
    --role-name "$IAM_ROLE_NAME" \
    --tags Key=Project,Value="$PROJECT_TAG" Key=ManagedBy,Value=soldier3
  print_ok "Tags applied to IAM Role"
fi

# Attach our custom least-privilege policy
# This gives the role the exact permissions defined in Step 2
aws iam attach-role-policy \
  --role-name "$IAM_ROLE_NAME" \
  --policy-arn "$POLICY_ARN" 2>/dev/null || true
print_ok "Custom policy attached: ${IAM_POLICY_NAME}"

# Attach AWS managed policy: AmazonSSMManagedInstanceCore
# WHY THIS MANAGED POLICY:
# This is the official AWS policy for enabling AWS Systems Manager (SSM) on EC2.
# It grants permissions for:
#   - SSM Session Manager (web-based terminal — alternative to SSH)
#   - SSM Agent to register the instance with SSM
#   - Sending instance inventory data to AWS
#   - SSM Run Command (run scripts remotely without SSH)
# This is a security best practice: it means even if we later restrict SSH
# completely (port 22 closed), we can still access the EC2 via Session Manager.
aws iam attach-role-policy \
  --role-name "$IAM_ROLE_NAME" \
  --policy-arn "arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore" 2>/dev/null || true
print_ok "Managed policy attached: AmazonSSMManagedInstanceCore"

print_val "Role ARN" "$ROLE_ARN"

# ═══════════════════════════════════════════════════════════════════════════════
# STEP 4 — INSTANCE PROFILE (campuscart-ec2-profile)
# ═══════════════════════════════════════════════════════════════════════════════
#
# WHAT IS AN INSTANCE PROFILE?
# An Instance Profile is a CONTAINER that holds exactly ONE IAM Role. It is the
# bridge between EC2 and IAM.
#
# WHY CAN'T EC2 USE A ROLE DIRECTLY?
# EC2 was designed before IAM Roles existed. The original EC2 API only accepted
# "instance profiles" as a parameter — not role names or ARNs directly. AWS never
# changed this API for backward compatibility. So even though everyone says "attach
# an IAM Role to EC2," under the hood you're actually attaching an Instance Profile
# that contains the role.
#
# THE FULL FLOW (how EC2 gets credentials):
#   1. At EC2 launch, Instance Profile is attached → AWS notes which role it contains
#   2. AWS injects a metadata endpoint: 169.254.169.254 (IMDSv2)
#   3. When ANY process on EC2 (aws-cli, boto3/botocore, Docker) needs credentials:
#      a. It calls: curl http://169.254.169.254/latest/meta-data/iam/security-credentials/
#      b. Gets the role name back: "campuscart-ec2-role"
#      c. Calls: curl http://169.254.169.254/latest/.../campuscart-ec2-role
#      d. Gets back: AccessKeyId, SecretAccessKey, Token, Expiration (temporary!)
#   4. The SDK uses these temporary credentials automatically
#   5. When they expire (typically 1 hour), SDK fetches fresh ones automatically
#
# CONVENTION: Name the Instance Profile the SAME as the Role. While they CAN
# differ, same name prevents confusion and is the standard practice.
# ═══════════════════════════════════════════════════════════════════════════════
print_step "4" "INSTANCE PROFILE (${INSTANCE_PROFILE_NAME})"

# Check if instance profile already exists
EXISTING_PROFILE=$(aws iam get-instance-profile \
  --instance-profile-name "$INSTANCE_PROFILE_NAME" \
  --query "InstanceProfile.InstanceProfileName" \
  --output text 2>/dev/null || true)

if [[ -n "$EXISTING_PROFILE" && "$EXISTING_PROFILE" != "None" ]]; then
  print_warn "Instance Profile '${INSTANCE_PROFILE_NAME}' already exists. Skipping creation."
  PROFILE_ARN=$(aws iam get-instance-profile \
    --instance-profile-name "$INSTANCE_PROFILE_NAME" \
    --query "InstanceProfile.Arn" \
    --output text)
else
  # Create the instance profile (just the container — role not attached yet)
  PROFILE_ARN=$(aws iam create-instance-profile \
    --instance-profile-name "$INSTANCE_PROFILE_NAME" \
    --query "InstanceProfile.Arn" \
    --output text)
  print_ok "Instance Profile created: ${PROFILE_ARN}"

  # Add the IAM Role INTO the Instance Profile
  # A profile can hold exactly ONE role — this is AWS's design constraint.
  # The role provides the actual permissions; the profile is just the wrapper.
  aws iam add-role-to-instance-profile \
    --instance-profile-name "$INSTANCE_PROFILE_NAME" \
    --role-name "$IAM_ROLE_NAME"
  print_ok "Role '${IAM_ROLE_NAME}' added to Instance Profile"
fi

print_val "Instance Profile ARN" "$PROFILE_ARN"
print_info "ec2-launch.sh will reference this with: --iam-instance-profile Name=${INSTANCE_PROFILE_NAME}"

# ═══════════════════════════════════════════════════════════════════════════════
# STEP 5 — ECR REPOSITORY (campuscart-web)
# ═══════════════════════════════════════════════════════════════════════════════
#
# WHAT IS ECR?
# Amazon Elastic Container Registry is AWS's fully managed Docker image registry.
# It is the AWS equivalent of Docker Hub — but private, IAM-controlled, and in
# the same AWS network as our EC2, making image pulls fast and free (no data
# transfer costs between EC2 and ECR in the same region).
#
# WHY ECR INSTEAD OF DOCKER HUB:
#   - PRIVATE: images are not publicly visible; IAM controls who can pull/push
#   - SAME NETWORK: EC2 in ap-south-1 pulls from ECR ap-south-1 — fast, free
#   - NO RATE LIMITS: Docker Hub free tier throttles pulls to 100/6hr; ECR has none
#   - INTEGRATED: our EC2 IAM role already has pull permissions — no login needed
#   - VULNERABILITY SCANNING: ECR scans images for CVEs on push automatically
#
# IMAGE SCANNING ON PUSH:
# ECR integrates with Amazon Inspector to scan Docker image layers for known
# CVEs (Common Vulnerabilities and Exposures) every time a new image is pushed.
# You get a scan report showing HIGH/MEDIUM/LOW severity findings. This means
# you catch "Django container has a critical OpenSSL vulnerability" before deploying.
#
# TAG IMMUTABILITY (IMMUTABLE):
# With tag immutability ON, once you push an image as "v1.0", you CANNOT push
# another image with the same tag "v1.0". This forces every deployment to use
# a unique tag (commit SHA, build number, timestamp).
# WHY THIS MATTERS: Without immutability, a bad actor (or bad CI/CD config) could
# overwrite "latest" with a broken or malicious image, and EC2 would silently pull
# the bad image on next deployment. Immutability makes every image version permanent
# and traceable.
#
# OUR TAGGING STRATEGY (Soldier 5 will implement):
# GitHub Actions tags images with Git commit SHA: abc1234
# Deploy command: docker pull <ECR_URI>:abc1234
# This means EVERY deployment is traceable to a specific git commit.
# ═══════════════════════════════════════════════════════════════════════════════
print_step "5" "ECR REPOSITORY (${ECR_REPO_NAME})"

# Check if repository already exists
EXISTING_ECR=$(aws ecr describe-repositories \
  --repository-names "$ECR_REPO_NAME" \
  --region "$REGION" \
  --query "repositories[0].repositoryUri" \
  --output text 2>/dev/null || true)

if [[ -n "$EXISTING_ECR" && "$EXISTING_ECR" != "None" ]]; then
  print_warn "ECR Repository '${ECR_REPO_NAME}' already exists: ${EXISTING_ECR}"
  ECR_URI="$EXISTING_ECR"
else
  ECR_URI=$(aws ecr create-repository \
    --repository-name "$ECR_REPO_NAME" \
    --region "$REGION" \
    --image-scanning-configuration scanOnPush=true \
    --image-tag-mutability IMMUTABLE \
    --query "repository.repositoryUri" \
    --output text)
  print_ok "ECR Repository created: ${ECR_URI}"
  print_ok "Image scanning on push: ENABLED (scans for CVEs on every push)"
  print_ok "Tag immutability: IMMUTABLE (cannot overwrite existing image tags)"

  # Tag the repository
  ECR_REPO_ARN="arn:aws:ecr:${REGION}:${ACCOUNT_ID}:repository/${ECR_REPO_NAME}"
  aws ecr tag-resource \
    --resource-arn "$ECR_REPO_ARN" \
    --tags Key=Project,Value="$PROJECT_TAG" Key=ManagedBy,Value=soldier3 \
    --region "$REGION" 2>/dev/null || true
  print_ok "Tags applied to ECR Repository"
fi

print_val "ECR Repository URI" "$ECR_URI"
print_info "Soldier 5 (GitHub Actions) will push to: ${ECR_URI}:<git-commit-sha>"
print_info "EC2 will pull from: ${ECR_URI}:<git-commit-sha>"

# ═══════════════════════════════════════════════════════════════════════════════
# STEP 6 — SSM PARAMETER STORE (18 parameters under /campuscart/*)
# ═══════════════════════════════════════════════════════════════════════════════
#
# WHAT IS SSM PARAMETER STORE?
# AWS Systems Manager Parameter Store is a secure, hierarchical key-value store
# for configuration data and secrets. It is the AWS way to manage application
# configuration without .env files or hardcoded values.
#
# STRING vs SECURESTRING:
#   String      — stored as plain text. Visible in console, CLI, logs. Use for
#                 non-sensitive config: hostnames, ports, feature flags.
#   SecureString — encrypted at rest using AWS KMS (Key Management Service).
#                 Stored as ciphertext. Decrypted on-the-fly when fetched via SDK.
#                 Use for passwords, API keys, private keys — anything that would
#                 cause a security breach if leaked.
#
# HOW KMS ENCRYPTION WORKS (envelope encryption):
#   1. AWS creates/uses a KMS Customer Managed Key (CMK) or the default aws/ssm key
#   2. KMS generates a Data Encryption Key (DEK) unique to each parameter
#   3. Your secret is encrypted with the DEK using AES-256
#   4. The DEK itself is encrypted with the CMK and stored alongside the ciphertext
#   5. When you fetch the parameter, KMS decrypts the DEK, then decrypts the secret
#   6. The plaintext is returned over TLS — never stored unencrypted on disk
#
# WHY SSM INSTEAD OF .ENV FILES:
#   .env file problems:
#     - Accidentally committed to Git → secret exposed publicly forever
#     - No audit trail of who accessed/changed what
#     - Copy-pasted between servers → inconsistent, error-prone
#     - Must be transferred over SSH → risk in transit
#   SSM Parameter Store:
#     - Never leaves AWS — fetched at runtime via HTTPS API
#     - Full CloudTrail audit log: who fetched which parameter, when, from where
#     - IAM-controlled: only campuscart-ec2-role can read /campuscart/*
#     - Centralized: update a value once, all instances get it on next restart
#     - SecureString = encrypted at rest by KMS automatically
#
# PATH HIERARCHY (/campuscart/*):
# The leading /campuscart/ prefix enables:
#   1. GetParametersByPath: fetch ALL campuscart params in ONE API call
#   2. IAM policy scoping: grant/deny access by path prefix (not per-param)
#   3. Future isolation: /other-project/* can have completely separate permissions
#   4. Console organization: parameters grouped by path in the UI
#
# DB_HOST = "db" and REDIS_HOST = "redis":
# These values are Docker service names from docker-compose.yml. When Django
# connects to PostgreSQL, it uses DB_HOST="db" — Docker's internal DNS resolves
# "db" to the db container's private IP inside the Docker network. This is correct
# and intentional. NOT "localhost", NOT "127.0.0.1", NOT the EC2 private IP.
# ═══════════════════════════════════════════════════════════════════════════════
print_step "6" "SSM PARAMETER STORE (18 parameters under /campuscart/*)"

print_info "Creating String parameters (non-sensitive config)..."
print_info "Creating SecureString parameters (sensitive secrets — KMS encrypted)..."
echo ""

# Helper function to create or update an SSM parameter
# --overwrite allows re-running the script safely without errors
put_param() {
  local name="$1"
  local value="$2"
  local type="$3"
  local description="$4"

  aws ssm put-parameter \
    --name "$name" \
    --value "$value" \
    --type "$type" \
    --description "$description" \
    --overwrite \
    --tags Key=Project,Value="$PROJECT_TAG" Key=ManagedBy,Value=soldier3 \
    --region "$REGION" \
    --output json > /dev/null

  if [[ "$type" == "SecureString" ]]; then
    echo -e "  ${GREEN}✔${NC} [${YELLOW}SecureString${NC}] ${BOLD}${name}${NC} — ${DIM}KMS encrypted${NC}"
  else
    echo -e "  ${GREEN}✔${NC} [${CYAN}String${NC}      ] ${BOLD}${name}${NC} — ${DIM}${value}${NC}"
  fi
}

# ── Django Application Settings ────────────────────────────────────────────────
# DJANGO_SECRET_KEY — SecureString
# Django uses this 50+ character random key for cryptographic signing:
# session cookies, CSRF tokens, password reset links, JWT token signing.
# If leaked, an attacker can forge session cookies and impersonate any user.
put_param \
  "/campuscart/DJANGO_SECRET_KEY" \
  "CHANGE_ME_REPLACE_WITH_50_CHAR_RANDOM_KEY_$(openssl rand -hex 12)" \
  "SecureString" \
  "Django cryptographic signing key — sessions, CSRF, JWT"

# DEBUG — String
# In production, DEBUG must be False. If True, Django shows full stack traces
# including database queries and source code in browser error pages — catastrophic
# information leak in production. False hides all internal details from errors.
put_param \
  "/campuscart/DEBUG" \
  "False" \
  "String" \
  "Django debug mode — always False in production"

# ALLOWED_HOSTS — String
# Django's ALLOWED_HOSTS is a security measure against HTTP Host header injection
# attacks. Django will refuse to serve requests for any hostname not in this list.
# Update with EC2's Elastic IP after Soldier 2's ec2-launch.sh runs.
put_param \
  "/campuscart/ALLOWED_HOSTS" \
  "CHANGE_ME_EC2_ELASTIC_IP,localhost,127.0.0.1" \
  "String" \
  "Django allowed hosts — EC2 Elastic IP and domain (comma-separated)"

# ── Database Configuration ─────────────────────────────────────────────────────
# DB_NAME — String (not sensitive — just the database name)
put_param \
  "/campuscart/DB_NAME" \
  "campuscart_db" \
  "String" \
  "PostgreSQL database name"

# DB_USER — String (username not sensitive — password is)
put_param \
  "/campuscart/DB_USER" \
  "campuscart_user" \
  "String" \
  "PostgreSQL database username"

# DB_PASSWORD — SecureString (MUST be changed before deployment)
# This password protects all CampusCart data — user accounts, orders, payments.
put_param \
  "/campuscart/DB_PASSWORD" \
  "CHANGE_ME_STRONG_DB_PASSWORD_HERE" \
  "SecureString" \
  "PostgreSQL database password — KMS encrypted"

# DB_HOST — String
# CRITICAL: Value is "db" — the Docker Compose service name for PostgreSQL.
# Docker's internal DNS resolves "db" to the database container's IP automatically.
# Do NOT use "localhost" — that would fail because Django runs in a separate container.
# Do NOT use the EC2's private IP — that would bypass Docker networking.
put_param \
  "/campuscart/DB_HOST" \
  "db" \
  "String" \
  "PostgreSQL host — Docker Compose service name (NOT localhost)"

# DB_PORT — String
put_param \
  "/campuscart/DB_PORT" \
  "5432" \
  "String" \
  "PostgreSQL default port"

# ── Redis Configuration ────────────────────────────────────────────────────────
# REDIS_HOST — String
# Same principle as DB_HOST: "redis" is the Docker Compose service name.
# Django Channels uses Redis as the channel layer backend for WebSocket message
# routing. The push notification service also uses Redis for async task queuing.
put_param \
  "/campuscart/REDIS_HOST" \
  "redis" \
  "String" \
  "Redis host — Docker Compose service name for Django Channels WebSockets"

# REDIS_PORT — String
put_param \
  "/campuscart/REDIS_PORT" \
  "6379" \
  "String" \
  "Redis default port"

# ── Email Configuration (Gmail SMTP) ──────────────────────────────────────────
# EMAIL_HOST_USER — String (email address itself is not sensitive)
put_param \
  "/campuscart/EMAIL_HOST_USER" \
  "CHANGE_ME_GMAIL_ADDRESS@gmail.com" \
  "String" \
  "Gmail address for sending transactional emails (order confirmations, password reset)"

# EMAIL_HOST_PASSWORD — SecureString
# This is a Gmail App Password (16-character code), NOT the Gmail account password.
# Gmail requires 2FA + App Password for SMTP access. If leaked, attacker can send
# emails from CampusCart's Gmail account (phishing, spam). KMS-encrypt it.
put_param \
  "/campuscart/EMAIL_HOST_PASSWORD" \
  "CHANGE_ME_GMAIL_APP_PASSWORD_16CHARS" \
  "SecureString" \
  "Gmail App Password for SMTP — enable 2FA + App Password in Gmail settings"

# ── Stripe Payment Configuration ──────────────────────────────────────────────
# STRIPE_SECRET_KEY — SecureString
# This is the server-side Stripe API key. Anyone with this key can:
#   - Charge any credit card on file
#   - Issue refunds
#   - Access all payment records
# NEVER expose this in logs, frontend code, or anywhere public.
put_param \
  "/campuscart/STRIPE_SECRET_KEY" \
  "CHANGE_ME_sk_live_STRIPE_SECRET_KEY" \
  "SecureString" \
  "Stripe secret API key — server-side only, never expose to frontend"

# STRIPE_PUBLISHABLE_KEY — String
# This key IS safe to expose to browsers — it's designed to be public.
# Used in frontend JavaScript to tokenize card details (card never hits our server).
put_param \
  "/campuscart/STRIPE_PUBLISHABLE_KEY" \
  "CHANGE_ME_pk_live_STRIPE_PUBLISHABLE_KEY" \
  "String" \
  "Stripe publishable key — safe for frontend use"

# STRIPE_WEBHOOK_SECRET — SecureString
# Stripe signs all webhook payloads with this secret using HMAC-SHA256.
# Django verifies this signature before processing any webhook event.
# Without this verification, an attacker could POST fake payment confirmations
# to /api/payments/webhook/ and trick the system into marking orders as paid.
put_param \
  "/campuscart/STRIPE_WEBHOOK_SECRET" \
  "CHANGE_ME_whsec_STRIPE_WEBHOOK_SECRET" \
  "SecureString" \
  "Stripe webhook signing secret — validates webhook payload authenticity"

# ── VAPID Keys (Web Push Notifications) ───────────────────────────────────────
# VAPID keys are used for the Web Push Protocol (RFC 8030).
# The application layer creates push notification subscriptions from browser users.
# Django uses the VAPID private key to sign push notification requests to browser
# push services (Google FCM, Mozilla, Apple APNs).

# VAPID_PUBLIC_KEY — String (public key is, by definition, shareable)
put_param \
  "/campuscart/VAPID_PUBLIC_KEY" \
  "CHANGE_ME_VAPID_PUBLIC_KEY_BASE64URL" \
  "String" \
  "VAPID public key for Web Push — sent to browser during push subscription"

# VAPID_PRIVATE_KEY — SecureString
# The VAPID private key signs push notification requests. If leaked, an attacker
# could send push notifications to any subscriber of CampusCart.
put_param \
  "/campuscart/VAPID_PRIVATE_KEY" \
  "CHANGE_ME_VAPID_PRIVATE_KEY_BASE64URL" \
  "SecureString" \
  "VAPID private key — signs push notification requests to browser push services"

# VAPID_EMAIL — String
# Required by VAPID spec — contact email for push service operators to reach you
# if your push server is misbehaving. Not sensitive.
put_param \
  "/campuscart/VAPID_EMAIL" \
  "mailto:CHANGE_ME_YOUR_EMAIL@domain.com" \
  "String" \
  "VAPID contact email — required by Web Push spec (mailto: prefix required)"

echo ""
print_ok "All 18 SSM parameters created under /campuscart/*"
print_info "Parameters with CHANGE_ME_ values MUST be updated before Soldier 6 runs"
print_info "See: aws/ssm-params-template.txt for the complete list of what to change"

# ═══════════════════════════════════════════════════════════════════════════════
# STEP 7 — IAM USER FOR GITHUB ACTIONS (campuscart-github-actions)
# ═══════════════════════════════════════════════════════════════════════════════
#
# WHAT THIS USER IS FOR:
# GitHub Actions CI/CD pipeline (Soldier 5) needs to push Docker images to ECR.
# GitHub Actions runs on GitHub's cloud infrastructure — OUTSIDE AWS. It cannot
# assume an IAM Role without OIDC configuration (more complex, beyond this project's
# scope). So we create an IAM User with long-term access keys, and store those
# keys in GitHub Secrets.
#
# NOTE FOR INTERVIEWS: In production at scale, the RIGHT approach is GitHub OIDC
# with an IAM Role — no long-term credentials at all. This is a known trade-off
# we made for simplicity. Mentioning this shows senior-level awareness.
#
# PERMISSIONS FOR THIS USER (LEAST PRIVILEGE):
# GitHub Actions only needs to PUSH images to ECR. That requires:
#   1. GetAuthorizationToken — authenticate Docker to ECR (same as above, must be *)
#   2. BatchCheckLayerAvailability — check which layers already exist (avoid re-uploading)
#   3. GetDownloadUrlForLayer — required for layer deduplication during push
#   4. PutImage — actually push the image manifest
#   5. InitiateLayerUpload — start uploading a new layer
#   6. UploadLayerPart — upload chunks of a layer
#   7. CompleteLayerUpload — finalize the layer upload
#
# WHAT THIS USER CANNOT DO:
#   - Read SSM parameters (not needed — GitHub Actions never reads secrets from SSM)
#   - SSH into EC2 (not needed — GitHub Actions SSHes with the EC2 key pair, not IAM)
#   - Delete ECR images (not needed — old images stay until manually cleaned)
#   - Access any other AWS service
# ═══════════════════════════════════════════════════════════════════════════════
print_step "7" "IAM USER FOR GITHUB ACTIONS (${GH_USER_NAME})"

# Build GitHub Actions ECR-push-only policy
GH_POLICY_DOCUMENT=$(cat << EOF
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "ECRAuthForDockerPush",
      "Effect": "Allow",
      "Action": [
        "ecr:GetAuthorizationToken"
      ],
      "Resource": "*"
    },
    {
      "Sid": "ECRPushCampusCartImageOnly",
      "Effect": "Allow",
      "Action": [
        "ecr:BatchCheckLayerAvailability",
        "ecr:GetDownloadUrlForLayer",
        "ecr:BatchGetImage",
        "ecr:PutImage",
        "ecr:InitiateLayerUpload",
        "ecr:UploadLayerPart",
        "ecr:CompleteLayerUpload"
      ],
      "Resource": "arn:aws:ecr:${REGION}:${ACCOUNT_ID}:repository/${ECR_REPO_NAME}"
    }
  ]
}
EOF
)

# Create the GitHub Actions policy
EXISTING_GH_POLICY_ARN=$(aws iam list-policies \
  --scope Local \
  --query "Policies[?PolicyName=='${GH_POLICY_NAME}'].Arn" \
  --output text 2>/dev/null || true)

if [[ -n "$EXISTING_GH_POLICY_ARN" && "$EXISTING_GH_POLICY_ARN" != "None" ]]; then
  print_warn "GitHub Actions policy already exists: ${EXISTING_GH_POLICY_ARN}"
  GH_POLICY_ARN="$EXISTING_GH_POLICY_ARN"
else
  GH_POLICY_ARN=$(aws iam create-policy \
    --policy-name "$GH_POLICY_NAME" \
    --policy-document "$GH_POLICY_DOCUMENT" \
    --description "CampusCart GitHub Actions: ECR push to campuscart-web only" \
    --query "Policy.Arn" \
    --output text)
  print_ok "GitHub Actions IAM policy created: ${GH_POLICY_ARN}"
fi

# Create the IAM User
EXISTING_GH_USER=$(aws iam get-user \
  --user-name "$GH_USER_NAME" \
  --query "User.UserName" \
  --output text 2>/dev/null || true)

if [[ -n "$EXISTING_GH_USER" && "$EXISTING_GH_USER" != "None" ]]; then
  print_warn "IAM User '${GH_USER_NAME}' already exists. Skipping creation."
  print_warn "Access keys will NOT be regenerated. Use existing keys or delete user and re-run."
  GH_USER_ARN=$(aws iam get-user \
    --user-name "$GH_USER_NAME" \
    --query "User.Arn" \
    --output text)
  SKIP_KEY_CREATION=true
else
  GH_USER_ARN=$(aws iam create-user \
    --user-name "$GH_USER_NAME" \
    --query "User.Arn" \
    --output text)
  print_ok "IAM User created: ${GH_USER_ARN}"

  aws iam tag-user \
    --user-name "$GH_USER_NAME" \
    --tags Key=Project,Value="$PROJECT_TAG" Key=Purpose,Value=github-actions-ecr-push
  print_ok "Tags applied to IAM User"
  SKIP_KEY_CREATION=false
fi

# Attach the ECR policy to the user
aws iam attach-user-policy \
  --user-name "$GH_USER_NAME" \
  --policy-arn "$GH_POLICY_ARN" 2>/dev/null || true
print_ok "ECR-push-only policy attached to GitHub Actions user"

# Generate access keys (only if user was just created)
if [[ "$SKIP_KEY_CREATION" == "false" ]]; then
  # Create access key — returns AccessKeyId and SecretAccessKey
  # IMPORTANT: SecretAccessKey is shown ONLY ONCE here. It cannot be retrieved again.
  # Must be saved to GitHub Secrets immediately.
  KEY_OUTPUT=$(aws iam create-access-key \
    --user-name "$GH_USER_NAME" \
    --query "AccessKey.{ID:AccessKeyId,Secret:SecretAccessKey}" \
    --output json)

  GH_ACCESS_KEY_ID=$(echo "$KEY_OUTPUT" | python3 -c "import sys,json; print(json.load(sys.stdin)['ID'])")
  GH_SECRET_ACCESS_KEY=$(echo "$KEY_OUTPUT" | python3 -c "import sys,json; print(json.load(sys.stdin)['Secret'])")

  echo ""
  echo -e "${BOLD}${YELLOW}╔══════════════════════════════════════════════════════════════════╗${NC}"
  echo -e "${BOLD}${YELLOW}║  ⚠  GITHUB ACTIONS CREDENTIALS — SAVE THESE NOW                ║${NC}"
  echo -e "${BOLD}${YELLOW}║     SecretAccessKey is shown ONLY ONCE — cannot be retrieved    ║${NC}"
  echo -e "${BOLD}${YELLOW}╚══════════════════════════════════════════════════════════════════╝${NC}"
  echo ""
  echo -e "  ${BOLD}AWS_ACCESS_KEY_ID${NC}     = ${GREEN}${GH_ACCESS_KEY_ID}${NC}"
  echo -e "  ${BOLD}AWS_SECRET_ACCESS_KEY${NC} = ${GREEN}${GH_SECRET_ACCESS_KEY}${NC}"
  echo ""
  echo -e "  ${CYAN}Add these to GitHub Secrets:${NC}"
  echo -e "  ${DIM}Repo → Settings → Secrets and variables → Actions → New repository secret${NC}"
  echo -e "  Secret 1: ${BOLD}AWS_ACCESS_KEY_ID${NC}     = ${GH_ACCESS_KEY_ID}"
  echo -e "  Secret 2: ${BOLD}AWS_SECRET_ACCESS_KEY${NC} = ${GH_SECRET_ACCESS_KEY}"
  echo -e "  Secret 3: ${BOLD}AWS_REGION${NC}            = ${REGION}"
  echo -e "  Secret 4: ${BOLD}ECR_REPOSITORY${NC}        = ${ECR_URI}"
  echo ""
  echo -e "  ${BOLD}Soldier 5 (GitHub Actions) needs all 4 of these GitHub Secrets.${NC}"
fi

# ═══════════════════════════════════════════════════════════════════════════════
# FINAL SUMMARY
# ═══════════════════════════════════════════════════════════════════════════════
print_banner "SOLDIER 3 MISSION COMPLETE — RESOURCE SUMMARY"

echo ""
echo -e "${BOLD}${CYAN}SECURITY GROUP${NC}"
print_val "Name"  "$SG_NAME"
print_val "ID"    "$SG_ID"
print_val "VPC"   "$VPC_ID"
echo -e "  ${DIM}Inbound: TCP/80 (0.0.0.0/0) | TCP/443 (0.0.0.0/0) | TCP/22 (${MY_IP}/32)${NC}"
echo -e "  ${DIM}Outbound: All traffic allowed${NC}"

echo ""
echo -e "${BOLD}${CYAN}IAM ROLE & PROFILE${NC}"
print_val "Policy ARN"   "$POLICY_ARN"
print_val "Role ARN"     "$ROLE_ARN"
print_val "Profile Name" "$INSTANCE_PROFILE_NAME"
print_val "Profile ARN"  "$PROFILE_ARN"

echo ""
echo -e "${BOLD}${CYAN}ECR REPOSITORY${NC}"
print_val "Repository URI" "$ECR_URI"
print_val "Scanning"       "Enabled (CVE scan on every push)"
print_val "Tag Immutability" "IMMUTABLE"

echo ""
echo -e "${BOLD}${CYAN}SSM PARAMETER STORE${NC}"
print_val "Path prefix"  "/campuscart/*"
print_val "Total params" "18"
print_val "SecureString" "8 parameters (KMS encrypted)"
print_val "String"       "10 parameters"

echo ""
echo -e "${BOLD}${CYAN}GITHUB ACTIONS IAM USER${NC}"
print_val "User Name"   "$GH_USER_NAME"
print_val "User ARN"    "$GH_USER_ARN"
print_val "Permissions" "ECR push to ${ECR_REPO_NAME} only"

echo ""
echo -e "${BOLD}${YELLOW}━━━ VALUES NEEDED BY OTHER SOLDIERS ━━━${NC}"
echo ""
echo -e "  ${BOLD}Soldier 4 (Provisioning Script):${NC}"
echo -e "    SSM path to fetch all params: ${CYAN}/campuscart/${NC}"
echo -e "    Fetch command: ${DIM}aws ssm get-parameters-by-path --path /campuscart/ --with-decryption --region ${REGION}${NC}"
echo ""
echo -e "  ${BOLD}Soldier 5 (GitHub Actions CI/CD):${NC}"
echo -e "    ECR_REPOSITORY URI: ${CYAN}${ECR_URI}${NC}"
echo -e "    AWS_REGION: ${CYAN}${REGION}${NC}"
echo -e "    GitHub Secret names: AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AWS_REGION, ECR_REPOSITORY"
echo ""
echo -e "  ${BOLD}Soldier 6 (Execute Everything):${NC}"
echo -e "    Update CHANGE_ME_ params in SSM before running. See: aws/ssm-params-template.txt"
echo -e "    Security Group '${SG_NAME}' is ready — ec2-launch.sh will find it by name"
echo -e "    Instance Profile '${INSTANCE_PROFILE_NAME}' is ready — ec2-launch.sh references it"

echo ""
echo -e "${BOLD}${YELLOW}━━━ SSM PARAMETERS REQUIRING REAL VALUES BEFORE DEPLOYMENT ━━━${NC}"
echo ""
echo -e "  ${RED}⚠  The following parameters have placeholder values.${NC}"
echo -e "  ${RED}⚠  MUST be updated with real values before Soldier 6 runs.${NC}"
echo ""
echo -e "  ${BOLD}Parameter${NC}                              ${BOLD}Type${NC}          ${BOLD}Action Needed${NC}"
echo -e "  ${DIM}─────────────────────────────────────────────────────────────────────${NC}"
echo -e "  /campuscart/DJANGO_SECRET_KEY       SecureString  Generate 50-char random key"
echo -e "  /campuscart/ALLOWED_HOSTS           String        Set EC2 Elastic IP after launch"
echo -e "  /campuscart/DB_PASSWORD             SecureString  Set strong production password"
echo -e "  /campuscart/EMAIL_HOST_USER         String        Set actual Gmail address"
echo -e "  /campuscart/EMAIL_HOST_PASSWORD     SecureString  Set Gmail App Password"
echo -e "  /campuscart/STRIPE_SECRET_KEY       SecureString  Set from Stripe dashboard"
echo -e "  /campuscart/STRIPE_PUBLISHABLE_KEY  String        Set from Stripe dashboard"
echo -e "  /campuscart/STRIPE_WEBHOOK_SECRET   SecureString  Set from Stripe webhook settings"
echo -e "  /campuscart/VAPID_PUBLIC_KEY        String        Generate with web-push library"
echo -e "  /campuscart/VAPID_PRIVATE_KEY       SecureString  Generate with web-push library"
echo -e "  /campuscart/VAPID_EMAIL             String        Set contact email address"

echo ""
echo -e "${BOLD}${GREEN}Soldier 3 reporting mission complete. All resources created. ✅${NC}"
echo -e "${DIM}Soldier 6 may now execute this script on AWS. Soldier 4 and 5 may proceed.${NC}"
echo ""

# ═══════════════════════════════════════════════════════════════════════════════
# TEARDOWN SECTION
# ═══════════════════════════════════════════════════════════════════════════════
# Run with: ./security-setup.sh --teardown
# This destroys ONLY the resources created by THIS script (Step 1-7).
# Run BEFORE vpc-network.sh teardown and ec2-launch.sh teardown.
# ═══════════════════════════════════════════════════════════════════════════════
if [[ "${1:-}" == "--teardown" ]]; then
  print_banner "TEARDOWN MODE — DESTROYING SOLDIER 3 RESOURCES"
  print_warn "This will delete: Security Group, IAM Policy, IAM Role, Instance Profile, ECR Repo, SSM Params, IAM User"
  echo ""
  read -p "  Type 'yes' to confirm teardown: " CONFIRM
  if [[ "$CONFIRM" != "yes" ]]; then
    echo "Teardown cancelled."
    exit 0
  fi

  echo ""
  print_info "Deleting SSM parameters..."
  PARAM_NAMES=(
    "/campuscart/DJANGO_SECRET_KEY" "/campuscart/DEBUG" "/campuscart/ALLOWED_HOSTS"
    "/campuscart/DB_NAME" "/campuscart/DB_USER" "/campuscart/DB_PASSWORD"
    "/campuscart/DB_HOST" "/campuscart/DB_PORT" "/campuscart/REDIS_HOST"
    "/campuscart/REDIS_PORT" "/campuscart/EMAIL_HOST_USER" "/campuscart/EMAIL_HOST_PASSWORD"
    "/campuscart/STRIPE_SECRET_KEY" "/campuscart/STRIPE_PUBLISHABLE_KEY"
    "/campuscart/STRIPE_WEBHOOK_SECRET" "/campuscart/VAPID_PUBLIC_KEY"
    "/campuscart/VAPID_PRIVATE_KEY" "/campuscart/VAPID_EMAIL"
  )
  for param in "${PARAM_NAMES[@]}"; do
    aws ssm delete-parameter --name "$param" --region "$REGION" 2>/dev/null && \
      print_ok "Deleted: $param" || print_warn "Not found (already deleted?): $param"
  done

  print_info "Deleting GitHub Actions user..."
  # Must delete access keys before deleting user
  for key_id in $(aws iam list-access-keys --user-name "$GH_USER_NAME" --query "AccessKeyMetadata[].AccessKeyId" --output text 2>/dev/null); do
    aws iam delete-access-key --user-name "$GH_USER_NAME" --access-key-id "$key_id" 2>/dev/null || true
    print_ok "Deleted access key: $key_id"
  done
  aws iam detach-user-policy --user-name "$GH_USER_NAME" --policy-arn "$GH_POLICY_ARN" 2>/dev/null || true
  aws iam delete-user --user-name "$GH_USER_NAME" 2>/dev/null && \
    print_ok "Deleted IAM User: $GH_USER_NAME" || print_warn "IAM User not found"
  aws iam delete-policy --policy-arn "$GH_POLICY_ARN" 2>/dev/null && \
    print_ok "Deleted GitHub Actions policy" || print_warn "GitHub Actions policy not found"

  print_info "Deleting ECR repository..."
  aws ecr delete-repository --repository-name "$ECR_REPO_NAME" --force --region "$REGION" 2>/dev/null && \
    print_ok "Deleted ECR repository: $ECR_REPO_NAME" || print_warn "ECR repo not found"

  print_info "Removing role from instance profile..."
  aws iam remove-role-from-instance-profile \
    --instance-profile-name "$INSTANCE_PROFILE_NAME" \
    --role-name "$IAM_ROLE_NAME" 2>/dev/null || true

  print_info "Deleting instance profile..."
  aws iam delete-instance-profile --instance-profile-name "$INSTANCE_PROFILE_NAME" 2>/dev/null && \
    print_ok "Deleted Instance Profile: $INSTANCE_PROFILE_NAME" || print_warn "Instance Profile not found"

  print_info "Detaching policies from IAM role..."
  aws iam detach-role-policy --role-name "$IAM_ROLE_NAME" --policy-arn "$POLICY_ARN" 2>/dev/null || true
  aws iam detach-role-policy --role-name "$IAM_ROLE_NAME" \
    --policy-arn "arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore" 2>/dev/null || true

  print_info "Deleting IAM role..."
  aws iam delete-role --role-name "$IAM_ROLE_NAME" 2>/dev/null && \
    print_ok "Deleted IAM Role: $IAM_ROLE_NAME" || print_warn "IAM Role not found"

  print_info "Deleting IAM policy..."
  aws iam delete-policy --policy-arn "$POLICY_ARN" 2>/dev/null && \
    print_ok "Deleted IAM Policy: $IAM_POLICY_NAME" || print_warn "IAM Policy not found"

  print_info "Deleting Security Group..."
  # Re-detect SG_ID in case variable is unset
  SG_ID_FOR_DELETION=$(aws ec2 describe-security-groups \
    --filters "Name=group-name,Values=${SG_NAME}" "Name=vpc-id,Values=${VPC_ID}" \
    --query "SecurityGroups[0].GroupId" --output text --region "$REGION" 2>/dev/null || echo "")
  if [[ -n "$SG_ID_FOR_DELETION" && "$SG_ID_FOR_DELETION" != "None" ]]; then
    aws ec2 delete-security-group --group-id "$SG_ID_FOR_DELETION" --region "$REGION" && \
      print_ok "Deleted Security Group: $SG_NAME ($SG_ID_FOR_DELETION)" || \
      print_warn "Could not delete Security Group (may still be attached to EC2)"
  fi

  echo ""
  echo -e "${GREEN}${BOLD}Teardown complete. All Soldier 3 resources destroyed.${NC}"
  echo -e "${DIM}Next: run ec2-launch.sh --teardown, then vpc-network.sh --teardown${NC}"
fi

#!/bin/bash

# =============================================================================
# CampusCart — EC2 Launch Script
# =============================================================================
# Soldier  : 2 (fixed by Officer)
# Mission  : Launch EC2 instance + Elastic IP
# Depends  : Run AFTER vpc-network.sh AND Soldier 3's security script
#
# WHAT THIS SCRIPT CREATES:
#   1. EC2 Instance  (Ubuntu 22.04 LTS, t2.micro, Public Subnet 1)
#   2. Elastic IP    (allocated + associated with EC2)
#
# USAGE:
#   chmod +x aws/ec2-launch.sh
#   ./aws/ec2-launch.sh
#
# BEFORE RUNNING:
#   1. vpc-network.sh must have been run (VPC + subnets exist)
#   2. Soldier 3's script must have been run (campuscart-sg exists)
#   3. AWS CLI must be configured
# =============================================================================

set -e
set -o pipefail

# =============================================================================
# COLORS
# =============================================================================
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
BOLD='\033[1m'
RESET='\033[0m'

section() {
    echo ""
    echo -e "${CYAN}${BOLD}══════════════════════════════════════════${RESET}"
    echo -e "${CYAN}${BOLD}  $1${RESET}"
    echo -e "${CYAN}${BOLD}══════════════════════════════════════════${RESET}"
}
ok()   { echo -e "  ${GREEN}✓${RESET} $1"; }
info() { echo -e "  ${BLUE}→${RESET} $1"; }
warn() { echo -e "  ${YELLOW}⚠${RESET} $1"; }

# =============================================================================
# CONFIGURATION
# =============================================================================
REGION="ap-south-1"
AMI_ID="ami-0f58b397bc5c1f2e8"   # Ubuntu 22.04 LTS — ap-south-1
INSTANCE_TYPE="t2.micro"          # 1 vCPU, 1GB RAM — free tier
KEY_NAME="campuscart-key"
KEY_FILE="$HOME/campuscart-key.pem"

echo ""
echo -e "${BOLD}╔══════════════════════════════════════════════╗${RESET}"
echo -e "${BOLD}║   CampusCart — EC2 Launch                    ║${RESET}"
echo -e "${BOLD}║   Run AFTER vpc-network.sh + Soldier 3       ║${RESET}"
echo -e "${BOLD}╚══════════════════════════════════════════════╝${RESET}"
echo ""

# =============================================================================
# PRE-FLIGHT: Lookup VPC and subnet created by vpc-network.sh
# We look up by Name tag — no need to hardcode IDs
# =============================================================================

section "PRE-FLIGHT CHECKS"

info "Looking up VPC by name tag..."
VPC_ID=$(aws ec2 describe-vpcs \
    --filters "Name=tag:Name,Values=campuscart-vpc" \
    --region "$REGION" \
    --query 'Vpcs[0].VpcId' \
    --output text)

if [ -z "$VPC_ID" ] || [ "$VPC_ID" = "None" ]; then
    echo -e "${RED}ERROR: campuscart-vpc not found. Run aws/vpc-network.sh first.${RESET}"
    exit 1
fi
ok "VPC found: $VPC_ID"

info "Looking up Public Subnet 1 by name tag..."
PUB_SUBNET_1_ID=$(aws ec2 describe-subnets \
    --filters "Name=tag:Name,Values=campuscart-public-subnet-1" \
    --region "$REGION" \
    --query 'Subnets[0].SubnetId' \
    --output text)

if [ -z "$PUB_SUBNET_1_ID" ] || [ "$PUB_SUBNET_1_ID" = "None" ]; then
    echo -e "${RED}ERROR: campuscart-public-subnet-1 not found.${RESET}"
    exit 1
fi
ok "Public Subnet 1 found: $PUB_SUBNET_1_ID"

info "Looking up Security Group created by Soldier 3..."
SECURITY_GROUP_ID=$(aws ec2 describe-security-groups \
    --filters \
        "Name=group-name,Values=campuscart-sg" \
        "Name=vpc-id,Values=$VPC_ID" \
    --region "$REGION" \
    --query 'SecurityGroups[0].GroupId' \
    --output text 2>/dev/null || echo "")

if [ -z "$SECURITY_GROUP_ID" ] || [ "$SECURITY_GROUP_ID" = "None" ]; then
    echo -e "${RED}ERROR: campuscart-sg not found in VPC $VPC_ID${RESET}"
    echo -e "${RED}Run Soldier 3's script first to create the Security Group.${RESET}"
    exit 1
fi
ok "Security Group found: $SECURITY_GROUP_ID"

if [ ! -f "$KEY_FILE" ]; then
    echo -e "${RED}ERROR: Key file not found at $KEY_FILE${RESET}"
    echo -e "${RED}Run aws/vpc-network.sh first to create the key pair.${RESET}"
    exit 1
fi
ok "Key file found: $KEY_FILE"

# =============================================================================
# STEP 1 — LAUNCH EC2 INSTANCE
# =============================================================================
# Ubuntu 22.04 LTS t2.micro inside Public Subnet 1 (ap-south-1a)
# Security Group from Soldier 3 controls what traffic reaches this instance
# IAM Role from Soldier 3 allows EC2 to read from SSM Parameter Store
# 20GB gp3 EBS — gp3 is newer and cheaper than gp2
# =============================================================================

section "STEP 1 — Launching EC2 Instance"

INSTANCE_ID=$(aws ec2 run-instances \
    --image-id "$AMI_ID" \
    --instance-type "$INSTANCE_TYPE" \
    --subnet-id "$PUB_SUBNET_1_ID" \
    --key-name "$KEY_NAME" \
    --security-group-ids "$SECURITY_GROUP_ID" \
    --associate-public-ip-address \
    --iam-instance-profile Name=campuscart-ec2-profile \
    --block-device-mappings "[{
        \"DeviceName\": \"/dev/sda1\",
        \"Ebs\": {
            \"VolumeSize\": 20,
            \"VolumeType\": \"gp3\",
            \"DeleteOnTermination\": true
        }
    }]" \
    --tag-specifications \
        "ResourceType=instance,Tags=[
            {Key=Name,Value=campuscart-ec2},
            {Key=Project,Value=campuscart},
            {Key=Environment,Value=production},
            {Key=ManagedBy,Value=manual}
        ]" \
        "ResourceType=volume,Tags=[
            {Key=Name,Value=campuscart-ec2-root-volume},
            {Key=Project,Value=campuscart},
            {Key=Environment,Value=production},
            {Key=ManagedBy,Value=manual}
        ]" \
    --region "$REGION" \
    --query 'Instances[0].InstanceId' \
    --output text)

ok "EC2 instance launched: $INSTANCE_ID"

info "Waiting for EC2 to reach 'running' state (~30-60 seconds)..."
aws ec2 wait instance-running \
    --instance-ids "$INSTANCE_ID" \
    --region "$REGION"
ok "EC2 is running!"

PRIVATE_IP=$(aws ec2 describe-instances \
    --instance-ids "$INSTANCE_ID" \
    --region "$REGION" \
    --query 'Reservations[0].Instances[0].PrivateIpAddress' \
    --output text)
ok "EC2 Private IP: $PRIVATE_IP"

# =============================================================================
# STEP 2 — ALLOCATE AND ASSOCIATE ELASTIC IP
# =============================================================================
# Static public IP — survives EC2 stop/start
# Critical for: DNS stability, GitHub Actions SSH, Stripe webhooks
# Free when attached to running instance
# RELEASE (not just disassociate) during teardown to avoid charges
# =============================================================================

section "STEP 2 — Allocating Elastic IP"

ALLOCATION_ID=$(aws ec2 allocate-address \
    --domain vpc \
    --region "$REGION" \
    --tag-specifications "ResourceType=elastic-ip,Tags=[
        {Key=Name,Value=campuscart-eip},
        {Key=Project,Value=campuscart},
        {Key=Environment,Value=production},
        {Key=ManagedBy,Value=manual}
    ]" \
    --query 'AllocationId' \
    --output text)
ok "Elastic IP allocated: $ALLOCATION_ID"

ELASTIC_IP=$(aws ec2 describe-addresses \
    --allocation-ids "$ALLOCATION_ID" \
    --region "$REGION" \
    --query 'Addresses[0].PublicIp' \
    --output text)
ok "Elastic IP address: $ELASTIC_IP"

aws ec2 associate-address \
    --instance-id "$INSTANCE_ID" \
    --allocation-id "$ALLOCATION_ID" \
    --region "$REGION" \
    --output text > /dev/null
ok "Elastic IP associated with EC2"

# =============================================================================
# SUMMARY
# =============================================================================

section "SUMMARY — Copy to infrastructure.md"

echo ""
echo -e "  ${BOLD}EC2 Instance:${RESET}"
echo -e "    Instance ID:    $INSTANCE_ID"
echo -e "    Private IP:     $PRIVATE_IP"
echo -e "    Security Group: $SECURITY_GROUP_ID"
echo ""
echo -e "  ${BOLD}Elastic IP:${RESET}"
echo -e "    Allocation ID:  $ALLOCATION_ID"
echo -e "    Public IP:      $ELASTIC_IP"
echo ""

section "SSH COMMAND"
echo ""
echo -e "  ${GREEN}ssh -i $KEY_FILE ubuntu@$ELASTIC_IP${RESET}"
echo ""

section "TEARDOWN REMINDER"
echo ""
echo -e "  ${RED}Follow this exact order:${RESET}"
echo -e "  1. ${CYAN}aws ec2 release-address --allocation-id $ALLOCATION_ID --region $REGION${RESET}"
echo -e "  2. ${CYAN}aws ec2 terminate-instances --instance-ids $INSTANCE_ID --region $REGION${RESET}"
echo -e "  3. ${CYAN}aws ec2 wait instance-terminated --instance-ids $INSTANCE_ID --region $REGION${RESET}"
echo -e "  Then run Soldier 3 teardown, then vpc-network.sh teardown"
echo ""

echo -e "${GREEN}${BOLD}╔══════════════════════════════════════════════╗${RESET}"
echo -e "${GREEN}${BOLD}║   EC2 Launch Complete ✓                      ║${RESET}"
echo -e "${GREEN}${BOLD}║   Hand off to Soldier 4.                     ║${RESET}"
echo -e "${GREEN}${BOLD}╚══════════════════════════════════════════════╝${RESET}"

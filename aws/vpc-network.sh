#!/bin/bash

# =============================================================================
# CampusCart - AWS Infrastructure Setup Script
# =============================================================================
# Soldier  : 2
# Mission  : VPC + Networking + EC2
# Executed : Soldier 6 runs this ONCE on a clean AWS account
# Region   : ap-south-1 (Mumbai) - closest to Bangalore
# Author   : Soldier 2
#
# WHAT THIS SCRIPT CREATES (in order):
#   1. VPC                 (10.0.0.0/16)
#   2. Public Subnet 1     (10.0.1.0/24 - ap-south-1a) ← EC2 lives here
#   3. Public Subnet 2     (10.0.2.0/24 - ap-south-1b)
#   4. Private Subnet 1    (10.0.3.0/24 - ap-south-1a)
#   5. Private Subnet 2    (10.0.4.0/24 - ap-south-1b)
#   6. Internet Gateway    (attached to VPC)
#   7. Public Route Table  (0.0.0.0/0 → IGW)
#   8. Private Route Table (local only - no internet)
#   9. Key Pair            (saved to ~/campuscart-key.pem)
#  10. EC2 Instance        (Ubuntu 22.04 LTS, t2.micro, Public Subnet 1)
#  11. Elastic IP          (allocated + associated with EC2)
#
# NOTE: Security Group is created by Soldier 3.
#       This script references it but does NOT create it.
#
# USAGE:
#   chmod +x vpc-setup.sh
#   ./vpc-setup.sh
#
# BEFORE RUNNING:
#   - AWS CLI must be configured (aws configure)
#   - Region must be ap-south-1
#   - Verify with: aws sts get-caller-identity
# =============================================================================

set -e  # Exit immediately if any command fails - no silent errors
set -o pipefail  # Catch errors in pipes too

# =============================================================================
# COLORS - for readable terminal output
# =============================================================================
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
BOLD='\033[1m'
RESET='\033[0m'

# =============================================================================
# HELPER FUNCTIONS
# =============================================================================

# Print a section header - makes terminal output readable
section() {
    echo ""
    echo -e "${CYAN}${BOLD}══════════════════════════════════════════${RESET}"
    echo -e "${CYAN}${BOLD}  $1${RESET}"
    echo -e "${CYAN}${BOLD}══════════════════════════════════════════${RESET}"
}

# Print a success message
ok() {
    echo -e "  ${GREEN}✓${RESET} $1"
}

# Print an info message
info() {
    echo -e "  ${BLUE}→${RESET} $1"
}

# Print a warning
warn() {
    echo -e "  ${YELLOW}⚠${RESET} $1"
}

# =============================================================================
# CONFIGURATION - all values defined here, commands reference these variables
# Never hardcode values inside commands
# =============================================================================

REGION="ap-south-1"                    # Mumbai - closest AWS region to Bangalore

VPC_CIDR="10.0.0.0/16"                # /16 = 65,536 IPs for the entire VPC

PUB_SUBNET_1_CIDR="10.0.1.0/24"      # Public Subnet 1 - EC2 lives here
PUB_SUBNET_1_AZ="ap-south-1a"        # AZ 1 - active AZ

PUB_SUBNET_2_CIDR="10.0.2.0/24"      # Public Subnet 2 - reserved for future LB
PUB_SUBNET_2_AZ="ap-south-1b"        # AZ 2 - second AZ for HA design

PRIV_SUBNET_1_CIDR="10.0.3.0/24"     # Private Subnet 1 - reserved for future RDS
PRIV_SUBNET_1_AZ="ap-south-1a"       # Same AZ as Public Subnet 1

PRIV_SUBNET_2_CIDR="10.0.4.0/24"     # Private Subnet 2 - reserved for future RDS
PRIV_SUBNET_2_AZ="ap-south-1b"       # Same AZ as Public Subnet 2

KEY_NAME="campuscart-key"             # SSH key pair name
KEY_FILE="$HOME/campuscart-key.pem"   # Where to save the private key locally

# Ubuntu 22.04 LTS AMI ID for ap-south-1 (Mumbai)
# This is the official Canonical Ubuntu AMI as of 2025
# LTS = Long Term Support - security updates until April 2027
# IMPORTANT: AMI IDs are region-specific. This ID only works in ap-south-1
AMI_ID="ami-0f58b397bc5c1f2e8"

INSTANCE_TYPE="t2.micro"              # 1 vCPU, 1GB RAM - free tier eligible

# =============================================================================
# SCRIPT START
# =============================================================================

echo ""
echo -e "${BOLD}╔══════════════════════════════════════════════╗${RESET}"
echo -e "${BOLD}║   CampusCart AWS Infrastructure Setup        ║${RESET}"
echo -e "${BOLD}║   Soldier 2 - VPC + Networking + EC2         ║${RESET}"
echo -e "${BOLD}╚══════════════════════════════════════════════╝${RESET}"
echo ""

# Verify AWS CLI is configured and working before doing anything
info "Verifying AWS CLI configuration..."
CALLER=$(aws sts get-caller-identity --query 'Arn' --output text 2>/dev/null)
if [ -z "$CALLER" ]; then
    echo -e "${RED}ERROR: AWS CLI not configured. Run 'aws configure' first.${RESET}"
    exit 1
fi
ok "AWS CLI working - Identity: $CALLER"

# Verify we are in the correct region
CONFIGURED_REGION=$(aws configure get region)
if [ "$CONFIGURED_REGION" != "$REGION" ]; then
    echo -e "${RED}ERROR: Wrong region. Expected ap-south-1, got $CONFIGURED_REGION${RESET}"
    echo -e "${RED}Run: aws configure set region ap-south-1${RESET}"
    exit 1
fi
ok "Region verified: $REGION"

# =============================================================================
# STEP 1 - CREATE VPC
# =============================================================================
# A VPC (Virtual Private Cloud) is our private isolated network inside AWS.
# CIDR 10.0.0.0/16 gives us 65,536 IP addresses.
# 10.x.x.x is RFC 1918 private address space - not publicly routable.
# DNS hostnames: lets EC2 instances get human-readable DNS names inside VPC.
# DNS resolution: enables the VPC's internal DNS resolver (at base+2 address).
# =============================================================================

section "STEP 1 - Creating VPC"

# Create the VPC with our CIDR block and tags
# --query extracts just the VPC ID from the JSON response
# --output text returns it as plain text (no quotes)
VPC_ID=$(aws ec2 create-vpc \
    --cidr-block "$VPC_CIDR" \
    --region "$REGION" \
    --tag-specifications "ResourceType=vpc,Tags=[
        {Key=Name,Value=campuscart-vpc},
        {Key=Project,Value=campuscart},
        {Key=Environment,Value=production},
        {Key=ManagedBy,Value=manual}
    ]" \
    --query 'Vpc.VpcId' \
    --output text)

ok "VPC created: $VPC_ID"

# Enable DNS hostnames - allows EC2 instances in this VPC to get
# public DNS names like ec2-x-x-x-x.ap-south-1.compute.amazonaws.com
# Required for some AWS services and good practice in general
aws ec2 modify-vpc-attribute \
    --vpc-id "$VPC_ID" \
    --enable-dns-hostnames "{\"Value\":true}" \
    --region "$REGION"

ok "DNS hostnames enabled on VPC"

# Enable DNS resolution - enables the VPC's internal DNS server
# (always at base CIDR + 2, i.e. 10.0.0.2 for our VPC)
# This lets instances resolve both AWS internal names and public DNS
aws ec2 modify-vpc-attribute \
    --vpc-id "$VPC_ID" \
    --enable-dns-support "{\"Value\":true}" \
    --region "$REGION"

ok "DNS resolution enabled on VPC"

# =============================================================================
# STEP 2 - CREATE SUBNETS
# =============================================================================
# Subnets divide the VPC into smaller network segments.
# Public subnets: have a route to the Internet Gateway → EC2/LB go here
# Private subnets: no internet route → databases/cache go here
# We create subnets in 2 AZs for high availability design.
# Each /24 gives 256 IPs total, 251 usable (AWS reserves 5 per subnet).
# =============================================================================

section "STEP 2 - Creating Subnets"

# ── PUBLIC SUBNET 1 (ap-south-1a) ──
# This is where our EC2 instance lives.
# ap-south-1a is the primary active AZ for CampusCart.
PUB_SUBNET_1_ID=$(aws ec2 create-subnet \
    --vpc-id "$VPC_ID" \
    --cidr-block "$PUB_SUBNET_1_CIDR" \
    --availability-zone "$PUB_SUBNET_1_AZ" \
    --region "$REGION" \
    --tag-specifications "ResourceType=subnet,Tags=[
        {Key=Name,Value=campuscart-public-subnet-1},
        {Key=Project,Value=campuscart},
        {Key=Environment,Value=production},
        {Key=ManagedBy,Value=manual},
        {Key=Type,Value=public}
    ]" \
    --query 'Subnet.SubnetId' \
    --output text)

ok "Public Subnet 1 created: $PUB_SUBNET_1_ID ($PUB_SUBNET_1_CIDR - $PUB_SUBNET_1_AZ)"

# Enable auto-assign public IP on Public Subnet 1
# Any EC2 launched in this subnet automatically gets a public IP.
# We additionally attach an Elastic IP for a STATIC public IP.
# Without this setting, EC2 would only have a private IP.
aws ec2 modify-subnet-attribute \
    --subnet-id "$PUB_SUBNET_1_ID" \
    --map-public-ip-on-launch \
    --region "$REGION"

ok "Auto-assign public IP enabled on Public Subnet 1"

# ── PUBLIC SUBNET 2 (ap-south-1b) ──
# Reserved for future use: Load Balancer, additional EC2 in second AZ.
# Exists now to satisfy multi-AZ architecture design in the resume.
PUB_SUBNET_2_ID=$(aws ec2 create-subnet \
    --vpc-id "$VPC_ID" \
    --cidr-block "$PUB_SUBNET_2_CIDR" \
    --availability-zone "$PUB_SUBNET_2_AZ" \
    --region "$REGION" \
    --tag-specifications "ResourceType=subnet,Tags=[
        {Key=Name,Value=campuscart-public-subnet-2},
        {Key=Project,Value=campuscart},
        {Key=Environment,Value=production},
        {Key=ManagedBy,Value=manual},
        {Key=Type,Value=public}
    ]" \
    --query 'Subnet.SubnetId' \
    --output text)

ok "Public Subnet 2 created: $PUB_SUBNET_2_ID ($PUB_SUBNET_2_CIDR - $PUB_SUBNET_2_AZ)"

# Enable auto-assign public IP on Public Subnet 2 as well
aws ec2 modify-subnet-attribute \
    --subnet-id "$PUB_SUBNET_2_ID" \
    --map-public-ip-on-launch \
    --region "$REGION"

ok "Auto-assign public IP enabled on Public Subnet 2"

# ── PRIVATE SUBNET 1 (ap-south-1a) ──
# Reserved for future RDS (PostgreSQL managed) in ap-south-1a.
# No internet route will be associated - completely isolated from internet.
# Resources here can only be reached from within the VPC.
PRIV_SUBNET_1_ID=$(aws ec2 create-subnet \
    --vpc-id "$VPC_ID" \
    --cidr-block "$PRIV_SUBNET_1_CIDR" \
    --availability-zone "$PRIV_SUBNET_1_AZ" \
    --region "$REGION" \
    --tag-specifications "ResourceType=subnet,Tags=[
        {Key=Name,Value=campuscart-private-subnet-1},
        {Key=Project,Value=campuscart},
        {Key=Environment,Value=production},
        {Key=ManagedBy,Value=manual},
        {Key=Type,Value=private}
    ]" \
    --query 'Subnet.SubnetId' \
    --output text)

ok "Private Subnet 1 created: $PRIV_SUBNET_1_ID ($PRIV_SUBNET_1_CIDR - $PRIV_SUBNET_1_AZ)"

# ── PRIVATE SUBNET 2 (ap-south-1b) ──
# Reserved for future RDS replica in ap-south-1b (multi-AZ RDS standby).
# Same - no internet route, completely private.
PRIV_SUBNET_2_ID=$(aws ec2 create-subnet \
    --vpc-id "$VPC_ID" \
    --cidr-block "$PRIV_SUBNET_2_CIDR" \
    --availability-zone "$PRIV_SUBNET_2_AZ" \
    --region "$REGION" \
    --tag-specifications "ResourceType=subnet,Tags=[
        {Key=Name,Value=campuscart-private-subnet-2},
        {Key=Project,Value=campuscart},
        {Key=Environment,Value=production},
        {Key=ManagedBy,Value=manual},
        {Key=Type,Value=private}
    ]" \
    --query 'Subnet.SubnetId' \
    --output text)

ok "Private Subnet 2 created: $PRIV_SUBNET_2_ID ($PRIV_SUBNET_2_CIDR - $PRIV_SUBNET_2_AZ)"

# =============================================================================
# STEP 3 - CREATE AND ATTACH INTERNET GATEWAY
# =============================================================================
# The Internet Gateway (IGW) is the bridge between our VPC and the internet.
# Without it, the VPC is completely sealed - no inbound or outbound internet.
# One IGW per VPC - AWS hard limit.
# The IGW performs 1:1 NAT: maps Elastic IP ↔ EC2 private IP at network level.
# It is fully managed by AWS - no maintenance, no HA concern, no hourly cost.
# =============================================================================

section "STEP 3 - Creating Internet Gateway"

# Create the Internet Gateway
# It starts in a "detached" state - must be explicitly attached to a VPC
IGW_ID=$(aws ec2 create-internet-gateway \
    --region "$REGION" \
    --tag-specifications "ResourceType=internet-gateway,Tags=[
        {Key=Name,Value=campuscart-igw},
        {Key=Project,Value=campuscart},
        {Key=Environment,Value=production},
        {Key=ManagedBy,Value=manual}
    ]" \
    --query 'InternetGateway.InternetGatewayId' \
    --output text)

ok "Internet Gateway created: $IGW_ID"

# Attach the IGW to our VPC
# Until this step, the IGW exists but does nothing.
# After attachment, route tables can point traffic to it.
aws ec2 attach-internet-gateway \
    --internet-gateway-id "$IGW_ID" \
    --vpc-id "$VPC_ID" \
    --region "$REGION"

ok "Internet Gateway attached to VPC ($VPC_ID)"

# =============================================================================
# STEP 4 - CREATE ROUTE TABLES AND ASSOCIATE SUBNETS
# =============================================================================
# Route tables decide where network packets go.
# Every subnet must be associated with exactly one route table.
# Public RT:  has 0.0.0.0/0 → IGW - this is what makes a subnet "public"
# Private RT: has only local route - no internet - this makes it "private"
# The local route (10.0.0.0/16 → local) is automatically added to every RT.
# =============================================================================

section "STEP 4 - Creating Route Tables"

# ── PUBLIC ROUTE TABLE ──
# This route table will be associated with both public subnets.
# The 0.0.0.0/0 → IGW route is what enables internet access.
PUB_RT_ID=$(aws ec2 create-route-table \
    --vpc-id "$VPC_ID" \
    --region "$REGION" \
    --tag-specifications "ResourceType=route-table,Tags=[
        {Key=Name,Value=campuscart-public-rt},
        {Key=Project,Value=campuscart},
        {Key=Environment,Value=production},
        {Key=ManagedBy,Value=manual}
    ]" \
    --query 'RouteTable.RouteTableId' \
    --output text)

ok "Public Route Table created: $PUB_RT_ID"

# Add the internet route to the public route table
# 0.0.0.0/0 means "all traffic not matched by a more specific route"
# Destination: 0.0.0.0/0 (catch-all for internet traffic)
# Target: our Internet Gateway
# This single route is what separates a public subnet from a private one
aws ec2 create-route \
    --route-table-id "$PUB_RT_ID" \
    --destination-cidr-block "0.0.0.0/0" \
    --gateway-id "$IGW_ID" \
    --region "$REGION"

ok "Internet route added to Public RT: 0.0.0.0/0 → $IGW_ID"

# Associate Public Subnet 1 with the Public Route Table
# Association means: packets arriving in this subnet follow this route table
aws ec2 associate-route-table \
    --route-table-id "$PUB_RT_ID" \
    --subnet-id "$PUB_SUBNET_1_ID" \
    --region "$REGION" \
    --output text > /dev/null

ok "Public Subnet 1 associated with Public Route Table"

# Associate Public Subnet 2 with the Public Route Table
# Both public subnets share the same route table - both get internet access
aws ec2 associate-route-table \
    --route-table-id "$PUB_RT_ID" \
    --subnet-id "$PUB_SUBNET_2_ID" \
    --region "$REGION" \
    --output text > /dev/null

ok "Public Subnet 2 associated with Public Route Table"

# ── PRIVATE ROUTE TABLE ──
# This route table has NO internet route - only the auto-added local route.
# Local route (10.0.0.0/16 → local) is added automatically by AWS.
# Resources in private subnets can only communicate within the VPC.
# Internet cannot initiate connections to them. They cannot call the internet.
PRIV_RT_ID=$(aws ec2 create-route-table \
    --vpc-id "$VPC_ID" \
    --region "$REGION" \
    --tag-specifications "ResourceType=route-table,Tags=[
        {Key=Name,Value=campuscart-private-rt},
        {Key=Project,Value=campuscart},
        {Key=Environment,Value=production},
        {Key=ManagedBy,Value=manual}
    ]" \
    --query 'RouteTable.RouteTableId' \
    --output text)

ok "Private Route Table created: $PRIV_RT_ID"

# Associate Private Subnet 1 with the Private Route Table
# No internet route = private subnet = future RDS/ElastiCache home
aws ec2 associate-route-table \
    --route-table-id "$PRIV_RT_ID" \
    --subnet-id "$PRIV_SUBNET_1_ID" \
    --region "$REGION" \
    --output text > /dev/null

ok "Private Subnet 1 associated with Private Route Table"

# Associate Private Subnet 2 with the Private Route Table
aws ec2 associate-route-table \
    --route-table-id "$PRIV_RT_ID" \
    --subnet-id "$PRIV_SUBNET_2_ID" \
    --region "$REGION" \
    --output text > /dev/null

ok "Private Subnet 2 associated with Private Route Table"

# =============================================================================
# STEP 5 - CREATE KEY PAIR
# =============================================================================
# SSH key pairs use asymmetric cryptography (RSA).
# AWS generates the key pair and gives us the private key ONCE.
# AWS stores the public key on EC2 in ~/.ssh/authorized_keys.
# We store the private key in campuscart-key.pem on our machine.
# If the .pem file is lost, we lose SSH access to the EC2 permanently.
# chmod 400 = read-only for owner - SSH refuses keys with looser permissions.
# NEVER commit this file to Git. It is already in .gitignore.
# =============================================================================

section "STEP 5 - Creating Key Pair"

# Check if key pair already exists - avoid duplicate creation error
EXISTING_KEY=$(aws ec2 describe-key-pairs \
    --key-names "$KEY_NAME" \
    --region "$REGION" \
    --query 'KeyPairs[0].KeyName' \
    --output text 2>/dev/null || echo "")

if [ "$EXISTING_KEY" = "$KEY_NAME" ]; then
    warn "Key pair '$KEY_NAME' already exists in AWS."
    warn "If you have the .pem file locally, you can reuse it."
    warn "If not, delete the key pair in AWS console and re-run this script."

    # Check if .pem file exists locally
    if [ -f "$KEY_FILE" ]; then
        ok "Found existing .pem file at $KEY_FILE"
    else
        echo -e "${RED}ERROR: Key pair exists in AWS but .pem file not found at $KEY_FILE${RESET}"
        echo -e "${RED}Delete the key pair from AWS and re-run this script.${RESET}"
        exit 1
    fi
else
    # Create the key pair
    # --query extracts the private key material from the JSON response
    # The private key is ONLY returned at creation time - never again
    aws ec2 create-key-pair \
        --key-name "$KEY_NAME" \
        --region "$REGION" \
        --tag-specifications "ResourceType=key-pair,Tags=[
            {Key=Name,Value=campuscart-key},
            {Key=Project,Value=campuscart},
            {Key=Environment,Value=production},
            {Key=ManagedBy,Value=manual}
        ]" \
        --query 'KeyMaterial' \
        --output text > "$KEY_FILE"

    ok "Key pair created: $KEY_NAME"

    # chmod 400 = read-only for owner, nothing for group and others
    # SSH WILL REFUSE to use the key if permissions are too open
    # Error if skipped: "UNPROTECTED PRIVATE KEY FILE!"
    chmod 400 "$KEY_FILE"

    ok "Private key saved and secured: $KEY_FILE (chmod 400 applied)"
fi

# =============================================================================
# STEP 6 - LAUNCH EC2 INSTANCE
# =============================================================================
# EC2 = Elastic Compute Cloud - a virtual machine running on AWS hardware.
# AMI: Ubuntu 22.04 LTS (official Canonical image for ap-south-1)
#   - LTS = Long Term Support - security updates until April 2027
#   - Same OS Bharath uses locally - zero environment mismatch
# t2.micro: 1 vCPU, 1GB RAM - free tier eligible
# Placed in Public Subnet 1 (ap-south-1a) - must be internet-reachable.
# Key pair attached - only campuscart-key.pem can SSH in.
# EBS volume: 20GB gp3 - gp3 is newer, faster, cheaper than gp2.
# delete-on-termination=true - EBS deleted when instance is terminated.
#   Change to false if you want to preserve data after termination.
#
# NOTE: Security Group is created by Soldier 3.
#       This step uses a placeholder SG name "campuscart-sg".
#       Soldier 3 must create the SG BEFORE Soldier 6 runs this script.
#       Soldier 6: replace SECURITY_GROUP_ID below with the real SG ID.
# =============================================================================

section "STEP 6 - Launching EC2 Instance"

# ── IMPORTANT: Soldier 3 creates the Security Group ──
# Soldier 6: Run this after Soldier 3's script has created the SG.
# Then replace the value below with the actual Security Group ID.
# Example: sg-0abc123def456789

warn "Fetching Security Group created by Soldier 3..."

# Fetch the Security Group ID by name - Soldier 3 tags it as campuscart-sg
SECURITY_GROUP_ID=$(aws ec2 describe-security-groups \
    --filters \
        "Name=group-name,Values=campuscart-sg" \
        "Name=vpc-id,Values=$VPC_ID" \
    --region "$REGION" \
    --query 'SecurityGroups[0].GroupId' \
    --output text 2>/dev/null || echo "")

# If Soldier 3's SG doesn't exist yet, exit with a clear message
if [ -z "$SECURITY_GROUP_ID" ] || [ "$SECURITY_GROUP_ID" = "None" ]; then
    echo -e "${RED}ERROR: Security Group 'campuscart-sg' not found in VPC $VPC_ID${RESET}"
    echo -e "${RED}Run Soldier 3's script first to create the Security Group.${RESET}"
    echo -e "${RED}Then re-run this script from STEP 6 onwards.${RESET}"
    exit 1
fi

ok "Security Group found: $SECURITY_GROUP_ID"

# Launch the EC2 instance
# --image-id: Ubuntu 22.04 LTS AMI for ap-south-1
# --instance-type: t2.micro (1 vCPU, 1GB RAM, free tier)
# --subnet-id: Public Subnet 1 - EC2 must be in a public subnet
# --key-name: the SSH key pair we just created
# --security-group-ids: Soldier 3's security group
# --block-device-mappings: 20GB gp3 EBS root volume
# --associate-public-ip-address: gives EC2 a dynamic public IP
#   (we will replace this with Elastic IP in Step 7)
INSTANCE_ID=$(aws ec2 run-instances \
    --image-id "$AMI_ID" \
    --instance-type "$INSTANCE_TYPE" \
    --subnet-id "$PUB_SUBNET_1_ID" \
    --key-name "$KEY_NAME" \
    --security-group-ids "$SECURITY_GROUP_ID" \
    --associate-public-ip-address \
    --block-device-mappings "[{
        \"DeviceName\": \"/dev/sda1\",
        \"Ebs\": {
            \"VolumeSize\": 20,
            \"VolumeType\": \"gp3\",
            \"DeleteOnTermination\": true
        }
    }]" \
    --tag-specifications "ResourceType=instance,Tags=[
        {Key=Name,Value=campuscart-ec2},
        {Key=Project,Value=campuscart},
        {Key=Environment,Value=production},
        {Key=ManagedBy,Value=manual}
    ]" "ResourceType=volume,Tags=[
        {Key=Name,Value=campuscart-ec2-root-volume},
        {Key=Project,Value=campuscart},
        {Key=Environment,Value=production},
        {Key=ManagedBy,Value=manual}
    ]" \
    --region "$REGION" \
    --query 'Instances[0].InstanceId' \
    --output text)

ok "EC2 instance launched: $INSTANCE_ID"

# Wait for the instance to reach "running" state before associating Elastic IP
# AWS needs the instance to be running before we can attach an EIP
# This typically takes 30-60 seconds
info "Waiting for EC2 to reach 'running' state (this takes ~30-60 seconds)..."

aws ec2 wait instance-running \
    --instance-ids "$INSTANCE_ID" \
    --region "$REGION"

ok "EC2 is now running: $INSTANCE_ID"

# Get the EC2 private IP for our records
PRIVATE_IP=$(aws ec2 describe-instances \
    --instance-ids "$INSTANCE_ID" \
    --region "$REGION" \
    --query 'Reservations[0].Instances[0].PrivateIpAddress' \
    --output text)

ok "EC2 Private IP: $PRIVATE_IP"

# =============================================================================
# STEP 7 - ALLOCATE AND ASSOCIATE ELASTIC IP
# =============================================================================
# Elastic IP = static public IPv4 address that belongs to our AWS account.
# Problem without EIP: every EC2 stop/start assigns a new public IP.
#   This would break DNS, GitHub Actions SSH, and Stripe webhooks.
# Elastic IP is FREE when attached to a running instance.
# Charged ~$0.005/hour when allocated but NOT attached to running instance.
# IMPORTANT for Soldier 6 teardown: RELEASE the EIP - don't just disassociate.
# How it works: IGW maintains 1:1 NAT mapping Elastic IP ↔ EC2 private IP.
# Inside the EC2, ifconfig shows only the private IP - EIP is at IGW level.
# =============================================================================

section "STEP 7 - Allocating and Associating Elastic IP"

# Allocate an Elastic IP from Amazon's pool
# --domain vpc: required for VPC-based instances (vs EC2-Classic which is retired)
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

# Get the actual public IP address for display
ELASTIC_IP=$(aws ec2 describe-addresses \
    --allocation-ids "$ALLOCATION_ID" \
    --region "$REGION" \
    --query 'Addresses[0].PublicIp' \
    --output text)

ok "Elastic IP address: $ELASTIC_IP"

# Associate the Elastic IP with our EC2 instance
# After this, all traffic to ELASTIC_IP is routed to our EC2's private IP
# This association survives EC2 stop/start - the IP stays fixed
aws ec2 associate-address \
    --instance-id "$INSTANCE_ID" \
    --allocation-id "$ALLOCATION_ID" \
    --region "$REGION" \
    --output text > /dev/null

ok "Elastic IP $ELASTIC_IP associated with EC2 $INSTANCE_ID"

# =============================================================================
# SUMMARY - Print all created resource IDs
# =============================================================================
# This output should be copied into infrastructure.md by Soldier 6
# =============================================================================

section "INFRASTRUCTURE SUMMARY - Copy to infrastructure.md"

echo ""
echo -e "  ${BOLD}Region:${RESET}              $REGION"
echo ""
echo -e "  ${BOLD}VPC:${RESET}"
echo -e "    VPC ID:            $VPC_ID"
echo -e "    CIDR:              $VPC_CIDR"
echo ""
echo -e "  ${BOLD}Subnets:${RESET}"
echo -e "    Public Subnet 1:   $PUB_SUBNET_1_ID ($PUB_SUBNET_1_CIDR - $PUB_SUBNET_1_AZ)"
echo -e "    Public Subnet 2:   $PUB_SUBNET_2_ID ($PUB_SUBNET_2_CIDR - $PUB_SUBNET_2_AZ)"
echo -e "    Private Subnet 1:  $PRIV_SUBNET_1_ID ($PRIV_SUBNET_1_CIDR - $PRIV_SUBNET_1_AZ)"
echo -e "    Private Subnet 2:  $PRIV_SUBNET_2_ID ($PRIV_SUBNET_2_CIDR - $PRIV_SUBNET_2_AZ)"
echo ""
echo -e "  ${BOLD}Internet Gateway:${RESET}"
echo -e "    IGW ID:            $IGW_ID"
echo ""
echo -e "  ${BOLD}Route Tables:${RESET}"
echo -e "    Public RT:         $PUB_RT_ID"
echo -e "    Private RT:        $PRIV_RT_ID"
echo ""
echo -e "  ${BOLD}Key Pair:${RESET}"
echo -e "    Key Name:          $KEY_NAME"
echo -e "    Private Key:       $KEY_FILE"
echo ""
echo -e "  ${BOLD}EC2 Instance:${RESET}"
echo -e "    Instance ID:       $INSTANCE_ID"
echo -e "    Instance Type:     $INSTANCE_TYPE"
echo -e "    AMI:               $AMI_ID (Ubuntu 22.04 LTS)"
echo -e "    Private IP:        $PRIVATE_IP"
echo -e "    Subnet:            $PUB_SUBNET_1_ID (Public Subnet 1 - $PUB_SUBNET_1_AZ)"
echo -e "    Security Group:    $SECURITY_GROUP_ID"
echo ""
echo -e "  ${BOLD}Elastic IP:${RESET}"
echo -e "    Allocation ID:     $ALLOCATION_ID"
echo -e "    Public IP:         $ELASTIC_IP"
echo ""

# =============================================================================
# SSH COMMAND - How to connect to the EC2
# =============================================================================

section "SSH ACCESS"

echo ""
echo -e "  ${BOLD}Connect to EC2:${RESET}"
echo ""
echo -e "  ${GREEN}ssh -i $KEY_FILE ubuntu@$ELASTIC_IP${RESET}"
echo ""
echo -e "  ${YELLOW}Notes:${RESET}"
echo -e "  → Default user for Ubuntu AMIs on AWS is 'ubuntu'"
echo -e "  → Security Group must allow port 22 from your IP (Soldier 3)"
echo -e "  → chmod 400 already applied to $KEY_FILE"
echo ""

# =============================================================================
# TEARDOWN REMINDER - For Soldier 6
# =============================================================================

section "TEARDOWN REMINDER FOR SOLDIER 6"

echo ""
echo -e "  ${RED}${BOLD}When tearing down - follow this EXACT ORDER:${RESET}"
echo ""
echo -e "  ${YELLOW}1.${RESET} Disassociate + RELEASE Elastic IP (not just disassociate)"
echo -e "     ${CYAN}aws ec2 disassociate-address --association-id <assoc-id>${RESET}"
echo -e "     ${CYAN}aws ec2 release-address --allocation-id $ALLOCATION_ID${RESET}"
echo ""
echo -e "  ${YELLOW}2.${RESET} Terminate EC2 instance"
echo -e "     ${CYAN}aws ec2 terminate-instances --instance-ids $INSTANCE_ID${RESET}"
echo ""
echo -e "  ${YELLOW}3.${RESET} Delete Security Group (Soldier 3 creates, Soldier 6 deletes)"
echo ""
echo -e "  ${YELLOW}4.${RESET} Detach + Delete Internet Gateway"
echo -e "     ${CYAN}aws ec2 detach-internet-gateway --internet-gateway-id $IGW_ID --vpc-id $VPC_ID${RESET}"
echo -e "     ${CYAN}aws ec2 delete-internet-gateway --internet-gateway-id $IGW_ID${RESET}"
echo ""
echo -e "  ${YELLOW}5.${RESET} Delete Subnets (all 4)"
echo -e "     ${CYAN}aws ec2 delete-subnet --subnet-id $PUB_SUBNET_1_ID${RESET}"
echo -e "     ${CYAN}aws ec2 delete-subnet --subnet-id $PUB_SUBNET_2_ID${RESET}"
echo -e "     ${CYAN}aws ec2 delete-subnet --subnet-id $PRIV_SUBNET_1_ID${RESET}"
echo -e "     ${CYAN}aws ec2 delete-subnet --subnet-id $PRIV_SUBNET_2_ID${RESET}"
echo ""
echo -e "  ${YELLOW}6.${RESET} Delete Route Tables (not the main/default one)"
echo -e "     ${CYAN}aws ec2 delete-route-table --route-table-id $PUB_RT_ID${RESET}"
echo -e "     ${CYAN}aws ec2 delete-route-table --route-table-id $PRIV_RT_ID${RESET}"
echo ""
echo -e "  ${YELLOW}7.${RESET} Delete VPC"
echo -e "     ${CYAN}aws ec2 delete-vpc --vpc-id $VPC_ID${RESET}"
echo ""
echo -e "  ${YELLOW}8.${RESET} Delete Key Pair from AWS (optional - keep .pem locally)"
echo -e "     ${CYAN}aws ec2 delete-key-pair --key-name $KEY_NAME${RESET}"
echo ""
echo -e "  ${RED}WHY ORDER MATTERS:${RESET} AWS will refuse to delete a VPC"
echo -e "  that still has subnets, IGW, or route tables inside it."
echo -e "  Dependencies must be removed before the parent resource."
echo ""

# =============================================================================
# DONE
# =============================================================================

echo -e "${GREEN}${BOLD}╔══════════════════════════════════════════════╗${RESET}"
echo -e "${GREEN}${BOLD}║   Soldier 2 Mission Complete ✓               ║${RESET}"
echo -e "${GREEN}${BOLD}║   All infrastructure created successfully.    ║${RESET}"
echo -e "${GREEN}${BOLD}║   Hand off to Soldier 3.                      ║${RESET}"
echo -e "${GREEN}${BOLD}╚══════════════════════════════════════════════╝${RESET}"
echo ""

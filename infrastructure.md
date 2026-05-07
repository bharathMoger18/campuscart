# CampusCart — AWS Infrastructure Documentation

> **Single source of truth for all Soldiers.**
> Soldier 6: Fill in every `FILL_AFTER_EXECUTION` placeholder with real values after running `vpc-setup.sh`.

---

## Overview

| Property        | Value                                      |
|----------------|--------------------------------------------|
| Project        | CampusCart                                 |
| AWS Account    | 021859068764                               |
| Region         | ap-south-1 (Mumbai)                        |
| Executed By    | Soldier 6                                  |
| Script         | `aws/vpc-setup.sh`                         |

---

## 1. VPC

| Property        | Value                        |
|----------------|------------------------------|
| Name           | campuscart-vpc               |
| VPC ID         | vpc-04d72783f81e65d0e        |
| CIDR Block     | 10.0.0.0/16                  |
| DNS Hostnames  | Enabled                      |
| DNS Resolution | Enabled                      |
| Region         | ap-south-1                   |

---

## 2. Subnets

| Name                      | Subnet ID                | CIDR          | AZ           | Type    | Resources        |
|--------------------------|--------------------------|---------------|--------------|---------|------------------|
| campuscart-public-subnet-1  | subnet-07f8b132ea1102700 | 10.0.1.0/24   | ap-south-1a  | Public  | EC2 Instance     |
| campuscart-public-subnet-2  | subnet-0d6aa711af70cbffa | 10.0.2.0/24   | ap-south-1b  | Public  | Empty (future LB)|
| campuscart-private-subnet-1 | subnet-0e93b405d8e9ac54e | 10.0.3.0/24   | ap-south-1a  | Private | Empty (future RDS)|
| campuscart-private-subnet-2 | subnet-0270e4ac70b79513f | 10.0.4.0/24   | ap-south-1b  | Private | Empty (future RDS)|

**Usable IPs per subnet:** 251 (256 total − 5 reserved by AWS)

**AWS Reserved IPs per subnet (example for 10.0.1.0/24):**
- `10.0.1.0` — Network address
- `10.0.1.1` — VPC router (default gateway)
- `10.0.1.2` — VPC DNS server
- `10.0.1.3` — AWS future use
- `10.0.1.255` — Broadcast address

---

## 3. Internet Gateway

| Property   | Value                   |
|-----------|-------------------------|
| Name      | campuscart-igw          |
| IGW ID    | igw-0a0ba75205fa16032   |
| State     | Attached to VPC         |
| VPC       | campuscart-vpc          |

---

## 4. Route Tables

### Public Route Table

| Property    | Value                   |
|------------|-------------------------|
| Name       | campuscart-public-rt    |
| RT ID      | rtb-02fb721ef7dcc379a |
| Associated | Public Subnet 1, Public Subnet 2 |

**Routes:**

| Destination  | Target         | Purpose                              |
|-------------|----------------|--------------------------------------|
| 10.0.0.0/16 | local          | Intra-VPC traffic stays inside VPC   |
| 0.0.0.0/0   | igw-xxxxxxxxxx | All other traffic → Internet Gateway |

### Private Route Table

| Property    | Value                   |
|------------|-------------------------|
| Name       | campuscart-private-rt   |
| RT ID      | rtb-0e6736b493ac4bab4  |
| Associated | Private Subnet 1, Private Subnet 2 |

**Routes:**

| Destination  | Target | Purpose                                   |
|-------------|--------|-------------------------------------------|
| 10.0.0.0/16 | local  | Intra-VPC only. No internet route = private. |

---

## 5. Key Pair

| Property         | Value                          |
|-----------------|--------------------------------|
| Key Name        | campuscart-key                 |
| Key ID          | campuscart-key         |
| Private Key File| ~/campuscart-key.pem           |
| Permissions     | 400 (read-only, owner only)    |
| Algorithm       | RSA                            |

> ⚠️ **NEVER commit `campuscart-key.pem` to Git. Already in `.gitignore`.**
> ⚠️ **If the .pem file is lost, EC2 SSH access is permanently lost.**

---

## 6. EC2 Instance

| Property        | Value                                      |
|----------------|--------------------------------------------|
| Name           | campuscart-ec2                             |
| Instance ID    | i-0541d779bab1e66c6                     |
| Instance Type  | t2.micro (1 vCPU, 1GB RAM)                 |
| AMI            | ami-0f58b397bc5c1f2e8                      |
| AMI Name       | Ubuntu Server 22.04 LTS (HVM), SSD         |
| OS             | Ubuntu 22.04 LTS                           |
| AZ             | ap-south-1a                                |
| Subnet         | campuscart-public-subnet-1 (10.0.1.0/24)   |
| Private IP     | 10.0.1.63                     |
| Public IP      | See Elastic IP below (static)              |
| Security Group | campuscart-sg (created by Soldier 3)       |
| Key Pair       | campuscart-key                             |
| EBS Volume     | 20GB gp3 (delete on termination: true)     |
| IAM Role       | campuscart-ec2-role (created by Soldier 3) |

---

## 7. Elastic IP

| Property       | Value                   |
|---------------|-------------------------|
| Name          | campuscart-eip          |
| Allocation ID | eipalloc-0a527643933464426  |
| Public IP     | 3.7.189.204  |
| Associated To | campuscart-ec2          |
| Domain        | vpc                     |

> 💡 **Pricing:** Free while attached to a running instance.
> Charged ~$0.005/hour if allocated but not attached to a running instance.
> **Soldier 6 teardown:** RELEASE the EIP — do not just disassociate.

---

## 8. SSH Access

```bash
# Connect to EC2 after infrastructure is running
# Replace ELASTIC_IP with the actual Elastic IP from Step 7 above

ssh -i ~/campuscart-key.pem ubuntu@ELASTIC_IP

# ubuntu = default user for all Ubuntu AMIs on AWS
# Port 22 must be allowed in Security Group (Soldier 3 configures this)
```

---

## 9. Architecture Diagram

```
Internet (Public Users)
        |
        | HTTPS/HTTP (port 80, 443)
        ↓
┌─────────────────────────────────────────────────────────────┐
│  Internet Gateway (campuscart-igw)                          │
│  1:1 NAT: Elastic IP ↔ EC2 Private IP                       │
└─────────────────────────────────────────────────────────────┘
        |
        ↓
┌─────────────────────────────────────────────────────────────┐
│  VPC: campuscart-vpc (10.0.0.0/16) — ap-south-1             │
│                                                             │
│  ┌──────────────────────┐  ┌──────────────────────┐         │
│  │  ap-south-1a         │  │  ap-south-1b         │         │
│  │                      │  │                      │         │
│  │  ┌────────────────┐  │  │  ┌────────────────┐  │         │
│  │  │ Public Subnet 1│  │  │  │ Public Subnet 2│  │         │
│  │  │ 10.0.1.0/24    │  │  │  │ 10.0.2.0/24    │  │         │
│  │  │                │  │  │  │                │  │         │
│  │  │  [EC2 t2.micro]│  │  │  │  [empty]       │  │         │
│  │  │  nginx:80      │  │  │  │  future: LB    │  │         │
│  │  │  django:8000   │  │  │  │                │  │         │
│  │  │  postgres:5432 │  │  │  │                │  │         │
│  │  │  redis:6379    │  │  │  │                │  │         │
│  │  └────────────────┘  │  │  └────────────────┘  │         │
│  │                      │  │                      │         │
│  │  ┌────────────────┐  │  │  ┌────────────────┐  │         │
│  │  │Private Subnet 1│  │  │  │Private Subnet 2│  │         │
│  │  │ 10.0.3.0/24    │  │  │  │ 10.0.4.0/24    │  │         │
│  │  │ [empty]        │  │  │  │ [empty]        │  │         │
│  │  │ future: RDS    │  │  │  │ future: RDS    │  │         │
│  │  └────────────────┘  │  │  └────────────────┘  │         │
│  └──────────────────────┘  └──────────────────────┘         │
└─────────────────────────────────────────────────────────────┘
```

---

## 10. Tagging Strategy

All resources are tagged consistently for cost tracking and resource management:

| Tag Key     | Tag Value              |
|------------|------------------------|
| Name       | campuscart-[resource]  |
| Project    | campuscart             |
| Environment| production             |
| ManagedBy  | manual                 |

---

## 11. Soldier Handoff Notes

### → Soldier 3 (IAM + Security Groups + SSM)
- VPC ID needed to create Security Group: fill from Step 1 above
- EC2 Instance ID needed to attach IAM Role: fill from Step 6 above
- Security Group must be named `campuscart-sg` — vpc-setup.sh looks it up by this name
- Security Group inbound rules needed:
  - Port 80 (HTTP) from 0.0.0.0/0
  - Port 443 (HTTPS) from 0.0.0.0/0
  - Port 22 (SSH) from Bharath's IP only

### → Soldier 4 (Bash Provisioning Script)
- EC2 Private IP: fill from Step 6 above
- Elastic IP: fill from Step 7 above — use this for SSH in provisioning script
- Key file location: `~/campuscart-key.pem`
- SSH command: `ssh -i ~/campuscart-key.pem ubuntu@ELASTIC_IP`

### → Soldier 5 (GitHub Actions CI/CD)
- Elastic IP: use as SSH target in GitHub Actions workflow
- EC2 Instance ID: needed for any instance state checks in CI/CD

### → Soldier 6 (Execute Everything)
1. Run Soldier 3's script first (creates Security Group)
2. Run `aws/vpc-setup.sh` (this script)
3. Fill all `FILL_AFTER_EXECUTION` values in this file
4. Verify SSH access works
5. Hand off to Soldier 4

---

## 12. Teardown Order (Soldier 6)

> AWS refuses to delete resources that have dependencies.
> Follow this exact order or deletion will fail.

```bash
# 1. Disassociate and RELEASE Elastic IP
#    (if only disassociated, not released → still charged $0.005/hour)
aws ec2 release-address --allocation-id ALLOCATION_ID --region ap-south-1

# 2. Terminate EC2 instance
aws ec2 terminate-instances --instance-ids INSTANCE_ID --region ap-south-1
aws ec2 wait instance-terminated --instance-ids INSTANCE_ID --region ap-south-1

# 3. Delete Security Group (Soldier 3's resource)
aws ec2 delete-security-group --group-id SECURITY_GROUP_ID --region ap-south-1

# 4. Detach Internet Gateway from VPC, then delete it
aws ec2 detach-internet-gateway --internet-gateway-id IGW_ID --vpc-id VPC_ID --region ap-south-1
aws ec2 delete-internet-gateway --internet-gateway-id IGW_ID --region ap-south-1

# 5. Delete all 4 subnets
aws ec2 delete-subnet --subnet-id PUB_SUBNET_1_ID --region ap-south-1
aws ec2 delete-subnet --subnet-id PUB_SUBNET_2_ID --region ap-south-1
aws ec2 delete-subnet --subnet-id PRIV_SUBNET_1_ID --region ap-south-1
aws ec2 delete-subnet --subnet-id PRIV_SUBNET_2_ID --region ap-south-1

# 6. Delete route tables (cannot delete main route table)
aws ec2 delete-route-table --route-table-id PUB_RT_ID --region ap-south-1
aws ec2 delete-route-table --route-table-id PRIV_RT_ID --region ap-south-1

# 7. Delete VPC
aws ec2 delete-vpc --vpc-id VPC_ID --region ap-south-1

# 8. Delete Key Pair from AWS (keep .pem file locally for records)
aws ec2 delete-key-pair --key-name campuscart-key --region ap-south-1
```

---

*Last updated by: Soldier 2*
*Status: Soldier 6 execution complete — all values filled*

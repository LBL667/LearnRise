#!/usr/bin/env bash
# 华为云资源开通 runbook（VPC / ECS / RDS / OBS / DNS / 证书）。
#
# 默认 dry-run：只打印将要执行的命令，不做任何变更。
# 传 --execute 才会真正调用 hcloud / obsutil / psql / certbot。
#
# 前置：
#   * 已安装并配置 KooCLI：`hcloud configure init`（AK/SK + region + project_id）
#   * 已安装 obsutil 并 `obsutil config -i=<AK> -k=<SK> -e=<endpoint>`
#   * 本机有 psql（或在 ECS 上执行 DB 步骤）
#   * 环境变量（可覆盖）：REGION / VPC_NAME / VPC_CIDR / SUBNET_CIDR /
#     ADMIN_CIDR / ECS_* / RDS_* / OBS_BUCKET / DOMAIN / ACME_EMAIL
#
# 说明：华为云 CLI 参数随 API 版本偶有差异，执行前可用
#   `hcloud <Service> <Operation> --help`
# 核对参数名；本脚本把每一步都打印出来，便于逐条 review 后再放开 --execute。
#
# 注意：本脚本不写任何密钥到磁盘。RDS 密码通过 RDS_PASSWORD 环境变量传入，
# 且不会出现在打印的命令里（打印时使用 ${RDS_PASSWORD:+***} 占位）。
set -euo pipefail

EXECUTE=0
for arg in "$@"; do
  case "$arg" in
    --execute) EXECUTE=1 ;;
    -h|--help)
      sed -n '2,26p' "$0"
      exit 0
      ;;
    *)
      printf '未知参数：%s（支持 --execute / --help）\n' "$arg" >&2
      exit 2
      ;;
  esac
done

REGION="${REGION:-cn-north-4}"
AZ="${AZ:-${REGION}a}"
PROJECT_ID="${PROJECT_ID:-${HUAWEI_PROJECT_ID:-}}"

VPC_NAME="${VPC_NAME:-learnrise-prod-vpc}"
VPC_CIDR="${VPC_CIDR:-192.168.0.0/16}"
SUBNET_NAME="${SUBNET_NAME:-learnrise-prod-subnet}"
SUBNET_CIDR="${SUBNET_CIDR:-192.168.10.0/24}"
SUBNET_GW="${SUBNET_GW:-192.168.10.1}"
SG_NAME="${SG_NAME:-learnrise-prod-sg}"
ADMIN_CIDR="${ADMIN_CIDR:-203.0.113.0/32}"

ECS_NAME="${ECS_NAME:-learnrise-prod-ecs}"
ECS_FLAVOR="${ECS_FLAVOR:-c7.large.2}"
ECS_IMAGE_ID="${ECS_IMAGE_ID:-<ECS_IMAGE_ID>}"
ECS_ROOT_GB="${ECS_ROOT_GB:-80}"
KEYPAIR="${KEYPAIR:-learnrise-prod-key}"
EIP_BANDWIDTH="${EIP_BANDWIDTH:-5}"

RDS_NAME="${RDS_NAME:-learnrise-prod-pg}"
RDS_FLAVOR="${RDS_FLAVOR:-rds.pg.n1.large.2.ha}"
RDS_STORAGE_GB="${RDS_STORAGE_GB:-100}"
RDS_PASSWORD="${RDS_PASSWORD:-}"

OBS_BUCKET="${OBS_BUCKET:-learnrise-prod-<UNIQUE_SUFFIX>}"
DOMAIN="${DOMAIN:-learnrise.example.com}"
ACME_EMAIL="${ACME_EMAIL:-ops@example.com}"

say() { printf '\n\033[1m== %s ==\033[0m\n' "$*"; }
note() { printf '   # %s\n' "$*"; }

run() {
  printf '   $ %s\n' "$*"
  if [ "$EXECUTE" -eq 1 ]; then
    "$@"
  fi
}

run_sh() {
  printf '   $ %s\n' "$1"
  if [ "$EXECUTE" -eq 1 ]; then
    bash -c "$1"
  fi
}

require_execute_tools() {
  [ "$EXECUTE" -eq 1 ] || return 0
  local missing=0
  for bin in "$@"; do
    if ! command -v "$bin" >/dev/null 2>&1; then
      printf '缺少命令：%s（--execute 模式需要）\n' "$bin" >&2
      missing=1
    fi
  done
  [ "$missing" -eq 0 ] || exit 3
}

preflight() {
  say "0/9 预检"
  note "模式：$([ "$EXECUTE" -eq 1 ] && echo EXECUTE || echo DRY-RUN)"
  note "REGION=$REGION AZ=$AZ PROJECT_ID=${PROJECT_ID:-<未设置>}"
  note "VPC=$VPC_NAME($VPC_CIDR) SUBNET=$SUBNET_NAME($SUBNET_CIDR)"
  note "ECS=$ECS_NAME flavor=$ECS_FLAVOR image=$ECS_IMAGE_ID root=${ECS_ROOT_GB}G"
  note "RDS=$RDS_NAME flavor=$RDS_FLAVOR storage=${RDS_STORAGE_GB}G password=$([ -n "$RDS_PASSWORD" ] && echo '***' || echo '<未设置>')"
  note "OBS=$OBS_BUCKET DOMAIN=$DOMAIN ADMIN_CIDR=$ADMIN_CIDR"
  if [ "$EXECUTE" -eq 1 ] && [ -z "$RDS_PASSWORD" ]; then
    printf 'RDS_PASSWORD 未设置，拒绝在 --execute 模式下继续。\n' >&2
    exit 4
  fi
  require_execute_tools hcloud
}

vpc_step() {
  say "1/9 VPC"
  if [ -n "${VPC_ID:-}" ]; then
    note "已提供 VPC_ID=$VPC_ID，跳过创建（幂等）"
  else
    note "先查重：hcloud VPC ListVpcs --cli-region=$REGION --name=$VPC_NAME"
    run_sh "hcloud VPC ListVpcs --cli-region=$REGION --name=$VPC_NAME || true"
    run hcloud VPC CreateVpc --cli-region="$REGION" --vpc.name="$VPC_NAME" --vpc.cidr="$VPC_CIDR"
    note "创建后回填：export VPC_ID=<CreateVpc 返回的 vpc.id>"
    VPC_ID="${VPC_ID:-<VPC_ID>}"
  fi
}

subnet_step() {
  say "2/9 子网"
  if [ -n "${SUBNET_ID:-}" ]; then
    note "已提供 SUBNET_ID=$SUBNET_ID，跳过创建（幂等）"
  else
    run_sh "hcloud VPC ListSubnets --cli-region=$REGION --vpc_id=${VPC_ID:-<VPC_ID>} || true"
    run hcloud VPC CreateSubnet \
      --cli-region="$REGION" \
      --subnet.name="$SUBNET_NAME" \
      --subnet.vpc_id="${VPC_ID:-<VPC_ID>}" \
      --subnet.cidr="$SUBNET_CIDR" \
      --subnet.gateway_ip="$SUBNET_GW"
    note "创建后回填：export SUBNET_ID=<CreateSubnet 返回的 subnet.id>"
    SUBNET_ID="${SUBNET_ID:-<SUBNET_ID>}"
  fi
}

sg_step() {
  say "3/9 安全组（仅暴露 22/80/443；8000/5432 不对外开放）"
  if [ -n "${SG_ID:-}" ]; then
    note "已提供 SG_ID=$SG_ID，跳过创建（幂等）"
  else
    run hcloud VPC CreateSecurityGroup \
      --cli-region="$REGION" \
      --security_group.name="$SG_NAME" \
      --security_group.vpc_id="${VPC_ID:-<VPC_ID>}"
    note "创建后回填：export SG_ID=<CreateSecurityGroup 返回的 security_group.id>"
    SG_ID="${SG_ID:-<SG_ID>}"
  fi

  local rule
  for rule in "22:$ADMIN_CIDR:SSH" "80:0.0.0.0/0:HTTP" "443:0.0.0.0/0:HTTPS"; do
    local port="${rule%%:*}"
    local rest="${rule#*:}"
    local cidr="${rest%%:*}"
    local label="${rest##*:}"
    note "入站 $label $port/tcp from $cidr"
    run hcloud VPC CreateSecurityGroupRule \
      --cli-region="$REGION" \
      --security_group_rule.security_group_id="$SG_ID" \
      --security_group_rule.direction=ingress \
      --security_group_rule.ethertype=IPv4 \
      --security_group_rule.protocol=TCP \
      --security_group_rule.port_range_min="$port" \
      --security_group_rule.port_range_max="$port" \
      --security_group_rule.remote_ip_prefix="$cidr"
  done

  note "RDS 5432 只允许来自 VPC 网段（ECS -> RDS）"
  run hcloud VPC CreateSecurityGroupRule \
    --cli-region="$REGION" \
    --security_group_rule.security_group_id="$SG_ID" \
    --security_group_rule.direction=ingress \
    --security_group_rule.ethertype=IPv4 \
    --security_group_rule.protocol=TCP \
    --security_group_rule.port_range_min=5432 \
    --security_group_rule.port_range_max=5432 \
    --security_group_rule.remote_ip_prefix="$VPC_CIDR"
}

ecs_step() {
  say "4/9 ECS（Ubuntu 22.04 / 8U16G 以下均可，装 docker + compose plugin）"
  if [ -n "${ECS_ID:-}" ]; then
    note "已提供 ECS_ID=$ECS_ID，跳过创建（幂等）"
  else
    run hcloud ECS CreateServers \
      --cli-region="$REGION" \
      --server.name="$ECS_NAME" \
      --server.imageRef="$ECS_IMAGE_ID" \
      --server.flavorRef="$ECS_FLAVOR" \
      --server.vpcid="${VPC_ID:-<VPC_ID>}" \
      --server.nics.1.subnet_id="${SUBNET_ID:-<SUBNET_ID>}" \
      --server.security_groups.1.id="${SG_ID:-<SG_ID>}" \
      --server.root_volume.volume_type=SSD \
      --server.root_volume.size="$ECS_ROOT_GB" \
      --server.availability_zone="$AZ" \
      --server.key_name="$KEYPAIR" \
      --server.count=1 \
      --server.charging_mode=postPaid
    note "创建后回填：export ECS_ID=<server.id>"
    ECS_ID="${ECS_ID:-<ECS_ID>}"
  fi

  say "5/9 EIP + 绑定"
  if [ -n "${EIP_ID:-}" ]; then
    note "已提供 EIP_ID=$EIP_ID，跳过创建（幂等）"
  else
    run hcloud EIP CreatePublicip \
      --cli-region="$REGION" \
      --publicip.type=5_bgp \
      --publicip.bandwidth.size="$EIP_BANDWIDTH" \
      --publicip.bandwidth.share_type=PER
    note "创建后回填：export EIP_ID=<publicip.id>"
    EIP_ID="${EIP_ID:-<EIP_ID>}"
  fi
  note "ECS 网卡 port_id：hcloud ECS ListServersDetails --cli-region=$REGION --server_id=$ECS_ID"
  run hcloud EIP UpdatePublicip \
    --cli-region="$REGION" \
    --publicip_id="$EIP_ID" \
    --publicip.port_id="${PORT_ID:-<ECS_PORT_ID>}"
}

rds_step() {
  say "6/9 RDS for PostgreSQL 15（HA + pgvector）"
  if [ -n "${RDS_ID:-}" ]; then
    note "已提供 RDS_ID=$RDS_ID，跳过创建（幂等）"
  else
    run hcloud RDS CreateInstance \
      --cli-region="$REGION" \
      --name="$RDS_NAME" \
      --datastore.type=postgresql \
      --datastore.version=15 \
      --flavor_ref="$RDS_FLAVOR" \
      --volume.type=CLOUDSSD \
      --volume.size="$RDS_STORAGE_GB" \
      --region="$REGION" \
      --availability_zone="$AZ" \
      --vpc_id="${VPC_ID:-<VPC_ID>}" \
      --subnet_id="${SUBNET_ID:-<SUBNET_ID>}" \
      --security_group_id="${SG_ID:-<SG_ID>}" \
      --ha.type=Ha \
      --port=5432 \
      --password="$RDS_PASSWORD"
    note "创建后回填：export RDS_ID=<instance.id> RDS_PRIVATE_IP=<private_ips[0]>"
  fi

  note "pgvector 扩展：华为云 RDS 必须用 control_extension 创建"
  run_sh "PGPASSWORD=\"\$RDS_PASSWORD\" psql \"\${RDS_URL:-postgresql://learnrise:\$RDS_PASSWORD@\${RDS_PRIVATE_IP:-<RDS_PRIVATE_IP>}:5432/learnrise?sslmode=require}\" -v ON_ERROR_STOP=1 -c \"SELECT control_extension('create','vector');\""
  note "校验扩展版本（应输出 vector 的版本号）"
  run_sh "PGPASSWORD=\"\$RDS_PASSWORD\" psql \"\${RDS_URL:-postgresql://learnrise:\$RDS_PASSWORD@\${RDS_PRIVATE_IP:-<RDS_PRIVATE_IP>}:5432/learnrise?sslmode=require}\" -c \"SELECT extversion FROM pg_extension WHERE extname='vector';\""
  note "初始化业务表：在 ECS 上执行 backend 的 alembic，或 docker compose run --rm backend alembic upgrade head"
}

obs_step() {
  say "7/9 OBS（仅存文件；SSE/API 永不经过 OBS 或 CDN）"
  run obsutil mb "obs://$OBS_BUCKET" -location="$REGION"
  note "CORS：允许前端域名直传/下载；不缓存 /api。"
  local cors_file
  cors_file="$(mktemp -t learnrise-obs-cors.XXXXXX.xml)"
  cat >"$cors_file" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<CORSConfiguration>
  <CORSRule>
    <AllowedOrigin>https://$DOMAIN</AllowedOrigin>
    <AllowedMethod>GET</AllowedMethod>
    <AllowedMethod>PUT</AllowedMethod>
    <AllowedMethod>POST</AllowedMethod>
    <AllowedMethod>HEAD</AllowedMethod>
    <AllowedHeader>*</AllowedHeader>
    <ExposeHeader>ETag</ExposeHeader>
    <ExposeHeader>x-obs-request-id</ExposeHeader>
    <MaxAgeSeconds>3600</MaxAgeSeconds>
  </CORSRule>
</CORSConfiguration>
EOF
  note "CORS 文件：$cors_file（dry-run 不保留；execute 时保留供 obsutil 使用）"
  run obsutil setcors "obs://$OBS_BUCKET" -method=put -localfile="$cors_file"
  note "若 obsutil 参数有差异：obsutil help setcors"
  if [ "$EXECUTE" -eq 0 ]; then
    rm -f "$cors_file"
  fi
}

dns_step() {
  say "8/9 DNS（A 记录指向 EIP）"
  note "主域 $DOMAIN -> ${EIP_PUBLIC_IP:-<EIP_PUBLIC_IP>}"
  run hcloud DNS CreateRecordSet \
    --cli-region="$REGION" \
    --zone_name="$DOMAIN" \
    --name="$DOMAIN" \
    --type=A \
    --records="${EIP_PUBLIC_IP:-<EIP_PUBLIC_IP>}" \
    --ttl=300
  note "API 子域 api.$DOMAIN 同样指向 EIP（与前端同源反代时可省略）"
  run hcloud DNS CreateRecordSet \
    --cli-region="$REGION" \
    --zone_name="$DOMAIN" \
    --name="api.$DOMAIN" \
    --type=A \
    --records="${EIP_PUBLIC_IP:-<EIP_PUBLIC_IP>}" \
    --ttl=300
}

cert_step() {
  say "9/9 TLS 证书（在 ECS 上执行，webroot 与 compose 挂载一致）"
  note "先把域名解析切到 EIP，再执行："
  printf '   $ ssh root@%s\n' "${EIP_PUBLIC_IP:-<EIP_PUBLIC_IP>}"
  note "安装 certbot 后签发（HTTP-01 走 nginx 的 /var/www/certbot）"
  run_sh "certbot certonly --webroot -w /opt/learnrise/deploy/acme -d $DOMAIN --email $ACME_EMAIL --agree-tos --non-interactive"
  note "同步证书到 compose 挂载目录（容器只读）"
  run_sh "install -m 644 /etc/letsencrypt/live/$DOMAIN/fullchain.pem /opt/learnrise/deploy/certs/fullchain.pem && install -m 600 /etc/letsencrypt/live/$DOMAIN/privkey.pem /opt/learnrise/deploy/certs/privkey.pem"
  note "续期钩子：certbot renew --deploy-hook 'docker compose --env-file /opt/learnrise/.env.prod -f /opt/learnrise/docker-compose.prod.yml exec web nginx -s reload'"
}

summary() {
  say "完成 / 后续"
  if [ "$EXECUTE" -eq 0 ]; then
    note "以上均为 DRY-RUN，未做任何变更。确认后加 --execute 重跑。"
  fi
  note "把下一步值写入 .env.prod："
  note "  DATABASE_URL / RDS_URL 使用 RDS 私网地址"
  note "  OBS_* 使用第 7 步的桶与 AK/SK"
  note "  HUAWEI_* 使用第 6 步同 region 的 IAM 子用户"
  note "然后：docker compose --env-file .env.prod -f docker-compose.prod.yml up -d --build"
  note "自检：curl -fsS https://$DOMAIN/api/health"
  note "SSE：见 docs/deploy.md 的验证命令（不得经过 CDN）"
}

preflight
vpc_step
subnet_step
sg_step
ecs_step
rds_step
obs_step
dns_step
cert_step
summary

#!/usr/bin/env bash
set -euo pipefail

deploy_target=${DEPLOY_TARGET:?Set DEPLOY_TARGET to the SSH user and host}
deploy_key=${DEPLOY_KEY:?Set DEPLOY_KEY to the SSH private-key path}
[[ -r "$deploy_key" ]] || { echo "SSH key is not readable: $deploy_key" >&2; exit 1; }
project_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
release_id=$(TZ=Asia/Shanghai date +%Y%m%d-%H%M%S)
temp_dir=$(mktemp -d)
trap 'rm -rf "$temp_dir"' EXIT
ssh_options=(-i "$deploy_key" -o BatchMode=yes -o IdentitiesOnly=yes -o StrictHostKeyChecking=yes -o ConnectTimeout=10)

cd "$project_dir"
npx tsc --noEmit
npm run build

# Only the static output is published; configuration and source stay local.
COPYFILE_DISABLE=1 tar --format=ustar --exclude='._*' -czf "$temp_dir/513base-$release_id.tar.gz" -C dist .
remote_dir=$(ssh "${ssh_options[@]}" "$deploy_target" 'mktemp -d /home/ubuntu/513base-upload.XXXXXXXX')
[[ "$remote_dir" =~ ^/home/ubuntu/513base-upload\.[a-zA-Z0-9]+$ ]] || { echo "Unexpected upload path" >&2; exit 1; }

scp "${ssh_options[@]}" "$temp_dir/513base-$release_id.tar.gz" \
    deploy/publish-server.sh deploy/nginx-513base.conf "$deploy_target:$remote_dir/"
ssh "${ssh_options[@]}" "$deploy_target" \
    "sudo -n bash '$remote_dir/publish-server.sh' '$release_id' '$remote_dir/513base-$release_id.tar.gz' '$remote_dir/nginx-513base.conf'"
ssh "${ssh_options[@]}" "$deploy_target" "rm -rf -- '$remote_dir'"

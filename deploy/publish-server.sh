#!/usr/bin/env bash
set -euo pipefail

release_id=${1:?Missing release ID}
archive=${2:?Missing archive path}
nginx_snippet=${3:?Missing Nginx snippet path}

[[ "$release_id" =~ ^[0-9]{8}-[0-9]{6}$ ]] || { echo "Invalid release ID" >&2; exit 1; }
[[ $(id -u) == 0 ]] || { echo "Run with sudo" >&2; exit 1; }

site_root=/www/wwwroot/lzmyselfai.cn
release_root=/www/513base/releases
release_dir="$release_root/$release_id"
public_dir="$site_root/513base"
config=/www/server/panel/vhost/nginx/extension/lzmyselfai.cn/513base.conf
backup_dir="/var/backups/513base/$release_id"
nginx=/www/server/nginx/sbin/nginx

exec 9>/var/lock/513base-deploy.lock
flock -n 9 || { echo "Another deployment is running" >&2; exit 1; }
[[ ! -e "$release_dir" ]] || { echo "Release already exists" >&2; exit 1; }
[[ ! -e "$public_dir" || -L "$public_dir" ]] || { echo "Deployment path is not a managed symlink" >&2; exit 1; }

install -d -m 755 "$release_dir"
install -d -m 700 "$backup_dir"
tar -xzf "$archive" -C "$release_dir"
[[ -s "$release_dir/index.html" && -d "$release_dir/assets" && -d "$release_dir/data" ]] || { echo "Incomplete release" >&2; exit 1; }
chown -R www-data:www-data "$release_dir"
find "$release_dir" -type d -exec chmod 755 {} +
find "$release_dir" -type f -exec chmod 644 {} +

previous_target=$(readlink "$public_dir" || true)
printf '%s\n' "$previous_target" > "$backup_dir/previous-target"
had_config=0
if [[ -f "$config" ]]; then
    cp -p "$config" "$backup_dir/513base.conf"
    had_config=1
fi

rollback() {
    trap - ERR
    if [[ -n "$previous_target" ]]; then
        ln -s "$previous_target" "$site_root/513base.rollback-$release_id"
        mv -Tf "$site_root/513base.rollback-$release_id" "$public_dir"
    elif [[ -L "$public_dir" ]]; then
        rm "$public_dir"
    fi
    if [[ "$had_config" == 1 ]]; then
        cp -p "$backup_dir/513base.conf" "$config"
    else
        rm -f "$config"
    fi
    "$nginx" -t && "$nginx" -s reload
    echo "Deployment rolled back; failed release remains at $release_dir" >&2
}

trap 'rollback; exit 1' ERR
install -m 600 "$nginx_snippet" "$config"
"$nginx" -t
ln -s "$release_dir" "$site_root/513base.next-$release_id"
mv -Tf "$site_root/513base.next-$release_id" "$public_dir"
"$nginx" -s reload

# Wait for the new Nginx workers and probe without depending on external DNS.
healthy=0
for attempt in {1..10}; do
    if curl --fail --silent --show-error --max-time 5 \
        --resolve lzmyselfai.cn:443:127.0.0.1 https://lzmyselfai.cn/513base/login \
        | cmp -s - "$release_dir/index.html"; then
        healthy=1
        break
    fi
    sleep 1
done
[[ "$healthy" == 1 ]]
trap - ERR
echo "Published $release_id to https://lzmyselfai.cn/513base/"
echo "Release directory: $release_dir"
echo "Rollback metadata: $backup_dir"

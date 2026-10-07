# 513base 云端部署

本项目是静态 Vite 站点，生产路径为 `/513base/`。Nginx 负责 HTTPS、子路径 SPA 回退和静态缓存；Supabase 负责 Auth、Postgres、RLS、Storage 和 Edge Functions。服务器不需要常驻 Node 进程。

生产入口：<https://lzmyselfai.cn/513base/>  ·  [登录](https://lzmyselfai.cn/513base/login)  ·  [管理台](https://lzmyselfai.cn/513base/app)

## 发布前准备

1. 使用发布工作树 `/Users/love_zmyself/.codex/worktrees/513base-cloud/514base_hub`，不要从含有未提交实验改动的主工作区发布。
2. 在 `.env.local` 中配置本项目 Supabase URL 和 publishable key。Vite 会把这两个浏览器变量编入静态资源；只允许使用 publishable key。`.env.local` 文件本身、服务端密钥和人员表不会作为文件上传。
3. 目标 Supabase 项目应已完成基础 SQL、全部迁移和三个 Edge Functions；后续只部署尚未执行的新迁移，不能重跑基础脚本或 `seed.sql`。
4. 确认 DNS、备案、HTTPS 证书和 Nginx include 均属于 `lzmyselfai.cn` 的 `/513base/` 路径。

## 服务器布局

```text
/www/513base/releases/<release-id>/
/www/wwwroot/lzmyselfai.cn/513base              # 当前 release 的 symlink
/www/server/panel/vhost/nginx/extension/lzmyselfai.cn/513base.conf
/var/backups/513base/<release-id>/              # previous-target 与配置备份
```

只上传 `dist/`。不要把源码、SQL、环境文件或管理密钥上传到服务器。当前 Nginx 片段见 [`nginx-513base.conf`](nginx-513base.conf)，发布脚本见 [`publish.sh`](publish.sh) 和 [`publish-server.sh`](publish-server.sh)。

## 发布

在工作树配置 SSH 目标后运行：

```bash
npm ci
npx tsc --noEmit
bash deploy/publish.sh
```

脚本会重新执行类型检查和生产构建，将 `dist/` 打包到临时目录，上传到服务器，创建独立 release，并通过 symlink 原子切换。服务器端会先执行 `nginx -t`，切换后用本机 HTTPS 探针验证 `/513base/login` 返回新入口；任一步失败都会恢复旧 symlink 和 Nginx 配置。

发布脚本要求显式提供 SSH 目标与私钥路径。凭据只通过当前 shell 环境传入，不要写入仓库：

```bash
DEPLOY_TARGET=ubuntu@your-server DEPLOY_KEY=/path/to/key bash deploy/publish.sh
```

不要把真实主机凭据写进脚本或文档。脚本使用严格 host key 校验、批处理模式和上传临时目录。

## 回退

每次发布会在 `/var/backups/513base/<release-id>/previous-target` 保存旧 release 目标，并在原配置存在时备份 Nginx 片段。先确认旧 release 与对应备份目录存在；切换到旧版本并恢复当时的配置后，再检查并重载 Nginx：

```bash
BACKUP_DIR=/var/backups/513base/<failed-release-id>
NGINX_CONFIG=/www/server/panel/vhost/nginx/extension/lzmyselfai.cn/513base.conf

if sudo test -f "$BACKUP_DIR/513base.conf"; then
  sudo cp -p "$BACKUP_DIR/513base.conf" "$NGINX_CONFIG"
else
  sudo rm -f "$NGINX_CONFIG"
fi

sudo ln -s /www/513base/releases/<old-release> /www/wwwroot/lzmyselfai.cn/513base.rollback
sudo mv -Tf /www/wwwroot/lzmyselfai.cn/513base.rollback /www/wwwroot/lzmyselfai.cn/513base
sudo /www/server/nginx/sbin/nginx -t
sudo /www/server/nginx/sbin/nginx -s reload
```

不要删除旧 release 或备份目录，直到新版本完成公网验收。第一次发布之前没有可回退的旧版本。

## 发布后检查

- `https://lzmyselfai.cn/513base` 重定向到带尾斜杠的 `/513base/`。
- `/513base/login`、`/513base/app` 和登录后的深层路由刷新正常。
- 登录页、首次改密页、停用账号页、dashboard 和管理台都显示四行备案/版权底标。
- 页面只请求本项目的 `cvurrazwebjtfffmkymn.supabase.co`，静态 `/data/` 图片、Storage 图片和账号模板可访问。
- 用三类角色回归新增审批、借用审批即借出、错误/正确位置二维码、代还、管理员验收和 Excel 模板下载。
- 真实手机需要额外验证摄像头、相册选择、拍照上传和移动网络；桌面浏览器通过不代表设备验收完成。

最近一次生产验收和 release 记录见 [`HANDOFF.md`](../HANDOFF.md)。开发库初始化、迁移顺序和 SQL 回归见 [`docs/GETTING_STARTED.md`](../docs/GETTING_STARTED.md)。

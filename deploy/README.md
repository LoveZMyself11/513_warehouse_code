# 513 仓库云端部署

2026-10-07 已发布云端基线；本次 `10.7beta` 发布会同步学号登录、Excel 批量导入、首次改密、新增物品双重审批、全角色借用、代还扫码和具体位置二维码校验。

## 地址与项目

- 入口：https://lzmyselfai.cn/513base/
- 登录：https://lzmyselfai.cn/513base/login
- 管理台：https://lzmyselfai.cn/513base/app
- Supabase：`cvurrazwebjtfffmkymn`，沿用当前数据库、Auth、RLS 和 Storage；本轮迁移必须先通过 Supabase CLI 部署，再发布静态前端。
- SSH：`ubuntu@101.43.62.12`，本机密钥 `~/.ssh/password_lzm123.pem`。
- 发布源码：`/Users/love_zmyself/.codex/worktrees/513base-cloud/514base_hub`。

独立工作树包含主工作区当前未提交业务改动的副本和部署适配。主工作区 `5174` 开发服务仍可使用，ngrok 已关闭；业务开发合入前不要从主工作区直接发布。

## 服务器布局

```text
/www/513base/releases/20261007-114747/          # 本次静态产物
/www/wwwroot/lzmyselfai.cn/513base             # 指向当前 release 的 symlink
/www/server/panel/vhost/nginx/extension/lzmyselfai.cn/513base.conf
/var/backups/513base/20261007-114747/          # 发布前链接和配置
```

仅上传 `dist/`，不上传源码、环境文件、数据库脚本或管理密钥。站点配置通过现有宝塔 extension include 加载；只需 Nginx，无需 Node 进程或额外公网端口。

Vite 开发服务使用 `/`，生产构建和 preview 使用 `/513base/`。Router basename 跟随 `BASE_URL`；数据库里的 `/data/` 图片只在渲染时加前缀，Supabase Storage 绝对 URL 保持原样。

## 后续发布

在部署工作树配置本项目的 `.env.local`，仅包含浏览器允许使用的 `VITE_SUPABASE_URL` 和 publishable key。远端数据库迁移和 Edge Functions 通过 Supabase CLI 单独部署，静态站点发布执行：

```bash
npm ci
npx tsc --noEmit
bash deploy/publish.sh
```

脚本先执行 TypeScript 检查和构建，上传到唯一暂存目录，以独立 release 目录和原子链接切换发布。切换前检查 Nginx，切换后比较登录页与构建入口；失败会恢复之前链接及配置。脚本使用已验证的 SSH host key，不关闭主机身份检查。

HTML 禁止缓存，带哈希的 JS/CSS 长期缓存，库存图片缓存一天。发布使用北京时间版本号，记录中不包含密码或密钥。

## 回退

每次发布将旧 symlink 目标写入 `/var/backups/513base/<版本>/previous-target`，已有的专属配置保存为同目录 `513base.conf`。

回退时先确认旧目录存在，再将 `/www/wwwroot/lzmyselfai.cn/513base` 原子切换到旧目录；如配置有变动，恢复该备份，然后执行：

```bash
sudo /www/server/nginx/sbin/nginx -t
sudo /www/server/nginx/sbin/nginx -s reload
```

本次为首次发布，旧目标为空；首次发布回退意味着撤下本项目路径，不能恢复一个不存在的旧版本。保留 release 和备份目录，不自动清理历史版本。

## 已完成验收

- 本地与公网 Playwright 检查桌面 1366x900、手机 390x844：学号登录、dashboard、库存图片、登录后刷新和路由恢复正常。
- 本地浏览器回归覆盖新增双重审批、三类身份借用且审批即借出、错误/正确二维码、代还责任归属、管理员验收、Excel 模板下载、批量导入和首次改密；远端认证/RLS 回归 42 项通过。
- 页面仅连接 `cvurrazwebjtfffmkymn.supabase.co`；无 JS 异常、无 HTTP 请求失败、无页面横向溢出。
- `/513base` 自动跳到 `/513base/`；登录和管理台深层路由可刷新。
- HTML、JS/CSS、库存 JPG 通过公网访问；`.env` 和 `package.json` 返回 404。
- 原个人站首页 SHA-256 发布前后相同，`party-exam/`、`python-exam/` 和本地服务返回 200；穿透入口随后已关闭。
- `npx tsc --noEmit`、`npm run build`、`git diff --check`、发布脚本 `bash -n`、服务器 `nginx -t` 通过。

学号登录由 `student-login` Edge Function 在服务端将学号映射到内部 Auth 邮箱，再返回 Supabase session；前端仍只持有 publishable key。增加密码邮件、OAuth 或修改正式站点路径时，应同步维护正式站点 URL、回调白名单及账号迁移规则。

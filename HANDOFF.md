# 513 仓库管理系统交接

> 更新日期：2026-10-07（Asia/Shanghai）
> 项目目录：`/Users/love_zmyself/all_school_work/514base_hub`
> 本次验收地址：`http://localhost:5174/`（默认端口为 `5173`）
> Supabase 项目：`514_warehouse_code`（产品名称：513 仓库；ref：`cvurrazwebjtfffmkymn`）

## 2026-10-07 云端发布

当前已验证版本已发布到 `https://lzmyselfai.cn/513base/`，登录为 `/513base/login`，管理台为 `/513base/app`，继续使用本项目 Supabase `cvurrazwebjtfffmkymn`。

- 发布源码和部署适配保留在独立工作树 `/Users/love_zmyself/.codex/worktrees/513base-cloud/514base_hub`；其中已带入当前主工作区未提交改动。
- 主工作区的 `5174` 用于本地验收；ngrok 已按要求关闭。
- 服务器版本目录 `/www/513base/releases/20261007-194337`，网站 `/www/wwwroot/lzmyselfai.cn/513base` 为指向该目录的链接。
- 专属 Nginx 配置位于 `/www/server/panel/vhost/nginx/extension/lzmyselfai.cn/513base.conf`，回退记录位于 `/var/backups/513base/20261007-194337`。
- 公网 Playwright 桌面和手机视口通过登录、dashboard、库存图片和路由刷新验收；未出现 JS/HTTP 错误，确认只连接本项目数据库。
- 原个人站首页校验一致，两个原子站、本地服务和穿透入口仍返回 200。
- 部署脚本、重发和回退说明见独立工作树的 `deploy/README.md`。

本轮功能已发布到公网，云端工作树 `10.7beta` 已推送提交 `aed9001 Release 10.7beta workflow update`；生产 smoke 已通过。

## 当前结论

项目已经从早期的浏览器 `localStorage` 原型升级为 React/Vite + Supabase 在线管理系统。前端通过学号登录 Edge Function 换取 Supabase Auth 会话，受保护路由、RLS 权限控制和远程数据库共同生效，正式库存不再以本地存储为数据源。2026-10-06 已清理 cloud 留下的另一套 UUID/明文密码 schema，并按当前代码重建远程 public schema。

### 架构说明

系统采用单页应用架构，登录后先进入按角色分流的 dashboard，再进入库存和业务管理台：

- **super_admin**（超级管理员）：登录后进入系统总览 dashboard，可以看到全部统计数据、待审批项、公告入口等，通过快捷入口访问库存、借用、人员、部门、活动和公告管理
- **admin**（普通管理员）：登录后进入部门工作台，可以看到本部门成员、待审批借用和活动统计
- **member**（普通用户）：登录后进入个人工作台，可以看到可借物品、自己的借用流程和未归还提醒

Dashboard 是 `/` 首页，库存与业务管理台位于 `/app/*`，进入后显示按权限过滤的侧边栏。

当前已经实现：

- `super_admin`、`admin`、`member` 三层角色。
- 正式库存查询，以及物品名称、编号、规格、数量、图片名称、图片路径、识别状态和位置管理。
- 三类身份都可以提交库存新增申请；普通用户申请必须由本部门管理员和超级管理员分别确认，管理员申请由超级管理员确认，申请人不能自批；两层审批完成前不改变正式库存。
- 修改、删除申请仍由有权限的管理员提交并经超级管理员审批；超级管理员可直接维护正式库存。
- 部门动态新增、编辑、删除。
- 用户资料、角色、部门、职位和启用状态管理。
- 普通管理员只管理本部门普通用户，只监管本部门借用订单；普通管理员和超级管理员也可以像普通用户一样发起借用，但不能审批自己的借用。
- 借用申请和 `待审批 -> 已批准 -> 借出中 -> 待审核归还 -> 已归还/已取消` 状态监管。
- 普通用户可批量勾选库存填写借用单；订单支持关联活动，借出后库存显示借出摘要和实际借出时间。
- 普通用户导航显示“借用状态”，首页在有未归还物品时显示提醒；归还必须逐件扫描货架二维码并确认已放回借出前原位，现场照片可选。
- 管理员审核归还申请后订单才会变为已归还；借用交付、归还提交、归还确认时间由数据库记录并显示到秒。
- 管理员可维护活动；库存勾选结果可导出为只含名称、编号、位置的 XLSX。
- 超级管理员可发布、编辑、删除按角色定向的系统公告；dashboard 会显示当前有效公告。
- 归还申请必须逐件扫描并验证借出前位置对应的货架二维码（二维码内容格式为 `513-warehouse:A1`）；归还照片为可选证据。二维码套装包含登录入口、A1-D4、FLOOR、DOOR 共 19 张码。
- 借用人可按学号指定一名已启用同学代还；代还人逐件扫码提交，管理员验收，责任仍归原借用人。
- 超级管理员可通过人员管理下载 Excel 模板并批量导入部门、姓名、手机号、学号、身份等资料；导入账号默认使用统一初始密码，首次登录必须改密。
- 位置变化历史、操作日志及数据库分配的不重复 `ITEMxxxx` 编号。

## 本次运行检查

2026-10-07 已在当前工作区和远程项目完成复核：

- `npm run dev -- --host 0.0.0.0` 可启动 Vite；默认地址为 `http://localhost:5173/`。本次验收因 5173 已被相邻 worktree 占用，当前工作区服务运行在 `http://localhost:5174/`。
- `http://localhost:5174/` 和 `http://localhost:5174/login` 均返回 HTTP 200。
- `.env.local` 已配置 `VITE_SUPABASE_URL` 和 `VITE_SUPABASE_PUBLISHABLE_KEY`；本文不记录具体密钥。
- `npx tsc --noEmit` 通过。
- `npm run build` 通过；Vite 仍提示主包超过 500 KB，以及依赖的 `use client` module directive 警告，均不阻断构建。
- `git diff --check` 通过。
- 已用三个角色完成 REST 端到端流程：普通用户提交借用、管理员审批并标记借出、普通用户提交二维码位置归还申请（不上传照片）、管理员确认归还；测试订单最终为 `returned`。
- 远程 `verify_setup.sql` 已确认 92 条库存、13 张业务表启用 RLS、公告/活动/归还 RPC 存在、归还图片 bucket 为私有、匿名用户不能读取正式库存。
- 远端 Supabase 已部署 `20261007103248_workflow_approvals_and_return_delegates.sql`、`20261007103355_student_login_account_import.sql`、`20261007104410_concrete_borrow_locations.sql` 和 `20261007111047_require_review_for_inventory_additions.sql`；学号登录、账号导入、首次改密和权限边界测试通过。
- 浏览器回归已通过双重新增审批、三类身份借用、审批即进入借出中、错误/正确二维码、代还责任归属、管理员验收和 Excel 模板下载；重复运行时若复用仍在借用的测试物品，数据库会按预期拒绝重复借用。

目前没有自动化测试、lint 或 CI 脚本；浏览器端的真实摄像头和手机文件选择仍需在目标设备补验。

## 登录与测试账号

登录页使用 Supabase Auth 的邮箱和密码登录：`http://localhost:5173/login`。

已创建并启用以下验收账号：

| 角色 | 邮箱 |
|---|---|---|
| `super_admin` | `superadmin.513@example.com` |
| `admin`（宣传部） | `admin.513@example.com` |
| `member`（宣传部） | `member.513@example.com` |

这些是本地/远程验收账号，密码只在本次交接对话中提供，不写入仓库。正式部署前应删除或重置它们，并关闭公开注册（Authentication > Providers > Allow new users to sign up）。

远程 Auth 中另有两个停用的历史测试 `member` 账号；正式部署前一并清理或重置。当前账号总数不是生产账号清单。

新 Auth 用户默认禁用是故意的：必须由超级管理员审核角色、部门和启用状态后才能进入系统。不要把密码、`.env.local`、secret key 或 `service_role` key 写进代码、交接文件或 Git。

## 角色权限

| 角色 | 权限边界 |
|---|---|
| `super_admin`（超级管理员） | 所有后台数据管理；直接 CRUD 正式库存；审批库存变更；CRUD 部门；调整所有人员角色、部门和启用状态；监管所有部门借用订单。 |
| `admin`（普通管理员） | 用于各部门部长/副部长；提交库存变更申请；维护本部门 `member` 资料和启用状态；查看并处理本部门借用订单；不能修改角色、部门或 Auth 绑定。 |
| `member`（普通用户） | 查看已批准库存；提交借用申请；查看借用状态；提交二维码验证的归还申请，照片可选；不能修改正式库存或提交库存变更。 |

权限由数据库 RLS 和受控 RPC 执行，不只依赖前端隐藏按钮。角色授权依据 `public.users.role` 和 `is_active`，不使用用户可编辑的 `user_metadata`。

## Supabase 数据库状态

最近一次远程验证已确认以下 13 张 `public` 表存在并启用 RLS：

1. `inventory_locations`
2. `inventory_items`
3. `inventory_location_history`
4. `departments`
5. `users`
6. `borrow_orders`
7. `borrow_items`
8. `operation_logs`
9. `inventory_change_requests`
10. `activities`
11. `borrow_return_requests`
12. `borrow_return_items`
13. `system_announcements`

远程验证结果：

- `inventory_items` 有 92 条初始库存。
- `departments` 有 8 个部门：宣传部、组织部、竞赛办公室、文体部、文艺部、红承志愿服务队、学风督导部、生活部。
- `inventory_item_number_seq` 已同步到 92；下一次正常创建应分配 `ITEM0093`，删除的编号不复用。
- 旧角色 `manager` 数量为 0；有效角色约束为 `super_admin`、`admin`、`member`。
- `anon` 对正式库存没有 `SELECT` 权限。
- 新 Auth 用户自动创建为 `member` 且 `is_active = false`。
- 已存在 11 个受控 RPC：
  - `create_inventory_item`
  - `update_inventory_item`
  - `delete_inventory_item`
  - `review_inventory_change_request`
  - `update_department_member`
  - `update_borrow_order_status`
  - `create_borrow_order`
  - `create_borrow_order_batch`
  - `get_inventory_borrow_status`
  - `submit_borrow_return_request`
  - `review_borrow_return_request`

这些是 2026-10-06 已执行的远程核验结果；远程状态可再次在 SQL Editor 执行只读脚本 `supabase/verify_setup.sql` 核对。

### SQL 文件

- `supabase/schema_v2.sql`：完整基础结构、索引、触发器和 8 个部门初始数据。
- `supabase/seed.sql`：92 条库存初始化数据。
- `supabase/auth_and_rls.sql`：Auth 用户映射、三层角色、RLS、人员和借用权限。
- `supabase/inventory_workflow.sql`：正式库存/变更申请隔离、编号 sequence、库存审批 RPC。
- `supabase/storage_images.sql`：`inventory-images` bucket、图片类型/大小限制和按用户目录隔离的 Storage RLS。
- `supabase/migrations/202609220001_borrow_activities.sql`：活动管理、批量借用事务、借出时间、借用摘要和相关 RLS。
- `supabase/migrations/202609270001_borrow_returns.sql`：借用位置快照、归还申请/明细、私有照片存储、管理员核验、秒级审计时间和相关 RLS。
- `supabase/migrations/202610060001_requirements.sql`：系统公告、货架二维码 payload、可选归还照片和相关 RLS。
- `supabase/verify_setup.sql`：只读验收查询。

开发库从空库重建时按 `schema_v2.sql`、`seed.sql`、`auth_and_rls.sql`、`inventory_workflow.sql`、`storage_images.sql` 顺序执行，最后执行 `verify_setup.sql`。现网项目已完成重建，后续只执行审核后的 migration 和 `verify_setup.sql`，不要直接重跑带结构变更或 seed 的基础脚本。

## 前端与业务实现

主要文件：

- `src/main.tsx`：Router、AuthProvider、受保护路由。
- `src/RoleDashboard.tsx`：按角色分流的系统管理员、部门管理员和普通用户工作台。
- `src/auth/AuthProvider.tsx`：Supabase session 和 `public.users` 资料加载。
- `src/auth/LoginPage.tsx`：学号登录入口；`src/auth/accountApi.ts`：学号登录、账号导入和首次改密 API。
- `src/auth/ProtectedRoute.tsx`：未登录跳转、未关联/停用账号拦截。
- `src/App.tsx`：库存、审批、人员、部门和借用管理 UI。
- `src/lib/supabase.ts`：Supabase 客户端初始化。
- `src/styles.css`：桌面和移动端样式。

前端一次加载正式库存、位置历史、变更申请、部门、可见用户、借用订单、归还申请和归还明细。RLS 根据当前用户角色和部门过滤实际可见数据。归还照片使用私有 bucket 和短时签名 URL。

库存写入规则：

- 超级管理员通过 RPC 直接新增、修改、删除正式库存。
- 三类身份都通过 `inventory_change_requests` 提交新增申请；普通用户必须等待部门管理员和超级管理员，管理员申请等待超级管理员，超级管理员不能审批自己的申请。
- 所有审批完成后，受控 RPC 才把请求同步到 `inventory_items`；数据库已撤销直接插入库存和直接执行创建 RPC 的权限。
- 正式库存与待审批请求是不同表，页面统计只把已批准数据算作库存。

初始 92 项图片仍由仓库内 `data/` 静态提供，数据库中的旧 `image_path` 仍是 `/data/...` 路径；新增或替换图片可通过管理台上传到 Supabase Storage 的 `inventory-images` bucket，上传后的 `image_path` 为公开 URL。

## 当前库存数据事实

- 初始物品编号为 `ITEM0001` 至 `ITEM0092`，共 92 条。
- `data/` 中包含 92 张物品 JPG，另有目录占位文件，因此文件总数会大于 92。
- 33 项仍位于 `PENDING_A/B/C/D`，只确认了货架字母，尚未确认具体层数。
- 7 项名称/用途仍需人工复核：`ITEM0003`、`ITEM0009`、`ITEM0018`、`ITEM0059`、`ITEM0069`、`ITEM0082`、`ITEM0084`。
- `ITEM0079`、`ITEM0091` 是区域总览照片，需要决定保留为物品、拆分还是改为场景资料。
- 初始数量目前多数为“若干”，不能视为真实盘点数量。
- 不要把 `PENDING_A` 等待分层位置改写成 `A0/B0/C0/D0`。

上游图片清单为 `inventory_image_manifest.csv`。`tools/generate_inventory_assets.py` 会重新生成前端数据和 seed，但会把数量重置为“若干”，因此不能用它覆盖已经在线发生的业务修改。

## 账号 Excel 模板

当前模板位于：

`public/templates/account_import_template.xlsx`

交付副本位于：`outputs/2026-10-07-account-import/account_import_template.xlsx`。

模板包含“账号导入模板”“填写说明”“部门与身份”三张表，字段包括部门、姓名、手机号、学号、身份、联系邮箱、职位和备注。超级管理员在“人员管理”中上传后，系统逐行校验并创建 Auth 用户和 `public.users` 资料。

导入账号默认使用统一初始密码 `513base123`，首次登录必须改成 10 至 128 位且同时含字母和数字的新密码；初始密码只在交接中说明，不写入 Git。模板下载和导入解析均已通过浏览器验收。

## Git 状态

- 主工作区当前分支为 `main`，保留本地开发改动；部署工作树当前分支为 `10.7beta`，跟踪 `origin/10.7beta`。
- Git 远程仓库：`https://github.com/LoveZMyself11/514_warehouse_code.git`；Supabase 项目名为 `514_warehouse_code`（产品名称为 513 仓库）。
- 主工作区 `HEAD` 与 `origin/main` 仍在 `1dde4c9 Require approval for new Auth users`；部署工作树已在 `aed9001`，并已推送 GitHub。
- 2026-10-07 已通过 Supabase CLI 将四条工作流/账号/位置迁移部署到远程，迁移历史已包含 `202609220001`、`202609270001`、`202610060001`、`20261007103248`、`20261007103355`、`20261007104410` 和 `20261007111047`。
- `.env.local`、`dist/`、Supabase 临时目录和 Excel 预览/检查产物已由 `.gitignore` 排除。

## 云端迁移、账号与后续事项

以下迁移已在远程 Supabase 项目执行并通过 `verify_setup.sql`：

```text
supabase/migrations/202609220001_borrow_activities.sql
supabase/migrations/202609270001_borrow_returns.sql
supabase/migrations/202610060001_requirements.sql
```

`missing_required_tables` 为空，归还字段与 RPC 均存在，`borrow_return_image_bucket.public` 为 `false`。

1. 已完成：三个验收账号已创建并启用：`superadmin.513@example.com`（super_admin）、`admin.513@example.com`（宣传部 admin）、`member.513@example.com`（宣传部 member）。密码只在本次交接对话中提供，不写入仓库。
2. 待部署前完成：在 Supabase Dashboard 关闭公开注册（Allow new users to sign up），并按部署环境重新检查 Auth 设置；本次未把该开关作为已验证事实记录。
3. 已完成：三类账号已完成借用申请、管理员审批/交付、二维码位置归还申请和管理员确认归还验收。
4. 待人工：现场确认 33 个待分层物品、7 个待识别名称、2 个区域总览项以及所有真实数量/规格。
5. 已完成：人员管理中的 Excel 模板和批量导入流程已上线；正式导入前仍应先在小批量资料上验证部门、手机号和学号字段。
6. 待设备验收：在真实手机浏览器上完成拍照、相册、超限文件和上传失败验收；现有 92 项 `/data/...` 图片仍未迁移，需单独规划批量上传和 URL 更新。
7. 当前云端静态部署已验收域名、HTTPS、环境变量和子路径路由；`20261007-194337` 已通过生产 smoke，真实移动网络连接质量仍需持续观察。
8. 待工程化：增加自动化测试、lint、CI 和主包代码分包。

## 常用命令

```bash
cd /Users/love_zmyself/all_school_work/514base_hub
npm install
npm run dev
npx tsc --noEmit
npm run build
npm run preview
```

开发服务默认端口为 5173。若已有服务占用该端口，先确认进程属于本项目，不要直接终止未知进程。

## 安全约束

- 前端只能使用 Supabase publishable key，不得使用 secret 或 `service_role` key。
- 不要提交 `.env.local`、账号密码、初始密码表或密钥。
- 不要仅靠前端按钮控制权限；任何新增写操作都必须有对应 RLS 或受控 RPC。
- 新用户保持默认禁用，必须经过管理员分配角色、部门并启用。
- 正式库存与变更请求必须继续隔离，审批前不得更新 `inventory_items`。
- 不要重跑一次性图片重命名脚本，也不要用旧原型脚本覆盖当前派生数据。

## 2026-09-22 移动端与图片上传改进

### 已完成修改

1. **物品编号自动生成提示** (Task #3 已完成)
   - 在创建物品表单顶部增加绿色提示框，明确说明"物品编号将由系统自动生成（如 ITEM0093），无需手动填写"
   - 编辑模式保持显示编号字段（disabled 状态），创建模式不显示
   - 样式：`.info-notice` 类使用 `#e0f0e9` 背景色和 `#176b50` 文字色，与现有配色一致

2. **移动端图片上传支持** (Task #2 已完成)
   - 新增物品表单使用 `accept="image/jpeg,image/png,image/webp,image/heic,image/heif"` 与 `capture="environment"`
   - 移动端可通过拍照或相册选择图片，前端限制 10 MB，Storage bucket 也强制相同大小与 MIME 限制
   - 上传路径按 `inventory/{当前 Auth 用户 ID}/` 隔离，避免用户写入其他用户目录
   - 文件名包含物品名称、时间戳和随机后缀；上传成功后自动填充 `imageName` 和 `imagePath`
   - 选图后显示预览；提交失败会尝试删除刚上传的临时文件，避免留下孤立对象
   - 编辑模式保留原有的文本输入字段（图片文件名、图片路径），供手动调整

3. **移动端侧边栏适配** (Task #1 - 已存在)
   - 检查确认 `@media (max-width: 900px)` 断点已实现
   - 侧边栏在移动端以固定定位的抽屉形式展开，宽度 `min(290px, 88vw)`
   - 包含 `.mobile-menu` 按钮（顶栏左侧）和 `.close-nav` 按钮（侧边栏顶部）
   - `.nav-backdrop` 半透明遮罩层（`rgba(15, 28, 24, .42)`）点击关闭

### 待验证事项

- **Supabase Storage 策略验收**：已由 `supabase/verify_setup.sql` 确认 bucket、上传策略和删除策略均生效
- **移动端实际测试**：需在真实手机浏览器中验证拍照/相册选择功能
- **现有图片迁移**：当前 92 项 `/data/...` 图片未迁移，需单独规划批量上传和 URL 更新

### 代码变更位置

- `src/App.tsx`：移动端图片校验、预览、Storage 上传、失败清理和编号提示
- `src/styles.css`：移动端抽屉与图片预览样式
- `supabase/storage_images.sql`：Storage bucket 与 RLS 策略

### 后续建议

1. 在真实手机上完成拍照、相册、超限文件和上传失败验收
2. 如需降低流量，再增加客户端图片压缩和上传进度指示器

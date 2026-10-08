# 513 仓库管理系统交接

> 更新日期：2026-10-08（Asia/Shanghai）
> 发布整理工作树：`/Users/love_zmyself/.codex/worktrees/513base-cloud/514base_hub`
> 主工作区：`/Users/love_zmyself/all_school_work/514base_hub`（保留本地未提交改动，不作为本次发布源）
> 2026-10-08 整理版预览：`http://localhost:5180/`；此前功能验收使用 `5174`（默认端口为 `5173`）
> Supabase 项目：`514_warehouse_code`（产品名称：513 仓库；ref：`cvurrazwebjtfffmkymn`）

## 2026-10-07 云端发布

当前已验证版本已发布到 `https://lzmyselfai.cn/513base/`，登录为 `/513base/login`，管理台为 `/513base/app`，继续使用本项目 Supabase `cvurrazwebjtfffmkymn`。

- 发布源码和部署适配保留在独立工作树 `/Users/love_zmyself/.codex/worktrees/513base-cloud/514base_hub`；其中已带入当前主工作区未提交改动。
- 主工作区的 `5174` 用于本地验收；ngrok 已按要求关闭。
- 服务器版本目录 `/www/513base/releases/20261007-233847`，网站 `/www/wwwroot/lzmyselfai.cn/513base` 为指向该目录的链接。
- 专属 Nginx 配置位于 `/www/server/panel/vhost/nginx/extension/lzmyselfai.cn/513base.conf`，回退记录位于 `/var/backups/513base/20261007-233847`。
- 公网 Playwright 桌面和手机视口通过登录、dashboard、库存图片和路由刷新验收；未出现 JS/HTTP 错误，确认只连接本项目数据库。
- 原个人站首页校验一致，两个原子站、本地服务和穿透入口仍返回 200。
- 部署脚本、重发和回退说明见独立工作树的 `deploy/README.md`。

- 本次文档与目录整理基于已验证的 `10.7beta`，在独立工作树完成；不会改写主工作区的本地改动。

本轮功能已发布到公网，备案底标源码提交为 `24d834e Stack legal footer details on separate lines`；生产 smoke 已通过。登录、首次改密、账户不可用、角色工作台和仓库管理台均显示备案及版权底标，四条信息分别独占一行。

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
- 借用申请和 `待审批 -> 借出中 -> 待审核归还 -> 已归还/已取消` 状态监管；审批通过即借出。
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
- 远程 `verify_setup.sql` 曾确认 92 条库存、检查集合中的 12 张业务表启用 RLS、活动/归还 RPC 存在、归还图片 bucket 为私有、匿名用户不能读取正式库存。公告表当时不在脚本的 RLS 检查集合中；2026-10-08 已补入检查集合，结果见本轮整理记录。
- 远端 Supabase 已部署 `20261007103248_workflow_approvals_and_return_delegates.sql`、`20261007103355_student_login_account_import.sql`、`20261007104410_concrete_borrow_locations.sql` 和 `20261007111047_require_review_for_inventory_additions.sql`；学号登录、账号导入、首次改密和权限边界测试通过。
- 浏览器回归已通过双重新增审批、三类身份借用、审批即进入借出中、错误/正确二维码、代还责任归属、管理员验收和 Excel 模板下载；重复运行时若复用仍在借用的测试物品，数据库会按预期拒绝重复借用。

## 2026-10-08 文档与目录整理

- 保留已验证的绿色线上界面；页面文件整理为 `src/pages/`，样式整理为 `src/styles/main.css`，并同步修正 Router、构建和静态资源引用。
- 根目录库存资料归档到 `fixtures/inventory/`，历史工具归档到 `tools/legacy/`，可复用库存工具归档到 `tools/inventory/`；交付模板和二维码归档到 `artifacts/`，历史说明归档到 `docs/archive/`。
- 新增 `docs/GETTING_STARTED.md`、`docs/WORKFLOWS.md` 和 `tools/README.md`；README 补充角色边界、流程图、目录导航、数据库初始化、Excel 导入和部署验收说明。
- README 加入桌面库存、角色工作台、手机登录与手机库存的真实界面截图；截图使用 92 项初始库存和匿名演示资料，不读取线上人员或订单。
- 部门管理员可维护本部门活动；普通管理员与超级管理员均可发起借用；审批通过后立即进入借出中；新增物品按申请人完成部门/超级管理员审批后上架。
- 本轮验证：`npm run check`、脚本语法检查、相对链接检查、`git diff --check` 均通过；绿色样式与 `83a09a8` 完全一致。Playwright 在 1440×980 和 390×844 视口检查样本库存、搜索、图片加载、页面横向溢出、移动侧栏和未登录跳转，均通过；本轮未重复执行会写入业务数据的回归。
- `verify_setup.sql` 补入公告表后已在本项目执行只读验收：13 张业务表均启用 RLS、必需表无缺失、归还图片 bucket 私有、匿名库存读取权限为 `false`，库存条数为 92；未修改数据库结构或业务数据。实时编号 sequence 已为 171，部门数为 10，下方旧快照中的 92/8 不代表当前 sequence 和部门数。
- 发布记录：整理提交 `8e75f0e` 已以普通快进方式推送 `origin/main`；后续预览图与交接勘误采用独立跟进提交。在线服务未因本轮文档与目录整理重新部署。

目前没有入库的自动化浏览器测试、lint 或 CI 脚本；本轮截图检查使用临时 Playwright 脚本。仓库保留两份 SQL 回归脚本，浏览器端的真实摄像头和手机文件选择仍需在目标设备补验。

## 登录与测试账号

登录页默认使用学号和密码，通过 Edge Function 取得同一 Supabase Auth session，兼容历史邮箱账号。开发入口为 `http://localhost:5173/login`，生产入口为 `https://lzmyselfai.cn/513base/login`。

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
| `super_admin`（超级管理员） | 所有后台数据管理；直接修改、删除正式库存；新增仍须其他超级管理员审批；审批库存变更；管理部门与人员；监管所有部门借用订单。 |
| `admin`（普通管理员） | 用于各部门部长/副部长；提交库存变更申请；维护本部门 `member` 资料和启用状态；查看并处理本部门借用订单；不能修改角色、部门或 Auth 绑定。 |
| `member`（普通用户） | 查看正式库存；提交新增和借用申请；查看本人及被委托订单；提交二维码验证的归还申请，照片可选；不能直接修改正式库存。 |

权限由数据库 RLS 和受控 RPC 执行，不只依赖前端隐藏按钮。角色授权依据 `public.users.role` 和 `is_active`，不使用用户可编辑的 `user_metadata`。

## Supabase 数据库状态

截至 2026-10-07 的历史记录包含以下 13 张 `public` 业务表；旧版 `verify_setup.sql` 的 RLS 检查覆盖其中 12 张，遗漏了 `system_announcements`，该检查遗漏已在本轮补齐：

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

上述数量、编号 sequence 和 RPC 清单是此前交接留下的历史快照，不能作为实时库存或完整 RPC 清单；远程状态可再次在 SQL Editor 执行只读脚本 `supabase/verify_setup.sql` 核对。

### SQL 文件

- `supabase/schema_v2.sql`：完整基础结构、索引、触发器和 8 个部门初始数据。
- `supabase/seed.sql`：92 条库存初始化数据。
- `supabase/auth_and_rls.sql`：Auth 用户映射、三层角色、RLS、人员和借用权限。
- `supabase/inventory_workflow.sql`：正式库存/变更申请隔离、编号 sequence、库存审批 RPC。
- `supabase/storage_images.sql`：`inventory-images` bucket、图片类型/大小限制和按用户目录隔离的 Storage RLS。
- `supabase/migrations/202609220001_borrow_activities.sql`：活动管理、批量借用事务、借出时间、借用摘要和相关 RLS。
- `supabase/migrations/202609270001_borrow_returns.sql`：借用位置快照、归还申请/明细、私有照片存储、管理员核验、秒级审计时间和相关 RLS。
- `supabase/migrations/202610060001_requirements.sql`：系统公告、货架二维码 payload、可选归还照片和相关 RLS。
- `supabase/migrations/20261007103248_workflow_approvals_and_return_delegates.sql`：双重新增审批、审批即借出和委托代还。
- `supabase/migrations/20261007103355_student_login_account_import.sql`：学号登录、账号导入和首次改密。
- `supabase/migrations/20261007104410_concrete_borrow_locations.sql`：具体借出位置约束和历史位置修正。
- `supabase/migrations/20261007111047_require_review_for_inventory_additions.sql`：关闭直接新增库存的旁路。
- `supabase/verify_setup.sql`：只读验收查询。

开发库从空库重建时依次执行 `schema_v2.sql`、可选的 `seed.sql`（仅用于空开发库）、`auth_and_rls.sql`、`inventory_workflow.sql`、`storage_images.sql`，再按文件名顺序执行上述七条迁移，最后执行 `verify_setup.sql`。完整操作见 [开发与环境准备](docs/GETTING_STARTED.md)。现网项目已完成重建，后续只执行审核后的 migration 和 `verify_setup.sql`，不要直接重跑带结构变更或 seed 的基础脚本。

## 前端与业务实现

主要文件：

- `src/main.tsx`：Router、AuthProvider、受保护路由。
- `src/pages/DashboardPage.tsx`：按角色分流的系统管理员、部门管理员和普通用户工作台。
- `src/auth/AuthProvider.tsx`：Supabase session 和 `public.users` 资料加载。
- `src/auth/LoginPage.tsx`：学号登录入口；`src/auth/accountApi.ts`：学号登录、账号导入和首次改密 API。
- `src/auth/ProtectedRoute.tsx`：未登录跳转、未关联/停用账号拦截。
- `src/pages/InventoryPage.tsx`：库存、审批、人员、部门和借用管理 UI。
- `src/lib/supabase.ts`：Supabase 客户端初始化。
- `src/styles/main.css`：桌面和移动端样式。

前端一次加载正式库存、位置历史、变更申请、部门、可见用户、借用订单、归还申请和归还明细。RLS 根据当前用户角色和部门过滤实际可见数据。归还照片使用私有 bucket 和短时签名 URL。

库存写入规则：

- 超级管理员通过 RPC 直接修改、删除正式库存；新增必须通过申请和独立审批。
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

上游图片清单位于 `fixtures/inventory/inventory_image_manifest.csv`。`tools/inventory/generate_inventory_assets.py` 会重新生成初始数据和 seed，但会把数量重置为“若干”，因此不能用它覆盖已经在线发生的业务修改。

## 账号 Excel 模板

当前模板位于：

`public/templates/account_import_template.xlsx`

交付副本位于：`artifacts/account-import/2026-10-07-account-import/account_import_template.xlsx`。

模板包含“账号导入模板”“填写说明”“部门与身份”三张表，字段包括部门、姓名、手机号、学号、身份、联系邮箱、职位和备注。超级管理员在“人员管理”中上传后，系统逐行校验并创建 Auth 用户和 `public.users` 资料。

导入账号默认使用统一初始密码，首次登录必须改成 10 至 128 位且同时含字母和数字的新密码。真实账号凭据通过私下交接提供；模板下载和导入解析均已通过浏览器验收。

## Git 状态

- 主工作区当前分支为 `main`，保留本地开发改动；发布整理工作树使用 `codex/repository-polish`，基于 `10.7beta` 的 `83a09a8`。
- Git 远程仓库：`https://github.com/LoveZMyself11/513_warehouse_code.git`；Supabase 项目名仍为 `514_warehouse_code`（产品名称为 513 仓库）。
- 整理提交 `8e75f0e` 已以普通快进方式推送至 `origin/main`，远程已核实；预览图和交接勘误另作跟进提交，主工作区的本地改动继续保留。
- 2026-10-07 已通过 Supabase CLI 将四条工作流/账号/位置迁移部署到远程，迁移历史已包含 `202609220001`、`202609270001`、`202610060001`、`20261007103248`、`20261007103355`、`20261007104410` 和 `20261007111047`。
- `.env.local`、`dist/`、Supabase 临时目录、历史工具输出和 Excel 预览/检查产物已由 `.gitignore` 排除。

## 2026-10-08 手机图片上传与登录记忆

- 生产 Storage 只读核验确认 `inventory-images` 桶存在、上限 10 MB，当前账号上传策略要求 Auth 用户启用且首次改密已完成；Supabase Storage 服务状态可从本机访问。未执行生产文件上传或数据库修改，因此无法确认同学手机所在网络的连通性。
- 物品图片在浏览器端限制最长边 1920 px，并压到标准上传建议的 5 MB 以下；界面显示压缩/上传状态，45 秒未完成会中止并给出网络、权限或存储配置提示。
- 登录新增默认选中的“保持登录”，沿用 Supabase 原存储键兼容已有会话；勾选写入 `localStorage`，取消后改用当前页签 `sessionStorage`。登录字段补齐浏览器密码管理器的 `name`、`id` 和 autocomplete；从不保存明文密码。
- `npm run test:auth-storage` 覆盖登录会话迁移、旧会话读取、登出清理、上传超时和请求取消；Playwright 手机视口压缩验证：1.07 MB 输入处理为约 0.20 MB WebP，最大边 1920 px。`npm run check` 通过。
- 微信若隔离或清除站点存储，仍无法保证跨次扫码记住登录状态；必要时通过微信菜单在系统浏览器打开。真实手机相机、相册和网络上传尚需目标设备补验；本轮未提交、推送或重新部署，生产行为尚未变化。

### 2026-10-08 修复版重新发布

- 源码提交：`ee89008 fix: improve mobile uploads and remembered login`。
- 云端 release：`20261008-151012`，已原子切换到 `/www/513base/releases/20261008-151012`。
- 发布入口：`https://lzmyselfai.cn/513base/`；登录页和管理台路由返回 200，Nginx 配置检查通过。
- 本次发布包含移动端图片压缩/上传超时提示、Storage 上传失败清理，以及“保持登录”会话存储修复。

### 2026-10-08 手机相机返回丢失新增表单修复

- 根因：手机从相机返回浏览器时，Supabase 可向同一用户发出 `SIGNED_IN` 或会话刷新事件；原资料加载依赖整个 `session` 对象，导致受保护路由卸载管理台，丢失新增弹窗及选图状态。现在按 Auth 用户 ID 加载资料，同一用户会话刷新保持表单，账号切换和明确刷新资料仍重新校验。
- 新增图片输入移除强制相机的 `capture` 属性，由手机系统提供相册/拍照选择；取消选择保留原图片。新增窗口通过关闭或取消按钮退出，背景触摸不会误关。
- 新增表单文字、数量、位置、识别状态和说明按 Auth 用户暂存在当前页签 `sessionStorage`，有效期 24 小时；页面重载可恢复，取消或提交成功后清除。照片在会话刷新时保留，但浏览器进程重载后需要重新选择；不把照片字节写入草稿存储。
- 云端 release：`20261008-153328`，站点链接已切换到 `/www/513base/releases/20261008-153328`，Nginx 检查和公网 JS 资源访问通过；入口仍为 `https://lzmyselfai.cn/513base/`。
- 验证：类型检查、生产构建和 12 项存储/上传/草稿测试通过；Playwright 在 390×844 视口模拟 `TOKEN_REFRESHED`、重复 `SIGNED_IN`、选图取消、背景触摸、页面重载恢复及成功提交，均通过且无 JS 异常。
- 公网真实 Supabase 验收：使用已有超级管理员测试账号的临时会话，在生产页面选择图片、模拟浏览器可见性恢复并提交；确认 Storage 图片可访问、`inventory_change_requests` 创建待审批记录、正式库存未新增。临时申请和图片已删除，验证会话已注销。真实手机原生相机仍由现场同学补验。
- 用户确认新增 8 个部门管理员测试账号，均归属现有“仓库清点测试组”：学号 `testadmin1004` 至 `testadmin1011`，显示名称为“513仓库清点管理员1”至“513仓库清点管理员8”。全部已启用、角色为 `admin`、首次登录必须改密；未提供的联系电话和邮箱保持空值。逐个学号登录、角色资料和首次改密前业务访问门禁验证通过；密码只在交接对话中提供。

## 云端迁移、账号与后续事项

### 2026-10-08 中文图片存储路径修复与超级管理员测试账号

- 用户提供的 `Invalid key` 报错已定位：原图片文件名拼接中文物品名称，超出 Supabase Storage 对象名允许的字符范围，上传失败导致新增申请未写入。改为 ASCII `image_<timestamp>_<random-hex>.<extension>`，物品名称和本地照片名称继续支持中文；归还照片沿用同一安全命名函数。
- 新增窗口内在提交按钮前显示上传/写入错误，失败后保留填写内容和选中图片，恢复提交按钮；增加“正在提交新增申请”状态。仅对确认上传成功的图片执行失败清理，不再因无效上传路径触发多余删除请求；清理异常不会覆盖原失败原因。
- 截图中的普通用户账号只读核验发现未分配部门，这会在图片上传成功后被业务触发器拒绝。前端现已在上传前显示部门未分配提示；账号部门待用户指定后补齐，继续保留普通用户角色及原审批流程。
- 新 release：`20261008-155913`，入口仍为 `https://lzmyselfai.cn/513base/`。类型检查、生产构建和 14 项单元测试通过。
- 真实 Supabase + 公网手机视口回归使用中文物品“燕尾夹回归测试”和中文 JPG 文件名，确认唯一 ASCII 存储路径、公开图片 200、普通用户申请的两级审批均 pending、超级管理员审批页可见、批准前正式库存不变。另模拟上传 400，验证弹窗内错误可见、表单保留、按钮恢复且未发起数据库插入或无效清理。测试申请和图片已删除，临时会话已注销。
- 新建并启用两名“仓库清点测试组”超级管理员：`testsuper1002`（513仓库清点超级管理员2）、`testsuper1003`（513仓库清点超级管理员3）。学号登录、`super_admin` 角色、首次改密门禁和验证会话注销均通过；首次登录须改密，未提供的联系方式为空，密码不记录于仓库。

以下迁移已在远程 Supabase 项目执行并通过 `verify_setup.sql`：

```text
supabase/migrations/202609220001_borrow_activities.sql
supabase/migrations/202609270001_borrow_returns.sql
supabase/migrations/202610060001_requirements.sql
supabase/migrations/20261007103248_workflow_approvals_and_return_delegates.sql
supabase/migrations/20261007103355_student_login_account_import.sql
supabase/migrations/20261007104410_concrete_borrow_locations.sql
supabase/migrations/20261007111047_require_review_for_inventory_additions.sql
```

`missing_required_tables` 为空，归还字段与 RPC 均存在，`borrow_return_image_bucket.public` 为 `false`。

1. 已完成：三个验收账号已创建并启用：`superadmin.513@example.com`（super_admin）、`admin.513@example.com`（宣传部 admin）、`member.513@example.com`（宣传部 member）。密码只在本次交接对话中提供，不写入仓库。
2. 待部署前完成：在 Supabase Dashboard 关闭公开注册（Allow new users to sign up），并按部署环境重新检查 Auth 设置；本次未把该开关作为已验证事实记录。
3. 已完成：三类账号已完成借用申请、管理员审批/交付、二维码位置归还申请和管理员确认归还验收。
4. 待人工：现场确认 33 个待分层物品、7 个待识别名称、2 个区域总览项以及所有真实数量/规格。
5. 已完成：人员管理中的 Excel 模板和批量导入流程已上线；正式导入前仍应先在小批量资料上验证部门、手机号和学号字段。
6. 待设备验收：在真实手机浏览器上完成拍照、相册、超限文件和上传失败验收；现有 92 项 `/data/...` 图片仍未迁移，需单独规划批量上传和 URL 更新。
7. 当前云端静态部署已验收域名、HTTPS、环境变量和子路径路由；`20261007-233847` 已通过生产 smoke，真实移动网络连接质量仍需持续观察。
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

- `src/pages/InventoryPage.tsx`：移动端图片校验、预览、Storage 上传、失败清理和编号提示
- `src/styles/main.css`：移动端抽屉与图片预览样式
- `supabase/storage_images.sql`：Storage bucket 与 RLS 策略

### 后续建议

1. 在真实手机上完成拍照、相册、超限文件和上传失败验收
2. 如需降低流量，再增加客户端图片压缩和上传进度指示器

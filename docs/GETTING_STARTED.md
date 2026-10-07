# 开发与环境准备

[返回项目首页](../README.md) · [业务流程](WORKFLOWS.md) · [部署与回退](../deploy/README.md)

本指南用于运行当前 React/Vite + Supabase 版本。先确定是接入已经初始化的 Supabase 项目，还是准备一个独立的空开发库；两者的数据库操作不同。

## 1. 本地启动

需要 Node.js 22 或更新版本及 npm。使用仓库内的 `package-lock.json` 安装依赖，以保持版本一致。

```bash
git clone https://github.com/LoveZMyself11/513_warehouse_code.git
cd 513_warehouse_code
npm ci
cp .env.example .env.local
```

在 `.env.local` 填入目标 Supabase 项目的 URL 和 publishable key：

```dotenv
VITE_SUPABASE_URL=https://your-project-ref.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
```

环境变量来自 Supabase Dashboard 的项目 API 设置。前端代码读取这两个变量；修改后重启开发服务。`VITE_` 变量会进入浏览器构建产物，不能使用 secret key 或 `service_role` key。

```bash
npm run dev
```

默认打开 `http://localhost:5173/login`。端口被占用时以 Vite 输出为准，或显式指定一个可用端口：

```bash
npm run dev -- --port 5175
```

开发服务监听 `0.0.0.0`，同一局域网的设备可以通过本机 IP 访问。手机摄像头通常要求 HTTPS 安全上下文；局域网 HTTP 可以检查布局，但不能代替扫码验收。

## 2. 路由与构建

| 页面 | 开发环境 | 生产构建与 preview |
| --- | --- | --- |
| 登录 | `/login` | `/513base/login` |
| 角色工作台 | `/` | `/513base/` |
| 库存与业务管理 | `/app` | `/513base/app` |

`vite.config.mts` 定义构建基路径，React Router 使用相同的 `BASE_URL`。`/513base/` 是生产站点前缀，服务器需为它配置 SPA 路由回退，详见[部署说明](../deploy/README.md)。

```bash
npx tsc --noEmit
npm run build
npm run preview
```

也可以用仓库提供的一次性检查命令：

```bash
npm run typecheck
npm run check
```

其中 `check` 会先执行 TypeScript 检查，再生成生产构建；它不会部署数据库、Edge Functions 或静态文件。

`preview` 通常在 `http://localhost:4173/513base/login`，实际地址以终端输出为准。`dist/` 是可部署的静态目录，构建会将初始图片 `data/` 复制到 `dist/data/`，并将 `public/` 中的账号模板与开发者头像复制到构建根目录。

数据库中已有的 `/data/...` 图片路径由前端在展示时添加站点前缀；Supabase Storage 的绝对 URL 保持原样。调整目录时必须保持这些公开资源路径可用。

## 3. 接入已初始化的 Supabase 项目

已经上线的项目不需要重建数据库。配置目标项目的环境变量和现有账号，即可启动前端。

维护者可在目标项目 SQL Editor 执行 [`supabase/verify_setup.sql`](../supabase/verify_setup.sql) 做只读结构检查，并对照[迁移目录](../supabase/migrations/)核对迁移历史。该检查列出表、RLS、RPC 和存储配置，不能替代角色与业务验收。

生产库后续只应用经过审核且尚未执行的新迁移。不要重跑基础脚本或 seed，不要为启动前端执行 `supabase db reset`。

## 4. 初始化一个空开发库

> 当前仓库的基础表和部分权限定义在迁移目录之外。只执行 `supabase db push`，或让 `supabase db reset` 重放 `supabase/migrations/`，都不足以初始化完整系统。

以下顺序仅用于新建、独立且没有业务数据的 Supabase 开发项目。可在该项目 SQL Editor 依次执行文件的完整内容；每一步成功后再继续。

### 基础文件

| 顺序 | 文件 | 用途 |
| --- | --- | --- |
| 1 | [`supabase/schema_v2.sql`](../supabase/schema_v2.sql) | 基础业务表、索引、触发器、位置与初始部门 |
| 2，可选 | [`supabase/seed.sql`](../supabase/seed.sql) | 92 项初始库存，只适合需要样本数据的空开发库 |
| 3 | [`supabase/auth_and_rls.sql`](../supabase/auth_and_rls.sql) | Auth 用户资料映射、三层权限、RLS 与基础 RPC |
| 4 | [`supabase/inventory_workflow.sql`](../supabase/inventory_workflow.sql) | 正式库存与变更申请、编号分配及审批 RPC |
| 5 | [`supabase/storage_images.sql`](../supabase/storage_images.sql) | 库存图片 bucket 与 Storage 策略 |

`schema.sql` 是早期仅含库存表的基础文件，不应替代这里的 `schema_v2.sql`。选择 seed 时必须在编号 sequence 初始化前执行；初始图片依赖本仓库的 `data/` 静态目录。

### 全部七条迁移

基础文件完成后，按文件名字典序依次执行以下迁移。这些迁移相互依赖，不能只挑选最近的文件。

| 顺序 | 文件 | 补充能力 |
| --- | --- | --- |
| 1 | [`202609220001_borrow_activities.sql`](../supabase/migrations/202609220001_borrow_activities.sql) | 活动、批量借用、借出时间与借用摘要 |
| 2 | [`202609270001_borrow_returns.sql`](../supabase/migrations/202609270001_borrow_returns.sql) | 原位快照、归还申请、照片存储与验收 |
| 3 | [`202610060001_requirements.sql`](../supabase/migrations/202610060001_requirements.sql) | 公告、位置二维码与可选归还照片 |
| 4 | [`20261007103248_workflow_approvals_and_return_delegates.sql`](../supabase/migrations/20261007103248_workflow_approvals_and_return_delegates.sql) | 双重新增审批、审批即借出、委托代还 |
| 5 | [`20261007103355_student_login_account_import.sql`](../supabase/migrations/20261007103355_student_login_account_import.sql) | 学号规范化、登录限制与首次改密门禁 |
| 6 | [`20261007104410_concrete_borrow_locations.sql`](../supabase/migrations/20261007104410_concrete_borrow_locations.sql) | 借出位置约束与历史位置修正 |
| 7 | [`20261007111047_require_review_for_inventory_additions.sql`](../supabase/migrations/20261007111047_require_review_for_inventory_additions.sql) | 关闭直接新增库存的旁路，统一经审批上架 |

最后执行 [`supabase/verify_setup.sql`](../supabase/verify_setup.sql)。通过 SQL Editor 手动执行文件不会自动登记 Supabase CLI 的迁移历史；后续改用 CLI 管理时，先由维护者核对实际结构和历史，再处理基线登记，避免重复应用迁移。

### 认证与首个管理员

启用 Email 认证并关闭公开注册，在 Auth URL 配置中设置实际站点 URL。当前浏览器使用学号登录，原有邮箱账号仍可登录；如果以后添加邮件重置、OAuth 或修改域名，还需同步配置回调白名单。

在 Supabase Authentication 中创建首个 Auth 用户后，触发器会生成一个停用的 `member` 资料。维护者通过 SQL Editor 或受信任的服务端操作，按该用户的 `auth_user_id` 精确找到 `public.users` 记录，分配 `super_admin`、部门与学号并启用。这里不使用浏览器服务密钥，也不开放前端自助注册。

首个超级管理员可用邮箱登录，再通过人员管理导入其他账号。至少准备两名超级管理员，才能独立审核超级管理员本人提交的新增与借用申请。

## 5. 部署账户 Edge Functions

除了数据库，学号登录、账号导入与首次改密还依赖三个 Edge Functions。先核对目标项目，再部署：

```bash
supabase login
supabase link --project-ref your-project-ref
supabase functions deploy student-login
supabase functions deploy import-accounts
supabase functions deploy change-initial-password
```

[`supabase/config.toml`](../supabase/config.toml) 对这三个函数配置 `verify_jwt = false`。`student-login` 接收登录凭据；`import-accounts` 和 `change-initial-password` 在函数内验证 bearer token，导入还要求已启用、已完成首次改密的超级管理员。

服务端读取 Supabase 环境中的 `SUPABASE_URL`、`SUPABASE_ANON_KEY` 和 `SUPABASE_SERVICE_ROLE_KEY`。这些凭据只存在于服务端配置，不能放入 `.env.example`、前端变量或 Git。函数部署方法可参考 [Supabase 官方文档](https://supabase.com/docs/guides/functions/deploy)。

## 6. 验证与日常维护

提交前至少运行 TypeScript 检查、生产构建与 `git diff --check`，然后用三类角色检查登录、审批、借用、扫码归还和人员导入。真实手机上的摄像头、文件选择与移动网络需要实机验证。

仓库提供两份 SQL 回归脚本：

| 脚本 | 检查内容 |
| --- | --- |
| [`supabase/tests/workflow_approvals.sql`](../supabase/tests/workflow_approvals.sql) | 审批权限、自批拒绝、立即借出、代还责任、18 个位置二维码 |
| [`supabase/tests/concrete_borrow_locations.sql`](../supabase/tests/concrete_borrow_locations.sql) | 待分层借用拒绝、具体位置审批、历史位置修正 |

它们需要数据库所有者权限，会创建测试用户和业务记录，并以事务回滚结束。只能在已按上述顺序准备的独立测试库运行；PostgreSQL sequence 的推进不会随普通事务回滚，因此回滚不等于完全没有副作用。

本指南不把历史测试通过视为当前环境通过。部署检查、发布与回退见 [`deploy/README.md`](../deploy/README.md)，最近发布交接见 [`HANDOFF.md`](../HANDOFF.md)。

## 7. 资料与工具

| 资料 | 当前用途 |
| --- | --- |
| [`public/templates/account_import_template.xlsx`](../public/templates/account_import_template.xlsx) | 系统下载与人员导入使用的正式模板 |
| [`artifacts/qr/513base-二维码标识套装.pdf`](../artifacts/qr/513base-二维码标识套装.pdf) | 登录入口与 18 个具体位置的打印标识 |
| [`fixtures/inventory/`](../fixtures/inventory/) | 初始库存导出与图片映射，不能视为在线库存实时备份 |
| [`tools/README.md`](../tools/README.md) | 模板、二维码与库存资料生成工具说明 |

不要向 GitHub 提交已填写的人员表、账号凭据或 `.env.local`。初始库存生成工具会将数量写回“若干”，只能用于准备初始开发资料，不能覆盖已有在线盘点数据。

## 8. 源码导航

```text
src/
├── pages/       # DashboardPage、InventoryPage：页面级业务编排
├── auth/        # session、学号登录、首次改密、受保护路由
├── components/  # 账号导入、开发者联系、备案底标等复用组件
├── lib/         # Supabase 客户端与静态资源 URL 处理
├── locations.ts # 货架位置与二维码解析
├── types.ts     # 前端业务类型
└── styles/      # main.css：应用样式
fixtures/       # 初始库存 CSV/JSON/图片清单
supabase/       # 基础 SQL、迁移、Edge Functions 与回归脚本
tools/          # 可复用工具；历史脚本归档在 tools/legacy/
artifacts/      # 可交付模板、二维码套装与历史归档
```

页面组件只负责交互与展示，权限和状态迁移仍由 Supabase 数据库执行。移动文件时应同步检查 `src/main.tsx`、构建脚本、静态资源路径和本文档链接。

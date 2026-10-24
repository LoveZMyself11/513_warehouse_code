# Zcode 修改清单

- 状态：待 Codex 审核，未推送/未部署
- 需求来源与验收目标：负责人补丁 1——「人员管理只允许批量导入，不允许在超级管理员页面实现 CRUD，请你做修改。超级管理员身份应该可以操作人员增删，并且人员管理页面应该做分组管理，分组后按照账号等级从上到下区分，超级管理员也可以自行增删三个身份的人」。验收目标：超级管理员可在人员管理页对三种身份（super_admin / admin / member）逐一新增账号、删除人员；页面按账号等级从上到下分组；非超管视图保持既有权限边界。
- 本地 checkout 绝对路径：`/Users/love_zmyself/.zcode/workspace/20f42caa-b5cf-4b59-a41f-5b579ef51ef0/513base-zcode`
- 功能分支名：`codex/zcode-improvements`（本地分支，无 upstream，未推送）
- 基线远端分支 / 完整 base SHA：`origin/main` / `02896f67a6999ef49048addd55b15c9d855661de`（克隆于 2026-10-24，与 ZCODE_HANDOFF.md 记录一致）
- 待审核完整 HEAD SHA：见 git log（本次为单个 commit）
- 未提交和未跟踪文件清单：
  - 已纳入 commit：`src/lib/accountAdmin.ts`、`src/pages/InventoryPage.tsx`、`src/pages/DashboardPage.tsx`、`src/styles/main.css`、`supabase/config.toml`、`supabase/functions/manage-accounts/index.ts`、`tests/accountAdmin.test.mjs`、`docs/ZCODE_CHANGE_REVIEW.md`、`docs/images/zcode/patch1-users-grouped.png`、`docs/images/zcode/patch1-user-create-modal.png`
  - 未纳入 commit：`supabase/.branches/`（本地 `supabase start` 生成的 CLI 目录，与补丁无关，建议加入 .gitignore 或由维护者处理）；`.env.local`（已 gitignore，指向本机本地测试栈，不含生产凭据）

## 修改内容

| 功能 | 修改前问题 | 修改后行为 | 涉及文件 | 验收方法 |
| --- | --- | --- | --- | --- |
| 人员按身份分组展示 | 单张平铺表按姓名排序，无层级 | 按超级管理员→部门管理员→普通用户从上到下分组，每组显示人数、组内按姓名排序；超管可见空组提示，部门管理员只见非空分组（其 RLS 只允许本部门 member） | `src/pages/InventoryPage.tsx`、`src/lib/accountAdmin.ts`、`src/styles/main.css` | 超管登录打开人员管理页核对分组顺序（截图 patch1-users-grouped.png） |
| 超管单人新增账号（三种身份） | 只能 Excel 批量导入 | 「新增人员」入口（页头默认普通用户）+ 每组「新增{身份}」按钮（预选身份），表单字段与批量导入一致；新账号初始密码 513base123、首次登录必须改密，与导入行为完全相同 | `src/pages/InventoryPage.tsx`、`supabase/functions/manage-accounts/index.ts` | UI 建号成功并在对应分组出现（截图 patch1-user-create-modal.png）；API 层三身份创建均返回 success |
| 超管删除人员 | 无删除入口 | 每行「删除」按钮 + 确认弹窗；删除 Auth 账号并级联删除资料（与导入的 Auth 关联一致）；本人不可删（按钮禁用 + 服务端 409） | 同上 | UI 删除成功、列表刷新；服务端返回 success 且 auth.users/public.users 同步减少 |
| 删除安全护栏（业务记录保护） | 无（原无删除能力） | 存在借用单、归还申请或库存变更申请的人员拒绝删除（409 + 明确提示改用停用），防止 `borrow_orders.user_id ON DELETE CASCADE` 连带清除业务历史；全部动作写入 operation_logs | `supabase/functions/manage-accounts/index.ts` | API 层构造借用单/变更申请后删除被拒；清理后同一人删除成功 |
| 非超管视图不受影响 | 部门管理员原可编辑本部门成员资料 | 保持原样：仅本部门普通用户、仅「编辑」；新增/删除入口只对 super_admin 渲染 | `src/pages/InventoryPage.tsx` | admin01 登录验证：无新增/删除按钮，仅见组织部成员 |
| 表单校验与导入规则一致 | — | 新增 `src/lib/accountAdmin.ts`：学号/姓名/部门/手机号/身份/邮箱/职位/备注校验 + 角色分组排序纯函数，服务端 `manage-accounts` 使用相同规则（与 import-accounts 的行校验逐条一致） | `src/lib/accountAdmin.ts`、`tests/accountAdmin.test.mjs` | `npm run test:auth-storage`（新增 4 个用例） |

说明：分组为纯前端展示逻辑，服务端权限不依赖分组；「超级管理员也可删其他超管」按需求允许，系统始终保留至少一名启用超管的保证来自「调用者必为启用超管 + 不能删除自己」（服务端强制），已在代码注释中说明。

## 数据库、函数与配置

- **新 migration 文件：无。** 本补丁不新增迁移；理由：建号/删号全部经由 Edge Function 以 service_role 执行（复用既有 `handle_auth_user` 触发器与 `users_auth_user_id ON DELETE CASCADE` 外键），未改表结构、RLS、RPC 或 Storage；既有「Super admins create/update/delete users」RLS 策略不变。
- **Edge Functions：新增 `supabase/functions/manage-accounts`**（动作 `create` / `delete`）。鉴权与 `import-accounts` 完全同构：Bearer JWT → `auth.admin.getUser` → 校验 `users` 行 `is_active && role='super_admin' && !must_change_password`，否则 401/403。未改动既有三个函数与 `_shared/accounts.ts`（仅 import 其既有导出），`import-accounts` 部署产物不受影响。
- **`supabase/config.toml`**：新增 `[functions.manage-accounts] verify_jwt = false`，与既有三个账户函数一致（函数内部自行校验调用者身份）。
- **部署依赖顺序**：先部署 `manage-accounts` 函数（无数据库前置），再发布静态站。旧前端调用新函数或新前端未发布时均无影响（旧前端不调用该函数）。
- **回退方案**：静态站回退到上一 release 即回到仅批量导入的界面；`manage-accounts` 函数无需回退（未被旧代码调用），如需可从 Dashboard 删除该函数。无数据回退问题：`operation_logs` 只追加。
- **既有业务数据改写：无。** 唯一的删除路径要求目标人员无借用/归还/库存申请记录（服务端强制），历史数据不受影响。
- 环境变量、Auth、Storage、依赖：无变化（未改 package.json / lockfile）。

## 验证证据

- 实际执行的命令与退出状态（2026-10-24，全部在本机执行，退出码 0）：
  - `npm ci`；`npm run check`（tsc + vite build）✓；`npm run test:auth-storage` → 18 tests / 18 pass / 0 fail（含新增 4 例）✓；`git diff --check` ✓
- 测试库标识：**本机 Docker 全新本地 Supabase 栈**（`supabase start`，API `http://127.0.0.1:54321`，项目 id `513base-hub`），与生产完全隔离。按 `docs/GETTING_STARTED.md` 顺序手工执行 4 个基础脚本 + 全部 8 条迁移（20261013063513 含），seed.sql 已加载，迁移历史登记到 `supabase_migrations.schema_migrations`。栈持续运行，dev server 在 `http://127.0.0.1:5175`（`.env.local` 指向本地栈）。
- Edge Function API 级验证（curl 直调本地函数网关）：
  - create：member/admin/super_admin 三身份成功（userId 2/3/4，部门自动 upsert，`must_change_password=true`）；学号重复 409；手机号非法 400；身份非法 400；无凭据 401
  - delete：无记录 member 成功（auth.users 与 public.users 同步 4→3，验证级联）；本人 409「不能删除当前登录的账号」；不存在 404；非整数 400；有借用单 409；有库存变更申请 409；清理后 super_admin 删除成功
  - 权限：部门管理员账号（admin01，已过首改密）调用 create/delete 均 403「仅超级管理员可管理账号」
  - 审计：`operation_logs` 7 条 account_create/account_delete 记录与操作一一对应
- 三角色边界与自批等业务回归：本补丁不触碰借用/审批/归还流程（无 SQL、无 RPC 变更），未重跑 `supabase/tests/*.sql`；借用相关既有测试套件为 SQL 回归，需完整测试库，本次无涉及面。
- 桌面端截图（本地预览 `http://127.0.0.1:5175/login`，账号 boss01/合成账号 admin01，均为合成数据）：
  - `docs/images/zcode/patch1-users-grouped.png`：分组列表、每组新增按钮、自删禁用、删除成功提示
  - `docs/images/zcode/patch1-user-create-modal.png`：新增人员弹窗
- 浏览器 GUI 走查（ZCode 内置浏览器）：超管分组顺序与人数、建号→入组、删除→空组、弹窗内校验错误（无效手机号）、admin01 受限视图（无新增/删除入口，仅本部门 member、仅编辑）均通过。
- **未测试项 / 已知风险**：
  1. 手机端布局未实测（无真实设备）；分组标题与按钮使用了既有响应式类，小屏表现建议发布前抽查。
  2. 并发互删（两名超管同时删除对方）理论上可导致无启用超管；现有护栏不覆盖此竞态。如需绝对保证，可后续增加 DB 触发器（属新 migration，本补丁未做）。
  3. 「至少保留一名超管」依赖函数鉴权逻辑而非 DB 约束；超级管理员仍可按既有 RLS 策略从其他客户端直接对 `users` 表发起 DELETE（该面为本补丁之前已存在，未扩大）。
  4. Edge Function 为 Deno 运行时，本机 tsc 不覆盖 `supabase/functions/`（与既有三函数一致），已人工比对 import-accounts 的 API 用法并在本地栈实跑验证。
  5. 删除的 Auth 账号其历史 `operation_logs.user_id`、`borrow_orders.return_delegate_id` 等引用按既有外键置 NULL，属预期行为。
- 确认：**没有对生产写入**（生产库、生产函数、生产静态站均未触碰），**没有 push、没有 PR、没有部署、没有账号导入**；所有验证都在本机隔离栈与本地 commit。

## Codex 发布建议

- 建议整合：单个本地 commit（见 `git log codex/zcode-improvements`），无补丁拆分需求。
- 发布顺序：① 部署 `manage-accounts` Edge Function（`verify_jwt=false`，无数据库操作）→ ② 发布静态站。顺序颠倒也无故障（旧前端不调用新函数）。
- 发布后 smoke：超管登录 → 人员管理三组可见 → 建一个测试身份成员 → 删除该成员 → 确认 admin 登录看不到增删入口。
- 回退条件：人员页白屏/接口 5xx 时先回退静态站到上一 release；函数可保留（旧前端不调用）。
- 尚需负责人决定的问题：① `supabase/.branches/` 是否加入 .gitignore；② 是否需要「最后一名超管」的 DB 级触发器约束（见未测试项 2）；③ 删除受历史记录保护的人员时目前提示改用「停用」，若负责人希望提供「彻底清除（连同历史）」的显式选项需另行设计。

—— 以上由 Zcode 于 2026-10-24 提交，等待 Codex 审核。

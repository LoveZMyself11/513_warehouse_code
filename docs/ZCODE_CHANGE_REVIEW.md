# Zcode 修改清单

- 状态：待 Codex 审核，未推送/未部署（含补丁 1 两个 commit 与补丁 2 一个 commit）
- 需求来源与验收目标：
  - 补丁 1（commit 9105f06）：人员管理支持超管按身份增删、页面按账号等级从上到下分组。
  - 补丁 1 追加（commit 3c2f1bf）：超管可一键重置任意账号密码回初始密码 513base123，重置后强制重新走首改密流程。
  - 补丁 2（见下）：借用审批矩阵改为——普通用户由部门管理员审批通过即借出；部门管理员仍需超级管理员审批；超级管理员提交借用免审核直接借出；归还流程三身份不变。负责人同时请 Zcode 给出整体流程观察（见文末「流程观察」）。
- 本地 checkout 绝对路径：`/Users/love_zmyself/.zcode/workspace/20f42caa-b5cf-4b59-a41f-5b579ef51ef0/513base-zcode`
- 功能分支名：`codex/zcode-improvements`（本地分支，无 upstream，未推送）
- 基线远端分支 / 完整 base SHA：`origin/main` / `02896f67a6999ef49048addd55b15c9d855661de`（克隆于 2026-10-24，与 ZCODE_HANDOFF.md 记录一致）
- 待审核完整 HEAD SHA：见 git log（补丁 1 为 9105f06、3c2f1bf；补丁 2 为最新 commit）
- 未提交和未跟踪文件清单：
  - 已纳入 commit：补丁 1 见各 commit；补丁 2 含 `supabase/migrations/20261024100000_super_admin_instant_borrow.sql`、`src/pages/InventoryPage.tsx`、`docs/WORKFLOWS.md`、`supabase/tests/super_admin_instant_borrow.sql`、`docs/ZCODE_CHANGE_REVIEW.md`、`docs/images/zcode/patch2-super-instant-borrow.png`
  - 未纳入 commit：`supabase/.branches/`（本地 CLI 生成目录，与补丁无关）；`.env.local`（已 gitignore，指向本机本地测试栈）

## 修改内容

| 功能 | 修改前问题 | 修改后行为 | 涉及文件 | 验收方法 |
| --- | --- | --- | --- | --- |
| 人员按身份分组展示 | 单张平铺表按姓名排序，无层级 | 按超级管理员→部门管理员→普通用户从上到下分组，每组显示人数、组内按姓名排序；超管可见空组提示，部门管理员只见非空分组（其 RLS 只允许本部门 member） | `src/pages/InventoryPage.tsx`、`src/lib/accountAdmin.ts`、`src/styles/main.css` | 超管登录打开人员管理页核对分组顺序（截图 patch1-users-grouped.png） |
| 超管单人新增账号（三种身份） | 只能 Excel 批量导入 | 「新增人员」入口（页头默认普通用户）+ 每组「新增{身份}」按钮（预选身份），表单字段与批量导入一致；新账号初始密码 513base123、首次登录必须改密，与导入行为完全相同 | `src/pages/InventoryPage.tsx`、`supabase/functions/manage-accounts/index.ts` | UI 建号成功并在对应分组出现（截图 patch1-user-create-modal.png）；API 层三身份创建均返回 success |
| 超管删除人员 | 无删除入口 | 每行「删除」按钮 + 确认弹窗；删除 Auth 账号并级联删除资料（与导入的 Auth 关联一致）；本人不可删（按钮禁用 + 服务端 409） | 同上 | UI 删除成功、列表刷新；服务端返回 success 且 auth.users/public.users 同步减少 |
| 删除安全护栏（业务记录保护） | 无（原无删除能力） | 存在借用单、归还申请或库存变更申请的人员拒绝删除（409 + 明确提示改用停用），防止 `borrow_orders.user_id ON DELETE CASCADE` 连带清除业务历史；全部动作写入 operation_logs | `supabase/functions/manage-accounts/index.ts` | API 层构造借用单/变更申请后删除被拒；清理后同一人删除成功 |
| 超管一键重置密码（补丁 1 追加） | 忘记密码只能由开发者在 Supabase Dashboard 手工处理 | 人员列表每行新增「重置密码」按钮 + 确认弹窗；密码重置回初始密码 513base123，同时 `must_change_password=true`、`password_changed_at` 清空，该账号下次登录（含已登录会话刷新后）强制进入「设置新密码」界面；本人与未关联 Auth 的账号按钮禁用，服务端同样拦截 | `supabase/functions/manage-accounts/index.ts`（`reset_password` 动作）、`src/pages/InventoryPage.tsx` | API 级：重置后旧密码被拒、初始密码可登录、门禁标记生效；浏览器：重置 → 登录 → 强制改密页 → 完成改密进入工作台（截图 patch1-password-reset.png、patch1-forced-password-change.png） |
| 超级管理员借用免审核直借（补丁 2） | 超级管理员的借用单需要另一名超级管理员审批才能借出 | 超管提交借用单时由 `create_borrow_order_batch` 直接写入 `borrowed`（含 `borrowed_at`、`borrow_items.borrow_location_code` 由既有触发器快照），可借数量/并发锁校验与普通提交完全一致；审计日志标记 `auto_borrowed=true`。普通用户/部门管理员的审批链不变（普通用户本部门管理员批准即借出、部门管理员由超管批准，均维持既有单级「审批即借出」逻辑，`update_borrow_order_status` 未改动）；归还流程三身份一致，未改动 | `supabase/migrations/20261024100000_super_admin_instant_borrow.sql`、`src/pages/InventoryPage.tsx`、`docs/WORKFLOWS.md` | 新增 SQL 回归 `supabase/tests/super_admin_instant_borrow.sql` 全部断言通过；浏览器：超管提交后订单立即「借出中」并出现免审核提示（截图 patch2-super-instant-borrow.png），部门管理员提交仍为「待审批」、由超管批准后借出 |
| 前端借用提示适配（补丁 2） | 提交后统一显示「等待管理员审批」 | 超管提交显示「超级管理员借用免审核，已直接借出…」，其余身份文案不变；借用弹窗对超管增加免审核说明 | `src/pages/InventoryPage.tsx` | 浏览器走查 |
| 唯一超管自验归还（负责人选定方案 C） | 只剩一名启用超管时，其归还申请无人可验收，库存被永久占用 | `review_borrow_return_request` 放宽：当操作者是该归还单的借用人且系统仅剩一名启用超管时允许自验收；其余自审场景照旧拒绝；审计日志标记 `self_reviewed_lone_super_admin` | `supabase/migrations/20261024110000_borrow_review_rules.sql` | SQL 回归：两名超管时自审被拒、停用其余超管后自审通过且订单归还 |
| 借用审批按钮文字化 + 驳回必填理由 | 借用审批的拒绝是一个 ✗ 图标按钮，无理由、借用人看不到结果原因 | 审批按钮改为「确认借出」「驳回」文字按钮；驳回弹出必填理由弹窗，RPC 强制校验（缺理由 400），理由写入订单 `notes` 并在借用人的订单行显示「驳回理由：…」 | 同上迁移、`src/pages/InventoryPage.tsx` | SQL 回归：无理由驳回被拒、带理由取消且 notes 落库；浏览器：admin01 的被驳回订单显示理由 |
| 借用提交确认 + 直系上级提示 | 借用单一键提交无核对环节；提交后只有一行提示，忘记密码的流程外沟通缺少指引 | 所有身份提交借用单先弹出确认窗（仅物品与数量，可返回修改）；确认后弹出结果窗：普通用户「请联系：本部门管理员」、部门管理员「请联系：主席团」、超管「超级管理员免审」、免审活动「「活动名」活动免审」 | `src/pages/InventoryPage.tsx` | 浏览器：超管/部门管理员/免审活动三种结果文案均验证（截图 patch2x-borrow-confirm.png、patch2x-borrow-result-super.png） |
| 活动借用免审（负责人下一补丁） | 大型活动期间大量借用单逐单审批，对部门管理员与超管压力大 | 活动表新增 `auto_approve_borrows`；活动编辑页仅超管可勾选「该活动借用免审」；关联免审活动的借用单任何身份提交后直接借出（数量/并发校验一致，审计 `auto_source='activity'`）；借用弹窗活动下拉显示「（免审）」标记，活动卡片显示免审徽标；归还仍走统一验收 | `supabase/migrations/20261024120000_activity_auto_approve.sql`、`src/pages/InventoryPage.tsx` | SQL 回归：member/admin 关联免审活动直借、`auto_source` 审计、归还仍需验收；浏览器：创建免审活动→关联提交→直借结果提示 |
| 顶栏统计可点击 | 登录后顶栏「N 个待审批 / N 个借用待处理」只是文字，无法点击 | 改为按钮：待审批→物品审批（我的申请），借用待处理→借用监管（借用状态），成员的借用流程/未归还→借用状态 | `src/pages/InventoryPage.tsx`、`src/styles/main.css` | 浏览器：admin01 点击「个待审批」跳到「我的申请」 |
| 品牌改版：学部队徽 + 新名称 + 蓝色主题 | 品牌为「513 仓库 / 物品管理台」金色图标，主题色为绿色 | 顶栏、登录页、首次改密页、账户不可用页品牌统一替换为学部队徽（`public/department-emblem.jpg`，负责人提供的校方图样）与「信息技术学部 / 仓库借用系统」；浏览器标签标题同步；主样式全部绿色系色值按色相映射为队徽蓝色系（`--green/--green-dark/--green-soft` 变量更名为 `--brand*`），顶栏 CTA 由金色改为白底蓝字；语义状态色保留：琥珀=待审批/待分层、红=驳回/停用、已确认/已启用徽标转为品牌蓝 | `public/department-emblem.jpg`、`src/pages/DashboardPage.tsx`、`src/pages/InventoryPage.tsx`、`src/auth/LoginPage.tsx`、`src/auth/ChangeInitialPassword.tsx`、`src/auth/ProtectedRoute.tsx`、`src/components/DeveloperContact.tsx`、`src/styles/main.css`、`index.html` | 浏览器截图：登录页（rebrand-login.png）、顶栏品牌区（rebrand-topbar.png）、工作台；构建通过 |
| 工作台统计卡可点击 + 时段问候 | 工作台四张统计卡是静态文字，无法跳转；标题是固定文案 | 四张卡按角色映射为按钮（超管：库存→库存管理、待审批→审批中心、待借用→借用监管、活动→活动管理；部门管理员：成员→人员管理、借用/借出→借用监管、活动→活动管理；普通用户全部指向库存/借用状态），带 hover 抬升效果；Hero 标题改为按时段问候 + 姓名（早上好/上午好/中午好/下午好/晚上好/夜深了 + 「姓名，欢迎回来！」） | `src/pages/DashboardPage.tsx`、`src/styles/main.css` | 浏览器：问候语按当前时间显示、点击「启用中活动」卡跳到活动管理 |
| 非超管视图不受影响 | 部门管理员原可编辑本部门成员资料 | 保持原样：仅本部门普通用户、仅「编辑」；新增/删除入口只对 super_admin 渲染 | `src/pages/InventoryPage.tsx` | admin01 登录验证：无新增/删除按钮，仅见组织部成员 |
| 表单校验与导入规则一致 | — | 新增 `src/lib/accountAdmin.ts`：学号/姓名/部门/手机号/身份/邮箱/职位/备注校验 + 角色分组排序纯函数，服务端 `manage-accounts` 使用相同规则（与 import-accounts 的行校验逐条一致） | `src/lib/accountAdmin.ts`、`tests/accountAdmin.test.mjs` | `npm run test:auth-storage`（新增 4 个用例） |

说明：分组为纯前端展示逻辑，服务端权限不依赖分组；「超级管理员也可删其他超管」按需求允许，系统始终保留至少一名启用超管的保证来自「调用者必为启用超管 + 不能删除自己」（服务端强制），已在代码注释中说明。

## 数据库、函数与配置

- **补丁 2 新迁移 `20261024100000_super_admin_instant_borrow.sql`**：仅 `CREATE OR REPLACE FUNCTION public.create_borrow_order_batch`（重定义，函数签名不变），末尾 `NOTIFY pgrst, 'reload schema'`。无表结构、RLS、Storage、Auth 变更；不触碰既有业务数据。函数替换为瞬时操作，不锁业务表；旧前端继续可调用（非超管行为完全不变；超管提交后旧文案会显示「等待审批」但订单实际已借出，仅文案差异）。回退方案：重放上一版函数定义（20261013063513 中的版本）即可；过渡期若存在超管的 pending 旧单，仍可由另一名超管按原流程审批，无卡单风险。
- **补丁 3 批次新迁移**：
  - `20261024110000_borrow_review_rules.sql`：重定义 `review_borrow_return_request`（唯一超管自验放宽，其余逻辑逐行保留）与 `update_borrow_order_status`（取消必填理由，其余逻辑逐行保留）。无表结构变更。
  - `20261024120000_activity_auto_approve.sql`：`activities` 新增 `auto_approve_borrows BOOLEAN NOT NULL DEFAULT FALSE`（纯加列，旧行为默认不变），重定义 `create_borrow_order_batch`（活动校验改为读取免审标记；免审活动或超管身份 → 直接借出）。无其他表结构、RLS、Storage、Auth 变更。
  - 回退方案：分别重放 20261007103248 / 20261007104410 / 20261013063513 / 20261024100000 中的对应函数定义即回到前一行为；`auto_approve_borrows` 列可保留不影响旧逻辑。过渡期兼容：旧前端提交免审活动借用会直接借出但提示文案仍显示「等待审批」，属文案差异，前后端应一同发布。
- **补丁 3 批次之前各迁移/函数说明见上文**（20261024100000、manage-accounts、config.toml）。
- **补丁 1 追加 `reset_password` 与既有门禁的关系**：复用 `users_protect_password_change_flag` 触发器（service 上下文可写 `must_change_password`）与 `change-initial-password` 改密函数，未新增任何 SQL 对象；重置通过 `auth.admin.updateUserById` 改回初始密码，语义与新建账号一致。已登录的旧会话在其前端下次加载资料时同样被门禁拦截（`ProtectedRoute` 按 `must_change_password` 渲染改密页）。
- **补丁 1 新增 `supabase/functions/manage-accounts`**（动作 `create` / `delete` / `reset_password`）。鉴权与 `import-accounts` 完全同构：Bearer JWT → `auth.admin.getUser` → 校验 `users` 行 `is_active && role='super_admin' && !must_change_password`，否则 401/403。未改动既有三个函数与 `_shared/accounts.ts`（仅 import 其既有导出），`import-accounts` 部署产物不受影响。
- **`supabase/config.toml`**：新增 `[functions.manage-accounts] verify_jwt = false`，与既有三个账户函数一致（函数内部自行校验调用者身份）。
- **部署依赖顺序**：补丁 1 先部署 `manage-accounts` 函数再发静态站；补丁 2 先应用迁移再发静态站（顺序均可互换，旧前端兼容新后端）。三者相互独立。
- **回退方案**：补丁 1 静态站回退即可回到仅批量导入界面，函数可保留；补丁 2 回退 = 重放旧函数定义 + 静态站回退。无数据回退问题：`operation_logs` 只追加。
- **既有业务数据改写：无。** 补丁 1 删除路径要求目标人员无借用/归还/库存申请记录（服务端强制）；补丁 2 不改写任何存量订单，发布前已存在的 pending 单（含超管的）仍走原审批路径。
- 环境变量、Auth、Storage、依赖：无变化（未改 package.json / lockfile）。

## 验证证据

- 实际执行的命令与退出状态（2026-10-24，全部在本机执行，退出码 0）：
  - `npm ci`；`npm run check`（tsc + vite build）✓；`npm run test:auth-storage` → 18 tests / 18 pass / 0 fail（含新增 4 例）✓；`git diff --check` ✓
  - 补丁 2：SQL 回归 4 份全部 PASS——`workflow_approvals`、`concrete_borrow_locations`、`counted_inventory`（既有三份，验证未破坏既有矩阵）与新增 `super_admin_instant_borrow`（覆盖：超管直借状态/借出位置/审计标记/即时占用、超量拒绝、member 单管理员批准即借出、跨部门管理员拒绝、member 调用审批被管理员门禁拦截、admin 单自批拒绝/跨部门拒绝/超管批准、超管仍可批 member 单、超管归还走同一流程且需另一名超管验收、部门管理员不能验收超管归还）
  - 补丁 3 批次：上述回归继续全 PASS，`super_admin_instant_borrow` 新增断言——无理由驳回被拒/带理由取消且 notes 落库、member 与 admin 关联免审活动直借且 `auto_source='activity'` 审计、免审活动订单归还仍需验收、两名超管时自验被拒、停用其余超管后唯一超管自验通过；既有 `counted_inventory`、`concrete_borrow_locations` 中两处无理由取消调用已按新规则补上测试理由（行为变更的预期适配）
- 测试库标识：**本机 Docker 全新本地 Supabase 栈**（`supabase start`，API `http://127.0.0.1:54321`，项目 id `513base-hub`），与生产完全隔离。按 `docs/GETTING_STARTED.md` 顺序手工执行 4 个基础脚本 + 全部 9 条迁移（含 20261024100000），seed.sql 已加载，迁移历史登记到 `supabase_migrations.schema_migrations`。**环境修正**：本地库 seed 后 `inventory_item_number_seq` 未推进导致新增审批建号撞 ITEM0001（生产不存在此问题，正式库序列已初始化），已 `setval` 至 9200 后重跑全部回归。栈持续运行，dev server 在 `http://127.0.0.1:5175`（`.env.local` 指向本地栈）。
- Edge Function API 级验证（curl 直调本地函数网关）：
  - create：member/admin/super_admin 三身份成功（userId 2/3/4，部门自动 upsert，`must_change_password=true`）；学号重复 409；手机号非法 400；身份非法 400；无凭据 401
  - delete：无记录 member 成功（auth.users 与 public.users 同步 4→3，验证级联）；本人 409「不能删除当前登录的账号」；不存在 404；非整数 400；有借用单 409；有库存变更申请 409；清理后 super_admin 删除成功
  - 权限：部门管理员账号（admin01，已过首改密）调用 create/delete/reset_password 均 403「仅超级管理员可管理账号」
  - reset_password：将已改密的合成账号重置为初始密码后，旧密码登录被拒、`513base123` 登录成功、`must_change_password=true` 且 `password_changed_at` 清空；自重置 409、不存在 404、非法 ID 400
  - 审计：`operation_logs` 含 account_create / account_delete / account_password_reset 记录，与操作一一对应
- 三角色边界与自批等业务回归：本补丁不触碰借用/审批/归还流程（无 SQL、无 RPC 变更），未重跑 `supabase/tests/*.sql`；借用相关既有测试套件为 SQL 回归，需完整测试库，本次无涉及面。
- 桌面端截图（本地预览 `http://127.0.0.1:5175/login`，账号 boss01/合成账号 admin01，均为合成数据）：
  - `docs/images/zcode/patch1-users-grouped.png`：分组列表、每组新增按钮、自删禁用、删除成功提示
  - `docs/images/zcode/patch1-user-create-modal.png`：新增人员弹窗
  - `docs/images/zcode/patch1-password-reset.png`：重置密码成功提示与每行「重置密码」按钮（本人禁用）
  - `docs/images/zcode/patch1-forced-password-change.png`：被重置账号用初始密码登录后强制进入的「设置新密码」界面
  - `docs/images/zcode/patch2-super-instant-borrow.png`：超管提交借用单后订单直接「借出中」与免审核提示
  - `docs/images/zcode/patch2x-borrow-confirm.png`：借用提交前的物品/数量确认弹窗
  - `docs/images/zcode/patch2x-borrow-result-super.png`：超管提交后的免审结果弹窗（借出中订单在背后可见）
  - `docs/images/zcode/rebrand-login.png`：学部队徽 + 新名称 + 蓝色主题的登录页
  - `docs/images/zcode/rebrand-topbar.png`：应用顶栏品牌区特写
- 浏览器 GUI 走查（ZCode 内置浏览器）：超管分组顺序与人数、建号→入组、删除→空组、弹窗内校验错误（无效手机号）、admin01 受限视图（无新增/删除入口，仅本部门 member、仅编辑）、重置密码→初始密码登录→强制改密页→完成改密进入工作台、补丁 2 超管直借即时「借出中」、部门管理员借用待审批→超管批准→借出中、补丁 3 确认弹窗与三种提交结果文案（主席团/超管免审/活动免审）、免审活动创建与徽标、借用审批「确认借出/驳回」按钮、驳回必填理由且借用人订单显示理由、顶栏统计点击跳转，均通过。
- **未测试项 / 已知风险**：
  1. 手机端布局未实测（无真实设备）；分组标题与按钮使用了既有响应式类，小屏表现建议发布前抽查。
  2. 并发互删（两名超管同时删除对方）理论上可导致无启用超管；现有护栏不覆盖此竞态。如需绝对保证，可后续增加 DB 触发器（属新 migration，本补丁未做）。
  3. 「至少保留一名超管」依赖函数鉴权逻辑而非 DB 约束；超级管理员仍可按既有 RLS 策略从其他客户端直接对 `users` 表发起 DELETE（该面为本补丁之前已存在，未扩大）。
  4. Edge Function 为 Deno 运行时，本机 tsc 不覆盖 `supabase/functions/`（与既有三函数一致），已人工比对 import-accounts 的 API 用法并在本地栈实跑验证。
  5. 删除的 Auth 账号其历史 `operation_logs.user_id`、`borrow_orders.return_delegate_id` 等引用按既有外键置 NULL，属预期行为。
  6. 补丁 2 归还流程未做浏览器端到端（桌面无摄像头扫码），代码零改动且由 SQL 回归覆盖（含超管归还验收路径）；借用提交的手机端表现同未实测。
  7. 补丁 2 免审核直借没有撤销窗口：超管误提交的订单只能按正常流程提交归还申请再验收（负责人要求归还三身份一致）；负责人后续以提交前确认弹窗缓解误提交，未做时限撤销。
  8. 补丁 3 的「请联系：本部门管理员」未显示管理员姓名——成员受 RLS 限制读不到管理员资料；如需显示姓名须新增受控 RPC，本批未做。
  9. 补丁 3 唯一超管自验归还的判定是「全局启用超管数 ≤ 1」，与部门无关；两名超管互为备份时始终要求交叉验收。
- 确认：**没有对生产写入**（生产库、生产函数、生产静态站均未触碰），**没有 push、没有 PR、没有部署、没有账号导入**；所有验证都在本机隔离栈与本地 commit。

## Codex 发布建议

- 建议整合：单个本地 commit（见 `git log codex/zcode-improvements`），无补丁拆分需求。
- 发布顺序：① 部署 `manage-accounts` Edge Function（`verify_jwt=false`，无数据库操作）→ ② 发布静态站。顺序颠倒也无故障（旧前端不调用新函数）。
- 发布后 smoke：超管登录 → 人员管理三组可见 → 建一个测试身份成员 → 删除该成员 → 确认 admin 登录看不到增删入口。
- 回退条件：人员页白屏/接口 5xx 时先回退静态站到上一 release；函数可保留（旧前端不调用）。
- 尚需负责人决定的问题：① `supabase/.branches/` 是否加入 .gitignore；② 是否需要「最后一名超管」的 DB 级触发器约束（见未测试项 2）；③ 删除受历史记录保护的人员时目前提示改用「停用」，若负责人希望提供「彻底清除（连同历史）」的显式选项需另行设计。

## 流程观察（应负责人「整体流程有没有需要优化的地方」之问，仅讨论、未实现）

1. **事实澄清**：现行借用审批本来就是单级——部门管理员（或超管）批准后直接借出（`update_borrow_order_status` 把 approved 直接映射为 borrowed，`docs/WORKFLOWS.md` 也写明"不要求双重确认"）。负责人印象中的"双重审批"是**新增物品**（库存变更）流程：普通用户新增须部门管理员 + 超级管理员两级。因此补丁 2 对普通用户/部门管理员借用实际是"维持现状"，唯一行为变化是超管免审核直借。
2. **超管归还验收的单点依赖（建议优先讨论）**：超管的借用现在免审核，但归还仍须另一名超管验收（SQL 明确拒绝部门管理员验收非 member 单）。若系统只剩一名启用超管，其归还申请会永远挂在 `return_requested`，对应库存一直被占用。可选方案：a) 维持现状但把"至少两名启用超管"写入人员管理提示；b) 允许部门管理员验收超管订单的归还（归还验收有扫码原位校验 + 照片，敏感度低于审批）；c) 单超管时允许其自行验收（削弱控制，不推荐）。
3. **免审核误借无撤销窗口**：直借订单没有 pending 阶段，误提交只能走归还申请 + 验收。可选：允许借用人在"提交后 N 分钟内且未提交归还"自行取消（需要新迁移与规则，本次未做）。
4. **超期未还缺乏可见性**：订单有 `expected_return_date`，但借用监管没有超期标记或提醒，免审核直借会让超管自己的超期更常见。可选优化：借用监管列表对超期订单加红色标记/工作台计数（纯前端可做）。
5. **普通用户借用失去超管事前把关**：原来超管能在借出前看到全部申请，现在只能事后在「借用监管」里看。当前借用监管已可见全部订单，若需要更强的事后监督，可在工作台给超管加"本周借出 N 单"类统计。

—— 以上由 Zcode 于 2026-10-24 提交，等待 Codex 审核。

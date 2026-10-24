# 513 仓库系统 · 第三方审核清单（供 GPT 审阅）

撰写日期：2026-10-24。本文由开发方（Zcode）整理，请审核者按第 9 节的输出模板给出结论。审核对象是本地分支 `codex/zcode-improvements` 上的 7 个 commit，**尚未推送、未部署、未改动生产**。

---

## 1. 审核任务说明

你是本次改动的外部审核者。请基于第 4 节的"既有规则基准"和第 5 节的"分补丁审核要点"，逐项判断改动是否：

- 正确实现所述需求，且**没有破坏既有权限与业务规则**（第 4 节）；
- 数据库迁移语义清晰、可回退、对旧前端兼容；
- 前端隐藏按钮之外，后端（RLS / RPC / Edge Function）仍有同等强制力；
- 风险披露诚实（第 7 节的未测试项是否与你发现的相符）。

最终按第 9 节模板输出：总体结论（通过 / 有条件通过 / 不通过）+ 按严重级别分级的问题清单。

## 2. 背景与授权边界

- 系统现状：React 19 + Vite 8 + TypeScript 静态 SPA（部署于 Nginx `/513base/`），后端为托管 Supabase（project ref `cvurrazwebjtfffmkymn`，PostgreSQL 17），业务表全部启用 RLS，三个既有 Edge Functions（student-login / import-accounts / change-initial-password，均 `verify_jwt=false` 且内部自校验调用者）。
- 分工：负责人提需求 → Zcode 本地开发与验证 → 审核者审核 → 审核通过后由维护者（Codex）推送与发布。**开发方无推送/部署/生产写权限，本分支全部成果仅在本地。**
- 审核批准只针对明确的 commit 范围：base `02896f67a6999ef49048addd55b15c9d855661de`（= 交接时 `origin/main`）→ HEAD `314ee53752aa02ef7dbed46a6d4f1b23e75a8bbf`。批准后再改代码需重新审核。

## 3. 交付物总览

分支 commit（自底向上）：

| # | Commit | 摘要 |
| --- | --- | --- |
| 1 | `9105f06` | 人员管理：超管单人增删账号（新 Edge Function `manage-accounts`）+ 页面按账号等级分组展示 |
| 2 | `3c2f1bf` | 超管一键重置任意账号密码回初始密码 `513base123`，重置后强制重新走首改密门禁 |
| 3 | `05be47e` | 借用审批：超级管理员提交借用单免审核直接借出（迁移 20261024100000） |
| 4 | `beb2070` | 借用审核规则（唯一超管可自验归还、驳回必填理由，迁移 20261024110000）+ 活动借用免审（迁移 20261024120000）+ 借用提交确认弹窗与"联系上级"提示 + 顶栏统计可点击 + 审批按钮文字化 |
| 5 | `d401ce5` | 品牌改版：学部队徽 + 「信息技术学部 / 仓库借用系统」+ 全站绿色主题转队徽蓝 |
| 6 | `af268b7` | 工作台统计卡可点击跳转 + 时段问候语 |
| 7 | `314ee53` | 工作台重构：常用操作按角色补偶、右栏今日待办 + 近期流转动态、/app 顶栏返回工作台、管理员公告只读 |

变更规模：31 个文件，+1725 / -274。导出补丁供审阅：

```bash
git diff --binary 02896f67a6999ef49048addd55b15c9d855661de..314ee53752aa02ef7dbed46a6d4f1b23e75a8bbf > zcode-review.diff
# 或按 commit 导出：
git format-patch 02896f67a6999ef49048addd55b15c9d855661de..codex/zcode-improvements
```

关键文件：`supabase/functions/manage-accounts/index.ts`（新）、`supabase/migrations/2026102410{0000,1100,1200}0_*.sql`（新 ×3）、`supabase/tests/super_admin_instant_borrow.sql`（新回归）、`src/pages/InventoryPage.tsx`、`src/pages/DashboardPage.tsx`、`src/lib/accountAdmin.ts`（新）、`src/styles/main.css`。

## 4. 审核基准：不能被破坏的既有规则

逐条核对改动后仍然成立（这是本次审核最重要的部分）：

1. 权限三级 `super_admin / admin / member`，依据 `public.users` 角色 + 启用状态 + 首次改密门禁；**前端隐藏按钮不能替代数据库权限**。
2. 正式库存与新增申请分离；成员新增须部门管理员 + 超管两级审批；管理员新增由其他超管审批；申请人不得自批。
3. 部门管理员的权限限定在本部门，不能通过前端参数突破 RLS 或受控 RPC。
4. 归还必须按借出前位置扫码，二维码格式 `513-warehouse:A1`，具体位置仅 A1-D4、FLOOR、DOOR；`PENDING_*` 位置不得借出。
5. 数量为纯整数字符串时按数量借用，文本数量整项借用；`pending/approved/borrowed/return_requested` 状态占用库存；取消释放占用；并发锁与不超借必须保留。
6. 代还不改变原借用人责任；提交归还后仍须管理员验收。
7. 学号登录复用 Supabase Auth；账号导入与首次改密不可绕过；不得重置正式人员密码/角色/Auth 关联（管理员主动重置功能除外，见 5.2）。
8. `operation_logs` 仅超管可读；所有敏感操作必须留审计。

## 5. 分补丁审核要点

### 5.1 人员管理增删与分组（9105f06）

- 新增 Edge Function `manage-accounts`：动作 `create` / `delete`。鉴权链与 `import-accounts` 同构：Bearer JWT → `auth.admin.getUser` → 查 `users` 行校验 `is_active && role='super_admin' && !must_change_password`，否则 401/403。
- **审核点 A1**：create 流程是否与 `import-accounts` 等价（学号唯一性、部门 upsert、初始密码、`must_change_password=true`、资料保存失败时清理 Auth 账号）。
- **审核点 A2**：delete 的护栏是否充分——拒绝自删；存在 `borrow_orders` / `borrow_return_requests` / `inventory_change_requests` 记录时拒绝（因 `auth.users → users → borrow_orders` 全链 CASCADE 会连带清除业务历史）；操作写审计。
- **审核点 A3**：已知残余风险——两名超管并发互删理论上可导致无启用超管（见 7.2）；超管仍可按既有 RLS 直接对 `users` 表 DELETE（改动前已存在的面，未扩大）。
- 前端分组为纯展示；`src/lib/accountAdmin.ts` 的校验规则与 `import-accounts` 行校验逐条一致（4 个单测覆盖）。

### 5.2 一键重置密码（3c2f1bf）

- `manage-accounts` 新增 `reset_password`：`auth.admin.updateUserById` 改回 `513base123` + `must_change_password=true`、`password_changed_at=null`（复用既有 `users_protect_password_change_flag` 触发器的 service 豁免）。
- **审核点 B1**：自重置 409；未关联 Auth 的资料 409；非超管 403。
- **审核点 B2**：重置语义与新建账号一致——初始密码已知是既有设计（导入同样发固定初始密码），重置不引入新的暴露面；审计 `account_password_reset`。

### 5.3 超管借用免审核（05be47e）

- 迁移 20261024100000 重定义 `create_borrow_order_batch`：`actor_role='super_admin'` 时订单直接以 `borrowed` 写入（含 `borrowed_at`），`borrow_items.borrow_location_code` 仍由既有 INSERT 触发器快照并校验二维码位置。
- **审核点 C1**：直借路径的数量护栏——物品行 `FOR UPDATE` 锁 + 冲突检查在插入前完成，与普通提交完全一致；`guard_borrow_approval_quantity` 触发器（UPDATE 时）不覆盖 INSERT，是否存在绕过窗口？
- **审核点 C2**：`update_borrow_order_status` 完全未改动；成员/管理员审批链行为不变。

### 5.4 借用审核规则 + 提交确认 + 活动免审（beb2070）

- 迁移 20261024110000：
  - `review_borrow_return_request`：自验放宽**仅当** 操作者=借用人、角色 super_admin、且全局启用超管数 ≤ 1；审计标记 `self_reviewed_lone_super_admin`。
  - `update_borrow_order_status`：`p_status='cancelled'` 时必须携带非空理由，写入订单 `notes`（前端驳回弹窗必填，借用人订单行显示）。
- 迁移 20261024120000：`activities.auto_approve_borrows`（默认 FALSE，纯加列）；`create_borrow_order_batch` 关联免审活动时任何身份直借，审计 `auto_source='activity'`；活动校验逻辑不变（必须 active）。
- 前端：所有身份提交借用单先弹确认窗（仅物品+数量），确认后按身份显示联系对象（成员→本部门管理员、管理员→主席团、超管/免审活动→免审说明）。
- **审核点 D1**：唯一超管自验的条件组合是否可能被滥用（例如暂时停用另一名超管后自审——停用本身是超管操作且留审计，属于负责人接受的设计权衡）。
- **审核点 D2**：免审活动直借对"普通用户"的放开是否符合负责人意图（原话：大型活动期间减轻审批压力，活动免审由超管创建时勾选；归还仍走统一验收）。
- **审核点 D3**：`update_borrow_order_status` 中 `notes` 覆盖语义——原逻辑"p_notes 为 NULL 时保留原值"被保留，取消时必填理由写入；是否存在把驳回理由误写入借出单的路径？

### 5.5 品牌改版与工作台重构（d401ce5 / af268b7 / 314ee53）

- 纯前端为主：品牌资源 `public/department-emblem.jpg`、文案替换、CSS 全量绿色系→蓝色系（按色相映射，`--green*` 变量更名为 `--brand*`）；语义状态色（琥珀=待审批、红=驳回/停用）保留。
- 工作台：统计卡按角色可点击跳转；常用操作按角色补偶（超管 6 / 管理员 6 / 成员 4）；右栏「今日待办 + 近期流转」；/app 顶栏新增返回工作台；公告管理按钮仅超管渲染（后端 RLS 本就仅超管可写）。
- **审核点 E1**：CSS 大范围替换是否遗漏或产生对比度问题（脚本按 HSL 色相 90°–200° → 214° 映射，琥珀/红/蓝原有色不动）。
- **审核点 E2**：管理员进入公告页为只读（发布/编辑/删除按钮已门控），成员的"我的申请"仅指向既有 requests 视图。
- **审核点 E3**：无新依赖、无路由/鉴权结构变化；`index.html` 仅标题文案。

## 6. 数据库迁移清单与发布顺序

| 迁移 | 内容 | 回退方式 |
| --- | --- | --- |
| 20261024100000 | 重定义 `create_borrow_order_batch`（超管直借） | 重放 20261013063513 中的旧函数定义 |
| 20261024110000 | 重定义 `review_borrow_return_request`（唯一超管自验）+ `update_borrow_order_status`（驳回必填理由） | 重放 20261007103248 / 20261007104410 中的旧函数定义 |
| 20261024120000 | `activities` 加列 `auto_approve_borrows`（默认 FALSE）+ 再次重定义 `create_borrow_order_batch`（活动免审） | 列可保留；函数回退同上 |

- 无 DDL 之外的表结构变更；无 RLS/Storage/Auth 变更；不动存量业务数据。
- 发布顺序：三个迁移 → 部署 `manage-accounts` 函数 → 发布静态站。旧前端 + 新后端兼容（仅提交结果提示文案差异）；新前端 + 旧后端时超管直借/活动免审不生效（提示文案为"等待审批"），无功能故障。
- 注意：`create_borrow_order_batch` 被迁移 20261024100000 与 20261024120000 先后重定义，**审核 diff 时请以 20261024120000 的最终版本为基准**，与 20261013063513 的旧版本对比。

## 7. 验证证据与未验证项

已做（2026-10-24，本机隔离环境，退出码 0）：

- `npm run check`（tsc + vite build）✓；`npm run test:auth-storage` 18/18 ✓（新增 accountAdmin 4 例）；`git diff --check` ✓。
- 本地 Docker Supabase 栈：基础脚本 + 全部 11 条迁移（含新增 3 条）+ seed；SQL 回归 4 份全部 PASS（workflow_approvals、concrete_borrow_locations、counted_inventory、新增 super_admin_instant_borrow 265 行，覆盖直借/驳回理由/活动免审/唯一超管自验/越权 401-403-404-409 全路径）。
- Edge Function API 级验证：create/delete/reset_password 全分支（含越权、重复学号、自删、有历史记录拒绝、级联删除生效、审计落库）。
- 浏览器 GUI 走查：人员分组/建号/删除/重置密码→强制改密闭环、借用确认弹窗与三种联系文案、活动免审创建→直借、驳回理由在借用人订单可见、顶栏跳转、返回工作台、管理员公告只读（截图见 `docs/images/zcode/`）。
- 环境修正说明：本地库 seed 后 `inventory_item_number_seq` 未推进，已 setval 至 9200（生产不存在该问题）；既有测试中两处无理由取消调用按新规则补上理由。

**未验证 / 已知风险（请审核者确认是否接受）**：

1. 手机端布局未实测（无真实设备）；扫码归还的浏览器端到端未跑（桌面无摄像头，SQL 回归覆盖且该代码零改动）。
2. 两名超管并发互删的竞态未做 DB 级约束（函数层护栏不覆盖并发窗口）。
3. 免审直借无撤销窗口（负责人选择以提交前确认弹窗缓解）。
4. 「请联系：本部门管理员」未显示管理员姓名——成员受 RLS 限制无法读取管理员资料，需显示姓名须新增受控 RPC（未做）。
5. 唯一超管自验的判定是全局启用超管数 ≤ 1，与部门无关。
6. 旧前端 + 新数据库组合下免审直借已生效但提示文案滞后（发布时应前后端同批上线）。

## 8. 待负责人决策（不阻塞审核，但请审核者表态）

1. `supabase/.branches/`（CLI 本地目录）是否加入 .gitignore。
2. 是否要"至少一名启用超管"的 DB 触发器约束（覆盖并发窗口）。
3. 有借用历史的人员目前只能停用不能删除，是否需要"彻底清除"显式选项。
4. 「请联系」是否需要显示管理员姓名（需新增受控 RPC）。
5. 品牌配色中"已确认/启用"徽标由绿转蓝是否符合预期（红/琥珀语义色未动）。

## 9. 审核输出模板（请按此回复）

```markdown
## 总体结论：通过 / 有条件通过 / 不通过

## 分补丁结论
- 5.1 人员管理增删：…（引用审核点 A1–A3 逐条表态）
- 5.2 重置密码：…
- 5.3 超管免审核：…（C1 并发窗口结论）
- 5.4 审核规则/活动免审：…（D1–D3 逐条表态）
- 5.5 品牌与工作台：…（E1–E3 逐条表态）

## 问题清单
- [P0 阻塞] …（必须修改才能发布）
- [P1 重要] …（发布前应修改或有书面豁免）
- [P2 建议] …（可下批处理）

## 基准核对
- 第 4 节 8 条既有规则逐条：保持 / 被破坏（指出位置）

## 回答待决策问题（第 8 节 1–5）
```

---

附：开发方对审核边界的声明——本次全部开发与验证仅发生在本地 checkout（`/Users/love_zmyself/.zcode/workspace/20f42caa-b5cf-4b59-a41f-5b579ef51ef0/513base-zcode`）与本机 Docker 隔离栈；未 push、未开 PR、未部署、未对生产数据库/函数/服务器做任何写入，未导入真实账号或创建测试订单。详细修改背景见同目录 `docs/ZCODE_CHANGE_REVIEW.md`（内容更细，与本文互为补充）。

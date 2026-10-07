# 513 学部仓库物品借用管理系统

武汉纺织大学外经贸学院信息技术学部 513 仓库管理系统，由 lovezmyself 于 2026 年设计。

## 项目背景

信息技术学部仓库数字化管理平台，用于管理物品借用、归还、库存查询等功能。

### 仓库布局
- **货架区域**: A、B、C、D 四个货架，每个货架4层（A1-A4, B1-B4, C1-C4, D1-D4）
- **其他区域**: 地板（FLOOR）、门后（DOOR）

## 技术方案

### 数据存储
- **Supabase** 免费套餐（PostgreSQL + Storage）
- 图片存储在 Supabase Storage
- 物品数据存储在 PostgreSQL

### 前端部署
- 单页 Web 应用（H5响应式）
- 部署在现有轻量云服务器（国内）
- 通过现有域名访问

### 开源框架参考
- [Shelf.nu](https://github.com/Shelf-nu/shelf.nu) - IT资产管理系统
- [minorCoder/Goods](https://github.com/minorCoder/Goods) - 国内物品借用管理

## 数据初始化

### 工具：微信聊天记录批量提取

使用 `wechat_inventory_processor.py` 脚本处理300多条微信消息（图片+文字描述）

#### 使用方法

1. 运行脚本：
```bash
python3 wechat_inventory_processor.py
```

2. 复制微信聊天记录粘贴到终端，格式示例：
```
kt板
[图片]
彩色纸 5包
[图片]
a1
剪刀 2把
[图片]
胶带
b2
```

3. 输入 `END` 结束，脚本自动生成：
   - `inventory.csv` - Excel可直接打开
   - `inventory.json` - 程序导入用
   - `inventory_import.sql` - Supabase SQL脚本

#### 数据格式

| 编号 | 物品名称 | 位置 | 数量 | 原始描述 |
|------|---------|------|------|---------|
| ITEM0001 | kt板 | A2 | 若干 | kt板 |
| ITEM0002 | 彩色纸 | B3 | 5 | 彩色纸 5包 |

#### 位置编码规范

- `A1`-`A4`: A货架1-4层
- `B1`-`B4`: B货架1-4层
- `C1`-`C4`: C货架1-4层
- `D1`-`D4`: D货架1-4层
- `FLOOR`: 地板
- `DOOR`: 门后

## 数据库设计（Supabase）

正式结构见 `supabase/schema_v2.sql` 和 `supabase/migrations/`。库存存于 `inventory_items`，借用单与明细存于 `borrow_orders`、`borrow_items`，新增审批存于 `inventory_change_requests`，归还申请与逐件扫码记录存于 `borrow_return_requests`、`borrow_return_items`。Supabase Auth 与 `users.auth_user_id` 关联，权限由 RLS 和受控 RPC 执行。

## 当前数据

- 已完成 92 张物品图片的视觉整理与编号，唯一物品编号为 `ITEM0001` 至 `ITEM0092`
- 唯一编号与中文名称、存放位置分离：改名或移动物品不会改变 `ITEM` 编号
- 正式货架位置仅使用 `A1-A4`、`B1-B4`、`C1-C4`、`D1-D4`
- 原始图片只能确认货架、不能确认层数的物品使用 `PENDING_A` 至 `PENDING_D`，需要在管理台中完成分层
- 地板和门后区域使用 `FLOOR`、`DOOR`

数据文件：

- `inventory.csv`：Excel 可打开的当前库存
- `inventory.json`：前端或程序导入数据
- `inventory_image_manifest.csv`：图片原文件与新文件的完整映射
- `supabase/schema.sql`：货架、物品和位置移动历史表
- `supabase/seed.sql`：92 项初始化数据

## 仓库管理台

登录后会先进入按角色分流的 dashboard；开发环境管理台位于 `/app/*`，生产环境位于 `/513base/app/*`。管理台支持按货架和层级查看物品，并管理编号、名称、规格、数量、图片文件名、位置和借用状态。正式库存与待审批申请分表保存，审批完成前不会上架。

三个角色均可提出新增申请。普通用户的新增申请同步供本部门管理员和超级管理员审核，两方均通过后才进入正式库存；部门管理员或超级管理员提交的申请由其他超级管理员审核，不能自批。部门管理员仍可提出修改和删除申请，超级管理员保留正式库存管理权限。

三个角色均可批量勾选物品填写借用单；勾选后主操作按钮切换为“填写借用单”。普通用户订单由本部门管理员或超级管理员审批；管理员自己的订单交由其他超级管理员处理。审批通过会直接进入“借出中”并记录数据库借出时间，库存列表和详情同步显示状态。管理员可维护活动，借用单可关联启用中的活动。勾选库存后可导出只包含物品名称、编号和位置的 XLSX 清单。

权限分为三层：

- `super_admin`：维护全部库存、部门、人员和审批数据，导入账号；可以申请新增和借用，不能审核自己提交的新增、借用或归还申请。
- `admin`：维护本部门普通用户资料，审核本部门普通用户的新增、借用和归还申请；可以申请新增和借用，自己的申请由超级管理员审核。
- `member`：查看库存、申请新增、批量借用、查看本人及被委托的借用状态、提交二维码验证的归还申请（照片可选）；不能直接修改正式库存。

部门由超级管理员动态新增、编辑和删除。删除部门不会删除用户或历史订单，其部门字段会变为未分配。

登录默认使用学号和密码，兼容原有邮箱账号。学号通过受限的 `student-login` Edge Function 验证，仍使用原 Supabase Auth 用户与 session，不会另建一套认证体系。学号会去除首尾空格并转为小写，数据库保证规范化后的唯一性。前端不开放注册；新导入账号必须先完成首次改密才能访问业务数据，改密门禁也由数据库权限执行。

生产入口为 `https://lzmyselfai.cn/513base/`，登录为 `/513base/login`，管理台为 `/513base/app`。Vite 生产构建和 React Router 共用 `/513base/` 基路径；开发服务仍使用 `/login` 和 `/app`。未登录访问业务路由时会跳转登录，登录后保留原目标路径。

```bash
npm install
cp .env.example .env.local
npm run dev
```

在 `.env.local` 中填入 Supabase Dashboard > Project Settings > API 中的 publishable key：

```dotenv
VITE_SUPABASE_URL=https://cvurrazwebjtfffmkymn.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
```

publishable key 可以安全地用于浏览器；不要把 secret key 或 `service_role` key 放进任何 `VITE_` 环境变量。

默认访问 `http://localhost:5173/`。生产构建：

```bash
npm run build
```

构建结果位于 `dist/`，其中包含全部初始物品图片。新上传图片使用 Supabase Storage 的 `inventory-images` bucket。

## Supabase 初始化

在空的开发库中，Supabase SQL Editor 依次执行：

1. `supabase/schema_v2.sql`
2. `supabase/seed.sql`（仅全新开发库的 92 项初始库存）
3. `supabase/auth_and_rls.sql`
4. `supabase/inventory_workflow.sql`
5. `supabase/storage_images.sql`
6. `supabase/migrations/202609220001_borrow_activities.sql`
7. `supabase/migrations/202609270001_borrow_returns.sql`
8. `supabase/migrations/202610060001_requirements.sql`
9. `supabase/migrations/20261007103248_workflow_approvals_and_return_delegates.sql`
10. `supabase/migrations/20261007103355_student_login_account_import.sql`
11. `supabase/migrations/20261007104410_concrete_borrow_locations.sql`
12. `supabase/verify_setup.sql`（只读验证）

现网项目 `cvurrazwebjtfffmkymn` 已执行基础脚本和以上六条 migration，包括 2026-10-07 的三条新迁移。现网后续只运行审核后的新 migration 与 `verify_setup.sql`，不要重复执行 seed 或基础结构脚本。

三个账户 Edge Functions 已部署：`student-login`、`import-accounts`、`change-initial-password`。配置见 `supabase/config.toml`；学号登录允许匿名提交凭据，导入和改密服务会自行验证 bearer token，不能把关闭网关 JWT 校验理解为取消身份验证。服务端使用 Supabase 提供的环境变量，服务密钥不得进入前端或提交到仓库。

在 Authentication > Providers 中启用 Email，并关闭公开注册（Allow new users to sign up）；该开关仍需在生产配置复核。手工创建 Auth 用户时，触发器默认生成停用的 `member` 资料，再由超级管理员分配权限；受控 Excel 导入会关联 Auth 用户、分配角色和部门、启用资料并强制首次改密。在 Authentication > URL Configuration 中设置站点 URL。生产 Nginx 仅将 `/513base/` 下的业务路由回退到 `/513base/index.html`，确保登录和页面刷新不会影响同域其他项目。

首次启用时，在 Supabase Authentication 中创建第一个账号，再通过受信任的服务端操作将对应 `public.users.role` 设为 `super_admin` 并启用资料。不要在浏览器端使用 `service_role` 或 secret key。

## 账号 Excel 导入

超级管理员可在人员管理下载模板、预览校验并批量导入部门、姓名、手机号、学号和身份，联系邮箱、职位、备注为可选字段。不存在的部门会自动建立；已存在的学号不会被覆盖。导入结果逐行显示，可下载失败报告。文件上限 5 MB、500 人，前端分批提交，服务端每次校验最多 50 行。

当前模板为 `public/templates/account_import_template.xlsx`，交付副本位于 `outputs/2026-10-07-account-import/account_import_template.xlsx`，生成脚本为 `tools/create_student_account_template.mjs`。模板包含“账号导入模板”“填写说明”“部门与身份”三张表。服务统一设置初始密码，具体凭据通过私下交接提供；首次登录须设置包含字母和数字的 10 至 128 位新密码，不能继续使用初始密码。不要将已填写的人员资料或账号凭据提交到 GitHub。

`outputs/2026-09-21-account-import-template/account_import_template.xlsx` 是旧的 115 个名额整理模板，保留作历史参考；新增导入应使用 2026-10-07 模板。

## 二维码归还与代还

打印文件为 `output/pdf/513base-二维码标识套装.pdf`，包含 19 个二维码：生产登录入口、A1 至 D4 的 16 个货架层位、地板 `FLOOR` 和门后 `DOOR`。生成脚本为 `tools/generate_qr_signage.py`。登录码内容是生产 URL；位置码内容为 `513-warehouse:{位置编码}`，供系统内归还扫描使用。

归还必须逐件扫描借出前位置对应的官方二维码；前端扫描结果和数据库 RPC 均核对原位、位置码与二维码内容，并记录扫码提交时间。错误货架、待分层位置和缺少扫码信息均无法提交。照片可选，保存到私有 `borrow-return-images` bucket，经管理员核验后才完成归还。

借用人可在“借出中”的订单上按学号指定已启用的同学代还，也可修改或取消委托。代还人使用自己的账号登录，看到被委托订单后逐件扫码提交；原借用人仍承担物品责任，记录保留原借用人、实际提交人及审核人。任何管理员不能审核自己借用或自己提交的归还申请。

只有 A1 至 D4、FLOOR 和 DOOR 等具体位置可借出；`PENDING_A` 至 `PENDING_D` 的物品需先确认层位，新借用和审批均由数据库拦截。旧借出单若缺少具体归还位置，超级管理员可填写理由确认层位，操作写入审计日志。

`inventory_location_history` 会记录位置变更。审批借出、归还提交和确认归还使用数据库时间并显示到秒；二维码扫描用于验证位置码，最终仍由管理员核验物品归位。超级管理员可发布按角色定向的公告。侧边栏底部提供开发者头像、GitHub 项目地址与联系工单入口。

## 当前验收状态

1. ✅ 微信图片视觉整理与编号
2. ✅ 货架 CRUD 管理台
3. ✅ Supabase 表结构与初始化数据
4. ✅ Supabase Auth、三层 RLS 权限与在线数据库
5. ✅ 部门、人员、库存审批与借用监管后台
6. ✅ 创建三个验收账号并完成端到端角色验收
7. ✅ 云端基线版本已部署到 https://lzmyselfai.cn/513base/ （2026-10-07）
8. ✅ 2026-10-07 三条业务/认证迁移与三个账户 Edge Functions 已部署
9. ✅ 远端账户集成测试 42 项通过，包含导入、学号精确匹配、首次改密、数据库门禁及越权拒绝

本轮功能前端和远端数据库迁移已实现；浏览器回归已覆盖双重新增审批、三类身份借用、二维码归还、代还、Excel 导入和首次改密。同步到云端工作树后需重新执行静态发布和公网 smoke。真实手机摄像头、拍照/相册选择及移动网络表现仍需设备实测。

验收账号见 `HANDOFF.md`；密码只在交接对话中提供，不写入仓库、脚本或配置文件。

GitHub canonical 仓库为 `https://github.com/LoveZMyself11/513_warehouse_code.git`，旧的 `514_warehouse_code.git` 地址会重定向。已推送的 `10.7beta` 分支保存上云基线，发布提交为 `852d617`，分支交接记录提交为 `d72a900`；主工作区 `main` 的本轮功能改动尚待最终验收和发布。

基线部署源码保留在 `/Users/love_zmyself/.codex/worktrees/513base-cloud/514base_hub`，其中 `deploy/README.md` 包含发布和回退说明。主工作区本地开发服务保留；ngrok 内网穿透已于 2026-10-07 按要求关闭。本项目继续使用 Supabase ref `cvurrazwebjtfffmkymn`，不涉及服务器上其他项目的 Supabase 服务。

## 约束条件

- ❌ 不使用微信小程序（300元认证费）
- ❌ 学校/学部不出资
- ✅ 使用现有服务器和域名
- ✅ 数据存储用 Supabase 免费套餐
- ✅ 国内访问稳定性优先

## 联系方式

开发者：李在明（Love_ZMyself），计算机应用技术 2406 班。

GitHub：https://github.com/LoveZMyself11/513_warehouse_code

技术支持建议发送邮件至 `lovezmyself0511@gmail.com`，说明部门、姓名、问题详情并附截图。WeChat：`Love_ZMyself`，QQ：`2944095143`。

平静 坚毅 不流泪

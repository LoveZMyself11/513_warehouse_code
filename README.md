# 513 学部仓库物品借用管理系统

武汉纺织大学外经贸学院信息技术学部 513 仓库管理系统，由 lovezmyself 于 2026 年设计。

## 项目背景

浙江某高校学部仓库数字化管理平台，用于管理物品借用、归还、库存查询等功能。

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

```sql
-- 物品表
CREATE TABLE items (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  location TEXT NOT NULL,
  quantity TEXT,
  description TEXT,
  image_url TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 借用记录表
CREATE TABLE borrow_records (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  item_id TEXT REFERENCES items(id),
  borrower_name TEXT NOT NULL,
  borrower_contact TEXT,
  borrow_date TIMESTAMPTZ DEFAULT NOW(),
  expected_return_date DATE,
  actual_return_date TIMESTAMPTZ,
  status TEXT CHECK (status IN ('borrowed', 'returned', 'overdue')),
  notes TEXT
);
```

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

登录后会先进入按角色分流的 dashboard；库存和业务管理台位于 `/app/*`。管理台支持按货架和层级查看物品，并管理编号、名称、规格、数量、图片文件名、位置和借用状态。正式库存与普通用户提交的变更申请相互隔离，只有超级管理员审批后才会改变正式数据。

库存列表支持批量勾选物品，普通用户可据此填写一张包含多件物品的借用单；借用状态会显示在物品列表和详情抽屉中。管理员可维护活动，借用单可关联启用中的活动。勾选库存后可导出只包含物品名称、编号和位置的 XLSX 清单，不包含图片。

权限分为三层：

- `super_admin`：维护全部库存、部门、人员、借用订单和审批数据。
- `admin`：分配给各部门部长或副部长，只能维护本部门普通用户，并监管本部门借用订单状态。
- `member`：查看库存、批量提交借用申请、查看借用状态、提交二维码验证的归还申请（照片可选）；不显示库存变更申请入口。

部门由超级管理员动态新增、编辑和删除。删除部门不会删除用户或历史订单，其部门字段会变为未分配。

管理台使用 Supabase Auth 的邮箱/密码登录保护。`/` 是受保护路由；未登录访问会跳转到 `/login`。为避免任何访客自行注册后取得库存权限，前端不开放注册入口，请在 Supabase Dashboard 的 Authentication > Users 中邀请或创建账户。

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
2. `supabase/auth_and_rls.sql`
3. `supabase/inventory_workflow.sql`
4. `supabase/storage_images.sql`
5. `supabase/migrations/202609220001_borrow_activities.sql`
6. `supabase/migrations/202609270001_borrow_returns.sql`
7. `supabase/migrations/202610060001_requirements.sql`
8. `supabase/verify_setup.sql`（只读验证）

现网项目已经执行过基础脚本和三条 migration；现网后续只运行审核后的 `supabase/migrations/*.sql` 与 `verify_setup.sql`，不要重复执行 seed 或基础结构脚本。

然后在 Authentication > Providers 中启用 Email，并关闭公开注册（Allow new users to sign up）。在 Authentication > Users 中邀请或创建获准使用的账户；触发器会自动创建默认停用的 `member` 用户资料，再由超级管理员在后台分配角色、部门、职位并启用。在 Authentication > URL Configuration 中设置站点 URL。生产服务器需把未知路径回退到 `index.html`，确保直接访问 `/login` 时仍由 React Router 处理。

首次启用时，在 Supabase Authentication 中创建第一个账号，再执行一次 SQL 将该账号对应的 `public.users.role` 改为 `super_admin`。不要在浏览器端使用 `service_role` 或 secret key。

统一账号模板位于 `outputs/2026-09-21-account-import-template/account_import_template.xlsx`，包括 5 个超级管理员、10 个普通管理员和 100 个普通用户占位行。模板不包含真实密码，已填写的密码文件不得提交到 GitHub。

`inventory_location_history` 会在物品位置改变时自动记录原位置、新位置和时间。借用实际交付、归还申请提交和管理员确认归还均使用数据库时间并在页面显示到秒。归还必须逐件扫描并验证借出前位置对应的货架二维码，照片可选；照片保存在私有 `borrow-return-images` bucket，经管理员核验后订单才变为已归还。超级管理员可在公告管理中发布按角色定向的系统公告。

## 当前验收状态

1. ✅ 微信图片视觉整理与编号
2. ✅ 货架 CRUD 管理台
3. ✅ Supabase 表结构与初始化数据
4. ✅ Supabase Auth、三层 RLS 权限与在线数据库
5. ✅ 部门、人员、库存审批与借用监管后台
6. ✅ 创建三个验收账号并完成端到端角色验收
7. ✅ 当前版本已部署到 https://lzmyselfai.cn/513base/ （2026-10-07）

验收账号见 `HANDOFF.md`；密码只在交接对话中提供，不写入仓库、脚本或配置文件。

部署源码暂保留在 `/Users/love_zmyself/.codex/worktrees/513base-cloud/514base_hub`，其中 `deploy/README.md` 包含发布和回退说明。主工作区 `5174` 开发服务继续保留；内网穿透已关闭。学号登录、Excel 导入和新审批规则尚未进入本次云端版本。

## 约束条件

- ❌ 不使用微信小程序（300元认证费）
- ❌ 学校/学部不出资
- ✅ 使用现有服务器和域名
- ✅ 数据存储用 Supabase 免费套餐
- ✅ 国内访问稳定性优先

## 联系方式

项目负责人：love_zmyself

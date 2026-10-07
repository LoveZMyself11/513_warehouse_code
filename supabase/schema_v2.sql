-- ============================================
-- 513 仓库管理系统 - 完整数据库架构 v2
-- ============================================

-- 清理现有表（开发环境使用，生产环境请谨慎）
-- DROP TABLE IF EXISTS operation_logs CASCADE;
-- DROP TABLE IF EXISTS borrow_items CASCADE;
-- DROP TABLE IF EXISTS borrow_orders CASCADE;
-- DROP TABLE IF EXISTS users CASCADE;
-- DROP TABLE IF EXISTS departments CASCADE;
-- DROP TABLE IF EXISTS inventory_location_history CASCADE;
-- DROP TABLE IF EXISTS inventory_items CASCADE;
-- DROP TABLE IF EXISTS inventory_locations CASCADE;

-- ============================================
-- 1. 位置管理表
-- ============================================
CREATE TABLE IF NOT EXISTS inventory_locations (
  code TEXT PRIMARY KEY CHECK (
    code ~ '^[A-D][1-4]$'
    OR code IN ('FLOOR', 'DOOR', 'PENDING_A', 'PENDING_B', 'PENDING_C', 'PENDING_D')
  ),
  label TEXT NOT NULL,
  sort_order INTEGER NOT NULL UNIQUE,
  is_pending_level BOOLEAN NOT NULL DEFAULT FALSE
);

-- ============================================
-- 2. 物品表
-- ============================================
CREATE TABLE IF NOT EXISTS inventory_items (
  id TEXT PRIMARY KEY CHECK (id ~ '^ITEM[0-9]{4}$'),
  name TEXT NOT NULL CHECK (btrim(name) <> ''),
  location_code TEXT NOT NULL REFERENCES inventory_locations(code),
  specification TEXT,
  quantity TEXT NOT NULL DEFAULT '若干',
  image_name TEXT,
  image_path TEXT,
  recognition_status TEXT NOT NULL DEFAULT '已确认',
  source_sequence INTEGER UNIQUE,
  qr_code_url TEXT, -- 二维码图片URL
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================
-- 3. 物品位置历史表
-- ============================================
CREATE TABLE IF NOT EXISTS inventory_location_history (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  item_id TEXT NOT NULL REFERENCES inventory_items(id) ON DELETE CASCADE,
  from_location TEXT REFERENCES inventory_locations(code),
  to_location TEXT NOT NULL REFERENCES inventory_locations(code),
  moved_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================
-- 4. 部门表
-- ============================================
CREATE TABLE IF NOT EXISTS departments (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name TEXT NOT NULL UNIQUE CHECK (btrim(name) <> ''),
  description TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================
-- 5. 用户表
-- ============================================
CREATE TABLE IF NOT EXISTS users (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  student_id TEXT UNIQUE, -- 学号
  name TEXT NOT NULL CHECK (btrim(name) <> ''),
  department_id BIGINT REFERENCES departments(id) ON DELETE SET NULL,
  phone TEXT,
  email TEXT,
  position TEXT,
  notes TEXT,
  role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('super_admin', 'admin', 'member')),
  pin_hash TEXT, -- PIN码哈希值（bcrypt）
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  auth_user_id UUID, -- Supabase Auth 用户ID（如果使用邮箱/手机登录）
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE users ADD COLUMN IF NOT EXISTS position TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS notes TEXT;

-- ============================================
-- 5.1 物品数据变更请求（与正式库存隔离）
-- ============================================
CREATE TABLE IF NOT EXISTS inventory_change_requests (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  request_type TEXT NOT NULL CHECK (request_type IN ('create', 'update', 'delete')),
  item_id TEXT CHECK (item_id IS NULL OR item_id ~ '^ITEM[0-9]{4}$'),
  result_item_id TEXT CHECK (result_item_id IS NULL OR result_item_id ~ '^ITEM[0-9]{4}$'),
  proposed_name TEXT,
  proposed_location_code TEXT REFERENCES inventory_locations(code),
  proposed_specification TEXT,
  proposed_quantity TEXT,
  proposed_image_name TEXT,
  proposed_image_path TEXT,
  proposed_recognition_status TEXT,
  reason TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  requested_by BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reviewed_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  review_note TEXT,
  reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (
    (request_type = 'create' AND item_id IS NULL AND proposed_name IS NOT NULL AND proposed_location_code IS NOT NULL)
    OR (request_type IN ('update', 'delete') AND item_id IS NOT NULL)
  )
);

-- ============================================
-- 6. 借用订单表
-- ============================================
CREATE TABLE IF NOT EXISTS borrow_orders (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  order_number TEXT UNIQUE NOT NULL, -- 订单号，如 BO20260919001
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  department_id BIGINT REFERENCES departments(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (
    status IN ('pending', 'approved', 'borrowed', 'returned', 'cancelled')
  ),
  reason TEXT, -- 借用理由
  expected_return_date DATE, -- 预计归还日期
  actual_return_date TIMESTAMPTZ, -- 实际归还时间
  notes TEXT, -- 备注
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================
-- 7. 借用详情表（订单中的具体物品）
-- ============================================
CREATE TABLE IF NOT EXISTS borrow_items (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  order_id BIGINT NOT NULL REFERENCES borrow_orders(id) ON DELETE CASCADE,
  item_id TEXT NOT NULL REFERENCES inventory_items(id) ON DELETE CASCADE,
  quantity_borrowed INTEGER NOT NULL CHECK (quantity_borrowed > 0),
  quantity_returned INTEGER DEFAULT 0 CHECK (quantity_returned >= 0),
  item_condition TEXT DEFAULT 'good' CHECK (
    item_condition IN ('good', 'damaged', 'lost')
  ),
  notes TEXT, -- 物品备注（如损坏描述）
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================
-- 8. 操作日志表（审计追踪）
-- ============================================
CREATE TABLE IF NOT EXISTS operation_logs (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
  item_id TEXT REFERENCES inventory_items(id) ON DELETE SET NULL,
  order_id BIGINT REFERENCES borrow_orders(id) ON DELETE SET NULL,
  action TEXT NOT NULL CHECK (
    action IN ('borrow', 'return', 'move', 'scan', 'create', 'update', 'delete')
  ),
  details JSONB, -- 详细信息（JSON格式）
  ip_address TEXT,
  user_agent TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================
-- 索引优化
-- ============================================
CREATE INDEX IF NOT EXISTS idx_inventory_items_location ON inventory_items(location_code);
CREATE INDEX IF NOT EXISTS idx_inventory_items_name ON inventory_items USING gin(to_tsvector('simple', name));
CREATE INDEX IF NOT EXISTS idx_inventory_change_requests_status ON inventory_change_requests(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_inventory_change_requests_requester ON inventory_change_requests(requested_by, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_users_department_role ON users(department_id, role);
CREATE INDEX IF NOT EXISTS idx_borrow_orders_user ON borrow_orders(user_id);
CREATE INDEX IF NOT EXISTS idx_borrow_orders_department_status ON borrow_orders(department_id, status);
CREATE INDEX IF NOT EXISTS idx_borrow_orders_status ON borrow_orders(status);
CREATE INDEX IF NOT EXISTS idx_borrow_orders_created ON borrow_orders(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_borrow_items_order ON borrow_items(order_id);
CREATE INDEX IF NOT EXISTS idx_borrow_items_item ON borrow_items(item_id);
CREATE INDEX IF NOT EXISTS idx_operation_logs_user ON operation_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_operation_logs_created ON operation_logs(created_at DESC);

-- ============================================
-- 触发器：自动记录物品位置变更
-- ============================================
CREATE OR REPLACE FUNCTION track_inventory_location_change()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  IF OLD.location_code IS DISTINCT FROM NEW.location_code THEN
    INSERT INTO inventory_location_history (item_id, from_location, to_location)
    VALUES (NEW.id, OLD.location_code, NEW.location_code);
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS inventory_items_track_location ON inventory_items;
CREATE TRIGGER inventory_items_track_location
BEFORE UPDATE ON inventory_items
FOR EACH ROW EXECUTE FUNCTION track_inventory_location_change();

-- ============================================
-- 触发器：自动更新 updated_at 时间戳
-- ============================================
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS users_update_timestamp ON users;
CREATE TRIGGER users_update_timestamp
BEFORE UPDATE ON users
FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS borrow_orders_update_timestamp ON borrow_orders;
CREATE TRIGGER borrow_orders_update_timestamp
BEFORE UPDATE ON borrow_orders
FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS borrow_items_update_timestamp ON borrow_items;
CREATE TRIGGER borrow_items_update_timestamp
BEFORE UPDATE ON borrow_items
FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS inventory_change_requests_update_timestamp ON inventory_change_requests;
CREATE TRIGGER inventory_change_requests_update_timestamp
BEFORE UPDATE ON inventory_change_requests
FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================
-- 初始化位置数据
-- ============================================
INSERT INTO inventory_locations (code, label, sort_order, is_pending_level) VALUES
  ('A1', 'A 货架 · 第 1 层', 11, FALSE),
  ('A2', 'A 货架 · 第 2 层', 12, FALSE),
  ('A3', 'A 货架 · 第 3 层', 13, FALSE),
  ('A4', 'A 货架 · 第 4 层', 14, FALSE),
  ('B1', 'B 货架 · 第 1 层', 21, FALSE),
  ('B2', 'B 货架 · 第 2 层', 22, FALSE),
  ('B3', 'B 货架 · 第 3 层', 23, FALSE),
  ('B4', 'B 货架 · 第 4 层', 24, FALSE),
  ('C1', 'C 货架 · 第 1 层', 31, FALSE),
  ('C2', 'C 货架 · 第 2 层', 32, FALSE),
  ('C3', 'C 货架 · 第 3 层', 33, FALSE),
  ('C4', 'C 货架 · 第 4 层', 34, FALSE),
  ('D1', 'D 货架 · 第 1 层', 41, FALSE),
  ('D2', 'D 货架 · 第 2 层', 42, FALSE),
  ('D3', 'D 货架 · 第 3 层', 43, FALSE),
  ('D4', 'D 货架 · 第 4 层', 44, FALSE),
  ('FLOOR', '地板区域', 50, FALSE),
  ('DOOR', '门后区域', 60, FALSE),
  ('PENDING_A', '待分层 · A 货架', 71, TRUE),
  ('PENDING_B', '待分层 · B 货架', 72, TRUE),
  ('PENDING_C', '待分层 · C 货架', 73, TRUE),
  ('PENDING_D', '待分层 · D 货架', 74, TRUE)
ON CONFLICT (code) DO UPDATE SET
  label = EXCLUDED.label,
  sort_order = EXCLUDED.sort_order,
  is_pending_level = EXCLUDED.is_pending_level;

-- ============================================
-- 初始化部门
-- ============================================
INSERT INTO departments (name, description) VALUES
  ('宣传部', NULL),
  ('组织部', NULL),
  ('竞赛办公室', NULL),
  ('文体部', NULL),
  ('文艺部', NULL),
  ('红承志愿服务队', NULL),
  ('学风督导部', NULL),
  ('生活部', NULL)
ON CONFLICT (name) DO UPDATE SET description = EXCLUDED.description;

-- 部门是动态数据。不要在初始化脚本重跑时删除清单之外的部门。
-- 用户资料由 Supabase Auth 触发器创建，再由超级管理员分配角色和部门。

-- ============================================
-- RLS (Row Level Security) 策略 - 后续配置
-- ============================================
-- 注意：初期开发可以暂时关闭RLS，正式上线前必须启用

-- ALTER TABLE inventory_items ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE borrow_orders ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE users ENABLE ROW LEVEL SECURITY;

-- 示例策略（所有人可以查看物品，只有管理员可以修改）
-- CREATE POLICY "公开查看物品" ON inventory_items FOR SELECT USING (true);
-- CREATE POLICY "管理员修改物品" ON inventory_items FOR ALL USING (
--   auth.uid() IN (SELECT auth_user_id FROM users WHERE role IN ('super_admin', 'admin'))
-- );

-- ============================================
-- 完成提示
-- ============================================
-- 执行成功后，你应该看到以下表：
-- ✅ inventory_locations (位置表)
-- ✅ inventory_items (物品表)
-- ✅ inventory_location_history (位置历史)
-- ✅ departments (部门表)
-- ✅ users (用户表)
-- ✅ borrow_orders (借用订单)
-- ✅ borrow_items (借用详情)
-- ✅ operation_logs (操作日志)

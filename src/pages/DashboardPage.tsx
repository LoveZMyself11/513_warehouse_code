import { useEffect, useMemo, useState } from "react";
import {
  Activity,
  ArrowRight,
  BellRing,
  Box,
  Building2,
  CalendarRange,
  ClipboardList,
  FileCheck2,
  History,
  ListChecks,
  LogOut,
  MapPin,
  PackageCheck,
  ShieldCheck,
  UsersRound,
} from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthProvider";
import type { BorrowOrderStatus, UserRole } from "../types";
import LegalFooter from "../components/LegalFooter";

type DashboardView = "inventory" | "requests" | "departments" | "users" | "borrows" | "activities" | "announcements";

interface DashboardStats {
  inventoryCount: number;
  pendingRequests: number;
  deptPendingRequests: number;
  pendingBorrows: number;
  activeBorrows: number;
  returnRequested: number;
  memberCount: number;
  activeActivities: number;
  myBorrowOrders: number;
  outstandingItems: number;
  departmentName: string;
}

interface DashboardFeedItem {
  key: string;
  icon: "order" | "move";
  title: string;
  detail: string;
  at: string;
}

interface DbOrderRow {
  id: number;
  status: BorrowOrderStatus;
  user_id: number;
  department_id: number | null;
  order_number: string;
  created_at: string;
  updated_at: string;
}

interface DbHistoryRow {
  id: number;
  item_id: string;
  from_location: string | null;
  to_location: string;
  moved_at: string;
}

const initialStats: DashboardStats = {
  inventoryCount: 0,
  pendingRequests: 0,
  deptPendingRequests: 0,
  pendingBorrows: 0,
  activeBorrows: 0,
  returnRequested: 0,
  memberCount: 0,
  activeActivities: 0,
  myBorrowOrders: 0,
  outstandingItems: 0,
  departmentName: "未分配部门",
};

const roleMeta: Record<UserRole, { label: string; eyebrow: string; description: string }> = {
  super_admin: {
    label: "系统管理员",
    eyebrow: "系统总览",
    description: "从库存、活动到人员和借用流程，集中处理系统运营事项。",
  },
  admin: {
    label: "部门管理员",
    eyebrow: "部门工作台",
    description: "查看成员、处理借用申请，并维护本部门的日常资料。",
  },
  member: {
    label: "普通用户",
    eyebrow: "个人工作台",
    description: "浏览可借物品，查看申请状态，按原位完成归还。",
  },
};

const greetingFor = (date: Date) => {
  const hour = date.getHours();
  if (hour >= 5 && hour < 9) return "早上好";
  if (hour < 12) return "上午好";
  if (hour < 14) return "中午好";
  if (hour < 18) return "下午好";
  if (hour < 23) return "晚上好";
  return "夜深了";
};

const orderStatusLabel: Record<BorrowOrderStatus, string> = {
  pending: "待审批",
  approved: "已批准",
  borrowed: "借出中",
  return_requested: "待审核归还",
  returned: "已归还",
  cancelled: "已取消",
};

const relativeTime = (iso: string) => {
  const minutes = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (minutes < 1) return "刚刚";
  if (minutes < 60) return `${minutes} 分钟前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} 小时前`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days} 天前`;
  return new Date(iso).toLocaleDateString("zh-CN");
};

function countRows<T>(result: { data: T[] | null; error: unknown | null }) {
  return result.error ? [] : (result.data ?? []);
}

export default function RoleDashboard() {
  const { client, profile } = useAuth();
  const navigate = useNavigate();
  const [stats, setStats] = useState(initialStats);
  const [feed, setFeed] = useState<DashboardFeedItem[]>([]);
  const [announcements, setAnnouncements] = useState<Array<{ id: number; title: string; content: string; starts_at: string }>>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!client || !profile) return;
    let active = true;

    const loadStats = async () => {
      setLoading(true);
      const [itemsResult, requestsResult, ordersResult, usersResult, activitiesResult, departmentsResult, announcementsResult, historyResult] = await Promise.all([
        client.from("inventory_items").select("id, name"),
        client.from("inventory_change_requests").select("id, status, requested_role, requested_department_id"),
        client.from("borrow_orders").select("id, status, user_id, department_id, order_number, created_at, updated_at"),
        client.from("users").select("id, name, role, department_id, is_active"),
        client.from("activities").select("id, status"),
        client.from("departments").select("id, name"),
        client.from("system_announcements").select("id, title, content, starts_at").order("starts_at", { ascending: false }).limit(5),
        client.from("inventory_location_history").select("id, item_id, from_location, to_location, moved_at").order("moved_at", { ascending: false }).limit(6),
      ]);

      if (!active) return;
      const items = countRows(itemsResult) as Array<{ id: string; name: string }>;
      const requests = countRows(requestsResult) as Array<{ status: string; requested_role: UserRole; requested_department_id: number | null }>;
      const orders = countRows(ordersResult) as DbOrderRow[];
      const users = countRows(usersResult) as Array<{ id: number; name: string; role: UserRole; department_id: number | null; is_active: boolean }>;
      const activities = countRows(activitiesResult) as Array<{ status: string }>;
      const departments = countRows(departmentsResult) as Array<{ id: number; name: string }>;
      const history = countRows(historyResult) as DbHistoryRow[];
      const departmentUsers = profile.role === "admin"
        ? users.filter((user) => user.department_id === profile.departmentId && user.role === "member")
        : users.filter((user) => user.role === "member");
      const visibleOrders = profile.role === "member"
        ? orders.filter((order) => order.user_id === profile.id)
        : orders;
      const departmentName = departments.find((department) => department.id === profile.departmentId)?.name ?? "未分配部门";
      const deptPendingRequests = profile.role === "admin"
        ? requests.filter((request) => request.status === "pending"
          && request.requested_role === "member"
          && request.requested_department_id === profile.departmentId).length
        : 0;
      setAnnouncements(countRows(announcementsResult) as Array<{ id: number; title: string; content: string; starts_at: string }>);

      setStats({
        inventoryCount: items.length,
        pendingRequests: requests.filter((request) => request.status === "pending").length,
        deptPendingRequests,
        pendingBorrows: visibleOrders.filter((order) => order.status === "pending").length,
        activeBorrows: visibleOrders.filter((order) => ["borrowed", "return_requested"].includes(order.status)).length,
        returnRequested: visibleOrders.filter((order) => order.status === "return_requested").length,
        memberCount: departmentUsers.filter((user) => user.is_active).length,
        activeActivities: activities.filter((activity) => activity.status === "active").length,
        myBorrowOrders: visibleOrders.length,
        // The order rows do not contain item lines; this count remains an actionable order count.
        outstandingItems: visibleOrders.filter((order) => ["borrowed", "return_requested"].includes(order.status)).length,
        departmentName,
      });

      const userNames = new Map(users.map((user) => [user.id, user.name] as const));
      const itemNames = new Map(items.map((item) => [item.id, item.name] as const));
      const recentOrders = orders
        .slice()
        .sort((a, b) => b.updated_at.localeCompare(a.updated_at))
        .slice(0, 5)
        .map((order) => ({
          key: `order-${order.id}`,
          icon: "order" as const,
          title: `借用单 ${order.order_number}`,
          detail: `${userNames.get(order.user_id) ?? "用户"} · ${orderStatusLabel[order.status] ?? order.status}`,
          at: order.updated_at,
        }));
      const recentMoves = history.map((row) => ({
        key: `move-${row.id}`,
        icon: "move" as const,
        title: itemNames.get(row.item_id) ?? row.item_id,
        detail: `${row.from_location ?? "入库"} → ${row.to_location}`,
        at: row.moved_at,
      }));
      setFeed([...recentOrders, ...recentMoves].sort((a, b) => b.at.localeCompare(a.at)).slice(0, 8));
      setLoading(false);
    };

    void loadStats();
    return () => {
      active = false;
    };
  }, [client, profile]);

  const role = profile?.role ?? "member";
  const copy = roleMeta[role];
  const goTo = (view: DashboardView) => navigate("/app", { state: { view } });
  const statCards = useMemo(() => {
    if (role === "super_admin") {
      return [
        { label: "正式库存", value: stats.inventoryCount, hint: "已批准物品", icon: Box, view: "inventory" as DashboardView },
        { label: "待审批请求", value: stats.pendingRequests, hint: "库存变更申请", icon: ClipboardList, attention: stats.pendingRequests > 0, view: "requests" as DashboardView },
        { label: "待处理借用", value: stats.pendingBorrows, hint: "等待部门处理", icon: PackageCheck, attention: stats.pendingBorrows > 0, view: "borrows" as DashboardView },
        { label: "启用中活动", value: stats.activeActivities, hint: "可关联到借用单", icon: CalendarRange, view: "activities" as DashboardView },
      ];
    }
    if (role === "admin") {
      return [
        { label: "本部门成员", value: stats.memberCount, hint: stats.departmentName, icon: UsersRound, view: "users" as DashboardView },
        { label: "待审批借用", value: stats.pendingBorrows, hint: "需要及时处理", icon: ClipboardList, attention: stats.pendingBorrows > 0, view: "borrows" as DashboardView },
        { label: "借出中订单", value: stats.activeBorrows, hint: "含待审核归还", icon: PackageCheck, view: "borrows" as DashboardView },
        { label: "启用中活动", value: stats.activeActivities, hint: "部门可用活动", icon: CalendarRange, view: "activities" as DashboardView },
      ];
    }
    return [
      { label: "可借物品", value: stats.inventoryCount, hint: "浏览正式库存", icon: Box, view: "inventory" as DashboardView },
      { label: "我的借用单", value: stats.myBorrowOrders, hint: "全部状态", icon: ClipboardList, view: "borrows" as DashboardView },
      { label: "待处理流程", value: stats.pendingBorrows, hint: "审批中的申请", icon: BellRing, attention: stats.pendingBorrows > 0, view: "borrows" as DashboardView },
      { label: "尚未归还", value: stats.outstandingItems, hint: "请按原位归还", icon: PackageCheck, attention: stats.outstandingItems > 0, view: "borrows" as DashboardView },
    ];
  }, [role, stats]);

  const todos = useMemo(() => {
    const links: Array<{ label: string; view: DashboardView }> = [];
    if (role === "super_admin") {
      if (stats.pendingRequests > 0) links.push({ label: `${stats.pendingRequests} 个库存变更待审批`, view: "requests" });
      if (stats.pendingBorrows > 0) links.push({ label: `${stats.pendingBorrows} 个借用申请待审批`, view: "borrows" });
      if (stats.returnRequested > 0) links.push({ label: `${stats.returnRequested} 个归还待验收`, view: "borrows" });
    } else if (role === "admin") {
      if (stats.deptPendingRequests > 0) links.push({ label: `${stats.deptPendingRequests} 个本部门新增申请待审批`, view: "requests" });
      if (stats.pendingBorrows > 0) links.push({ label: `${stats.pendingBorrows} 个借用申请待审批`, view: "borrows" });
      if (stats.returnRequested > 0) links.push({ label: `${stats.returnRequested} 个归还待验收`, view: "borrows" });
    } else {
      if (stats.pendingBorrows > 0) links.push({ label: `${stats.pendingBorrows} 个借用申请审批中`, view: "borrows" });
      if (stats.outstandingItems > 0) links.push({ label: `${stats.outstandingItems} 件物品待归还`, view: "borrows" });
    }
    return links;
  }, [role, stats]);

  const actions = role === "super_admin"
    ? [
        { label: "库存管理", detail: "新增、编辑和查看物品", view: "inventory" as const, icon: Box },
        { label: "审批中心", detail: "处理库存和借用请求", view: "requests" as const, icon: FileCheck2 },
        { label: "借用监管", detail: "查看全部借用订单", view: "borrows" as const, icon: PackageCheck },
        { label: "人员管理", detail: "按身份增删人员、调整角色部门", view: "users" as const, icon: UsersRound },
        { label: "部门管理", detail: "维护部门架构与说明", view: "departments" as const, icon: Building2 },
        { label: "活动管理", detail: "维护活动与免审设置", view: "activities" as const, icon: CalendarRange },
      ]
    : role === "admin"
      ? [
          { label: "浏览库存", detail: "查看库存并申请借用", view: "inventory" as const, icon: Box },
          { label: "物品申请", detail: "查看本部门库存变更", view: "requests" as const, icon: FileCheck2 },
          { label: "借用监管", detail: "审批本部门借用申请", view: "borrows" as const, icon: PackageCheck },
          { label: "部门成员", detail: "维护成员资料和状态", view: "users" as const, icon: UsersRound },
          { label: "活动管理", detail: "维护本部门活动", view: "activities" as const, icon: CalendarRange },
          { label: "系统公告", detail: "查看发布的系统通知", view: "announcements" as const, icon: BellRing },
        ]
      : [
          { label: "浏览物品", detail: "按货架位置查找库存", view: "inventory" as const, icon: Box },
          { label: "填写借用单", detail: "选择物品并提交申请", view: "inventory" as const, icon: ClipboardList },
          { label: "借用状态", detail: "查看审批和归还进度", view: "borrows" as const, icon: PackageCheck },
          { label: "我的申请", detail: "库存变更与审批进度", view: "requests" as const, icon: FileCheck2 },
        ];

  if (!profile) return null;

  return (
    <div className="dashboard-shell">
      <header className="dashboard-topbar">
        <div className="dashboard-brand"><img className="brand-mark" src={`${import.meta.env.BASE_URL}department-emblem.jpg`} alt="信息技术学部队徽" /><span><strong>信息技术学部</strong><small>仓库借用系统</small></span></div>
        <div className="dashboard-account"><span>{profile.name} · {copy.label}</span><button className="icon-button dashboard-sign-out" onClick={() => client?.auth.signOut()} aria-label="退出登录" title="退出登录"><LogOut size={18} /></button></div>
      </header>

      <main className="dashboard-main">
        <section className="dashboard-hero">
          <div><p className="eyebrow">{copy.eyebrow}</p><h1>{profile ? `${greetingFor(new Date())}，${profile.name}，欢迎回来！` : "欢迎回来！"}</h1><p>{copy.description}</p></div>
          <div className="dashboard-hero-meta"><ShieldCheck size={19} /><span>{copy.label}<small>{role === "admin" ? stats.departmentName : "已授权账户"}</small></span></div>
        </section>

        <section className="dashboard-stats" aria-label="工作台统计">
          {statCards.map(({ label, value, hint, icon: Icon, attention, view }) => <button key={label} type="button" className={`dashboard-stat-card${attention ? " attention" : ""}`} onClick={() => goTo(view)} title={`前往${label}`}><span className="dashboard-stat-icon"><Icon size={17} /></span><div><span>{label}</span><strong>{loading ? "--" : value}</strong><small>{hint}</small></div></button>)}
        </section>

        <section className="dashboard-content-grid">
          <article className="dashboard-panel dashboard-actions-panel"><div className="dashboard-panel-heading"><div><p className="eyebrow">快捷入口</p><h2>常用操作</h2></div><Activity size={19} /></div><div className="dashboard-action-list">{actions.map(({ label, detail, view, icon: Icon }) => <button key={`${label}-${view}`} onClick={() => goTo(view)}><span className="dashboard-action-icon"><Icon size={18} /></span><span><strong>{label}</strong><small>{detail}</small></span><ArrowRight size={17} /></button>)}</div></article>
          <article className="dashboard-panel dashboard-side-panel">
            <div className="dashboard-panel-heading"><div><p className="eyebrow">今日待办</p><h2>待办事项</h2></div><ListChecks size={19} /></div>
            {todos.length === 0
              ? <p className="muted-text dashboard-todo-empty">暂无待办，一切井然有序。</p>
              : <div className="dashboard-todo-list">{todos.map((todo) => <button key={todo.label} onClick={() => goTo(todo.view)}><span>{todo.label}</span><ArrowRight size={16} /></button>)}</div>}
            <div className="dashboard-panel-heading dashboard-feed-heading"><div><p className="eyebrow">仓库动态</p><h2>近期流转</h2></div><History size={19} /></div>
            {feed.length === 0
              ? <p className="muted-text">暂无流转记录</p>
              : <ul className="dashboard-feed">{feed.map((item) => <li key={item.key}>{item.icon === "order" ? <PackageCheck size={15} /> : <MapPin size={15} />}<div><strong>{item.title}</strong><small>{item.detail}</small></div><time>{relativeTime(item.at)}</time></li>)}</ul>}
          </article>
        </section>

        <section className="dashboard-announcements" aria-label="系统公告"><div className="dashboard-panel-heading"><div><p className="eyebrow">通知</p><h2>系统公告</h2></div><BellRing size={19} /></div>{announcements.length === 0 ? <p className="muted-text">暂无公告</p> : <div className="dashboard-announcement-list">{announcements.map((announcement) => <article key={announcement.id}><h3>{announcement.title}</h3><p>{announcement.content}</p><time>{new Date(announcement.starts_at).toLocaleString("zh-CN")}</time></article>)}</div>}</section>
      </main>
      <LegalFooter />
    </div>
  );
}

import { useEffect, useMemo, useState } from "react";
import {
  Activity,
  ArrowRight,
  BarChart3,
  BellRing,
  Box,
  Boxes,
  Building2,
  CalendarRange,
  ClipboardList,
  DoorOpen,
  FileCheck2,
  LogOut,
  PackageCheck,
  Settings2,
  ShieldCheck,
  UsersRound,
} from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthProvider";
import type { UserRole } from "../types";
import LegalFooter from "../components/LegalFooter";

type DashboardView = "inventory" | "requests" | "departments" | "users" | "borrows" | "activities" | "announcements";

interface DashboardStats {
  inventoryCount: number;
  pendingRequests: number;
  pendingBorrows: number;
  activeBorrows: number;
  memberCount: number;
  activeActivities: number;
  myBorrowOrders: number;
  outstandingItems: number;
  departmentName: string;
}

const initialStats: DashboardStats = {
  inventoryCount: 0,
  pendingRequests: 0,
  pendingBorrows: 0,
  activeBorrows: 0,
  memberCount: 0,
  activeActivities: 0,
  myBorrowOrders: 0,
  outstandingItems: 0,
  departmentName: "未分配部门",
};

const roleMeta: Record<UserRole, { label: string; eyebrow: string; title: string; description: string }> = {
  super_admin: {
    label: "系统管理员",
    eyebrow: "系统总览",
    title: "管理仓库的每个环节",
    description: "从库存、活动到人员和借用流程，集中处理系统运营事项。",
  },
  admin: {
    label: "部门管理员",
    eyebrow: "部门工作台",
    title: "掌握本部门的借用进度",
    description: "查看成员、处理借用申请，并维护本部门的日常资料。",
  },
  member: {
    label: "普通用户",
    eyebrow: "个人工作台",
    title: "开始一次物品借用",
    description: "浏览可借物品，查看申请状态，按原位完成归还。",
  },
};

function countRows<T>(result: { data: T[] | null; error: unknown | null }) {
  return result.error ? [] : (result.data ?? []);
}

export default function RoleDashboard() {
  const { client, profile } = useAuth();
  const navigate = useNavigate();
  const [stats, setStats] = useState(initialStats);
  const [announcements, setAnnouncements] = useState<Array<{ id: number; title: string; content: string; starts_at: string }>>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!client || !profile) return;
    let active = true;

    const loadStats = async () => {
      setLoading(true);
      const [itemsResult, requestsResult, ordersResult, usersResult, activitiesResult, departmentsResult, announcementsResult] = await Promise.all([
        client.from("inventory_items").select("id"),
        client.from("inventory_change_requests").select("id, status"),
        client.from("borrow_orders").select("id, status, user_id, department_id"),
        client.from("users").select("id, role, department_id, is_active"),
        client.from("activities").select("id, status"),
        client.from("departments").select("id, name"),
        client.from("system_announcements").select("id, title, content, starts_at").order("starts_at", { ascending: false }).limit(5),
      ]);

      if (!active) return;
      const items = countRows(itemsResult);
      const requests = countRows(requestsResult) as Array<{ status: string }>;
      const orders = countRows(ordersResult) as Array<{ status: string; user_id: number; department_id: number | null }>;
      const users = countRows(usersResult) as Array<{ role: UserRole; department_id: number | null; is_active: boolean }>;
      const activities = countRows(activitiesResult) as Array<{ status: string }>;
      const departments = countRows(departmentsResult) as Array<{ id: number; name: string }>;
      const departmentUsers = profile.role === "admin"
        ? users.filter((user) => user.department_id === profile.departmentId && user.role === "member")
        : users.filter((user) => user.role === "member");
      const visibleOrders = profile.role === "member"
        ? orders.filter((order) => order.user_id === profile.id)
        : orders;
      const departmentName = departments.find((department) => department.id === profile.departmentId)?.name ?? "未分配部门";
      setAnnouncements(countRows(announcementsResult) as Array<{ id: number; title: string; content: string; starts_at: string }>);

      setStats({
        inventoryCount: items.length,
        pendingRequests: requests.filter((request) => request.status === "pending").length,
        pendingBorrows: visibleOrders.filter((order) => order.status === "pending").length,
        activeBorrows: visibleOrders.filter((order) => ["borrowed", "return_requested"].includes(order.status)).length,
        memberCount: departmentUsers.filter((user) => user.is_active).length,
        activeActivities: activities.filter((activity) => activity.status === "active").length,
        myBorrowOrders: visibleOrders.length,
        // The order rows do not contain item lines; this count remains an actionable order count.
        outstandingItems: visibleOrders.filter((order) => ["borrowed", "return_requested"].includes(order.status)).length,
        departmentName,
      });
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
        { label: "正式库存", value: stats.inventoryCount, hint: "已批准物品", icon: Box },
        { label: "待审批请求", value: stats.pendingRequests, hint: "库存变更申请", icon: ClipboardList, attention: stats.pendingRequests > 0 },
        { label: "待处理借用", value: stats.pendingBorrows, hint: "等待部门处理", icon: PackageCheck, attention: stats.pendingBorrows > 0 },
        { label: "启用中活动", value: stats.activeActivities, hint: "可关联到借用单", icon: CalendarRange },
      ];
    }
    if (role === "admin") {
      return [
        { label: "本部门成员", value: stats.memberCount, hint: stats.departmentName, icon: UsersRound },
        { label: "待审批借用", value: stats.pendingBorrows, hint: "需要及时处理", icon: ClipboardList, attention: stats.pendingBorrows > 0 },
        { label: "借出中订单", value: stats.activeBorrows, hint: "含待审核归还", icon: PackageCheck },
        { label: "启用中活动", value: stats.activeActivities, hint: "部门可用活动", icon: CalendarRange },
      ];
    }
    return [
      { label: "可借物品", value: stats.inventoryCount, hint: "浏览正式库存", icon: Box },
      { label: "我的借用单", value: stats.myBorrowOrders, hint: "全部状态", icon: ClipboardList },
      { label: "待处理流程", value: stats.pendingBorrows, hint: "审批中的申请", icon: BellRing, attention: stats.pendingBorrows > 0 },
      { label: "尚未归还", value: stats.outstandingItems, hint: "请按原位归还", icon: PackageCheck, attention: stats.outstandingItems > 0 },
    ];
  }, [role, stats]);

  const actions = role === "super_admin"
    ? [
        { label: "库存管理", detail: "新增、编辑和查看物品", view: "inventory" as const, icon: Box },
        { label: "审批中心", detail: "处理库存和借用请求", view: "requests" as const, icon: FileCheck2 },
        { label: "借用监管", detail: "查看全部借用订单", view: "borrows" as const, icon: PackageCheck },
        { label: "人员管理", detail: "角色、部门和状态", view: "users" as const, icon: UsersRound },
        { label: "公告管理", detail: "发布系统通知", view: "announcements" as const, icon: BellRing },
      ]
    : role === "admin"
      ? [
          { label: "借用监管", detail: "审批本部门借用申请", view: "borrows" as const, icon: PackageCheck },
          { label: "部门成员", detail: "维护成员资料和状态", view: "users" as const, icon: UsersRound },
          { label: "活动管理", detail: "维护本部门活动", view: "activities" as const, icon: CalendarRange },
          { label: "浏览库存", detail: "查看并提交物品申请", view: "inventory" as const, icon: Box },
          { label: "物品申请", detail: "查看已提交的库存变更", view: "requests" as const, icon: FileCheck2 },
        ]
      : [
          { label: "浏览物品", detail: "按货架位置查找库存", view: "inventory" as const, icon: Box },
          { label: "填写借用单", detail: "选择物品并提交申请", view: "inventory" as const, icon: ClipboardList },
          { label: "借用状态", detail: "查看审批和归还进度", view: "borrows" as const, icon: PackageCheck },
        ];

  if (!profile) return null;

  return (
    <div className="dashboard-shell">
      <header className="dashboard-topbar">
        <div className="dashboard-brand"><span className="brand-mark"><Boxes size={20} /></span><span><strong>513 仓库</strong><small>物品管理台</small></span></div>
        <div className="dashboard-account"><span>{profile.name} · {copy.label}</span><button className="icon-button dashboard-sign-out" onClick={() => client?.auth.signOut()} aria-label="退出登录" title="退出登录"><LogOut size={18} /></button></div>
      </header>

      <main className="dashboard-main">
        <section className="dashboard-hero">
          <div><p className="eyebrow">{copy.eyebrow}</p><h1>{copy.title}</h1><p>{copy.description}</p></div>
          <div className="dashboard-hero-meta"><ShieldCheck size={19} /><span>{copy.label}<small>{role === "admin" ? stats.departmentName : "已授权账户"}</small></span></div>
        </section>

        <section className="dashboard-stats" aria-label="工作台统计">
          {statCards.map(({ label, value, hint, icon: Icon, attention }) => <article key={label} className={attention ? "attention" : ""}><span className="dashboard-stat-icon"><Icon size={17} /></span><div><span>{label}</span><strong>{loading ? "--" : value}</strong><small>{hint}</small></div></article>)}
        </section>

        <section className="dashboard-content-grid">
          <article className="dashboard-panel dashboard-actions-panel"><div className="dashboard-panel-heading"><div><p className="eyebrow">快捷入口</p><h2>常用操作</h2></div><Activity size={19} /></div><div className="dashboard-action-list">{actions.map(({ label, detail, view, icon: Icon }) => <button key={`${label}-${view}`} onClick={() => goTo(view)}><span className="dashboard-action-icon"><Icon size={18} /></span><span><strong>{label}</strong><small>{detail}</small></span><ArrowRight size={17} /></button>)}</div></article>
          <article className="dashboard-panel dashboard-focus-panel"><div className="dashboard-panel-heading"><div><p className="eyebrow">工作重点</p><h2>{role === "member" ? "我的借用" : "待处理事项"}</h2></div><BarChart3 size={19} /></div>{role === "member" ? <div className="dashboard-focus-copy"><strong>{stats.outstandingItems > 0 ? `有 ${stats.outstandingItems} 个订单需要归还` : "当前没有待归还订单"}</strong><p>{stats.outstandingItems > 0 ? "打开借用状态，逐件提交归还申请。" : "从库存中选择物品，填写借用单开始使用。"}</p><button className="primary-button" onClick={() => goTo(stats.outstandingItems > 0 ? "borrows" : "inventory")}><PackageCheck size={16} />{stats.outstandingItems > 0 ? "查看借用状态" : "浏览库存"}</button></div> : <div className="dashboard-focus-list"><button onClick={() => goTo(role === "super_admin" ? "requests" : "borrows")}><span><strong>{role === "super_admin" ? stats.pendingRequests : stats.pendingBorrows}</strong><small>{role === "super_admin" ? "个库存请求待审批" : "个借用申请待处理"}</small></span><ArrowRight size={17} /></button><button onClick={() => goTo(role === "super_admin" ? "users" : "activities")}><span><strong>{role === "super_admin" ? stats.memberCount : stats.activeActivities}</strong><small>{role === "super_admin" ? "名启用中的普通用户" : "个启用中的活动"}</small></span><ArrowRight size={17} /></button></div>}</article>
        </section>

        <section className="dashboard-footer-links"><button onClick={() => goTo("inventory")}><DoorOpen size={16} />进入仓库</button>{role === "super_admin" && <button onClick={() => goTo("departments")}><Building2 size={16} />部门管理</button>}{role === "super_admin" && <button onClick={() => goTo("activities")}><Settings2 size={16} />活动管理</button>}</section>

        <section className="dashboard-announcements" aria-label="系统公告"><div className="dashboard-panel-heading"><div><p className="eyebrow">通知</p><h2>系统公告</h2></div><BellRing size={19} /></div>{announcements.length === 0 ? <p className="muted-text">暂无公告</p> : <div className="dashboard-announcement-list">{announcements.map((announcement) => <article key={announcement.id}><h3>{announcement.title}</h3><p>{announcement.content}</p><time>{new Date(announcement.starts_at).toLocaleString("zh-CN")}</time></article>)}</div>}</section>
      </main>
      <LegalFooter />
    </div>
  );
}

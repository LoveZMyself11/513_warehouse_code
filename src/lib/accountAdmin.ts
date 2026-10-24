import type { ManagedUser, UserRole } from "../types";

// Groups render top-down by account level; the backend enforces the same order.
export const ROLE_ORDER: ReadonlyArray<UserRole> = ["super_admin", "admin", "member"];

export const ROLE_GROUP_LABELS: Record<UserRole, string> = {
  super_admin: "超级管理员",
  admin: "部门管理员",
  member: "普通用户",
};

export interface AccountInput {
  studentId: string;
  name: string;
  department: string;
  phone: string;
  role: string;
  email: string;
  position: string;
  notes: string;
}

const trimmed = (value: unknown) => typeof value === "string" ? value.trim() : "";

// Mirrors the row rules of Excel 批量导入 and the manage-accounts edge function,
// so a rejected form never reaches the service and vice versa.
export function accountFormError(input: Partial<AccountInput>): string | null {
  const studentId = trimmed(input.studentId).toLowerCase();
  const name = trimmed(input.name);
  const department = trimmed(input.department);
  const phone = trimmed(input.phone);
  const role = trimmed(input.role);
  const email = trimmed(input.email);
  const position = trimmed(input.position);
  const notes = trimmed(input.notes);
  if (!/^[a-z0-9_-]{2,32}$/.test(studentId)) return "学号须为 2 至 32 位字母、数字、下划线或短横线。";
  if (!name || name.length > 80) return "请填写姓名（最长 80 字）。";
  if (!department || department.length > 80) return "请填写部门（最长 80 字）。";
  if (!/^(?:\+?86[- ]?)?1[3-9][0-9]{9}$/.test(phone)) return "请填写有效的手机号。";
  if (!ROLE_ORDER.includes(role as UserRole)) return "身份须为超级管理员、部门管理员或普通用户。";
  if (email && (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254)) return "联系邮箱格式不正确。";
  if (position.length > 80 || notes.length > 500) return "职位或备注超出长度限制。";
  return null;
}

export function normalizeAccountInput(input: Partial<AccountInput>): AccountInput {
  return {
    studentId: trimmed(input.studentId).toLowerCase(),
    name: trimmed(input.name),
    department: trimmed(input.department),
    phone: trimmed(input.phone),
    role: trimmed(input.role),
    email: trimmed(input.email),
    position: trimmed(input.position),
    notes: trimmed(input.notes),
  };
}

export interface UserGroup {
  role: UserRole;
  label: string;
  users: ManagedUser[];
}

const byName = (a: ManagedUser, b: ManagedUser) => a.name.localeCompare(b.name, "zh");

// Account level descends from super_admin to member; each group sorts by name.
export function groupUsersByRole(users: ManagedUser[]): UserGroup[] {
  return ROLE_ORDER.map((role) => ({
    role,
    label: ROLE_GROUP_LABELS[role],
    users: users.filter((user) => user.role === role).sort(byName),
  }));
}

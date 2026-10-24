import { initialPassword, studentId, validStudentId } from "./accountCredentials.ts";

// Single-account create/delete/password-reset workflows for 超级管理员, mirroring
// the import-accounts flow: service_role performs the Auth Admin API operations,
// the on_auth_user_changed trigger inserts a disabled profile, and these workflows
// fill and activate it.
//
// Auditing: the intent row is persisted in operation_logs BEFORE any sensitive side
// effect; the row's status moves to completed/failed afterwards. A failed intent
// aborts the operation, and a failed status update downgrades the response, so no
// operation is ever reported as a clean success without a completed audit trail.
// Auth Admin API calls and Postgres writes cannot share a transaction, which is why
// the two-phase intent/status scheme is used. Audit details never contain secrets
// (no passwords, tokens or keys).

export type WorkflowResult = { body: Record<string, unknown>; status: number };

const AUDIT_FOLLOWUP = "操作结果请以审计日志核查为准，必要时联系开发者。";
const text = (value: unknown) => typeof value === "string" ? value.trim() : "";

// Structural surface of the Supabase service client used by the workflows; loose on
// purpose so Node tests can drive the flows with a stubbed client.
export interface WorkflowSingleResult { data: Record<string, unknown> | null; error: { message?: string } | null; count?: number | null }
export interface WorkflowQuery {
  eq(column: string, value: unknown): WorkflowQuery & PromiseLike<WorkflowSingleResult>;
  single(): Promise<WorkflowSingleResult>;
  maybeSingle(): Promise<WorkflowSingleResult>;
  select(columns?: string): Pick<WorkflowQuery, "single" | "maybeSingle">;
}
export interface WorkflowDb {
  from(table: string): {
    select(columns?: string, options?: Record<string, unknown>): WorkflowQuery;
    insert(row: Record<string, unknown>): { select(columns?: string): { single(): Promise<WorkflowSingleResult> } };
    update(row: Record<string, unknown>): WorkflowQuery;
    upsert(row: Record<string, unknown>, options?: Record<string, unknown>): { select(columns?: string): { single(): Promise<WorkflowSingleResult> } };
    delete(): WorkflowQuery;
  };
  auth: { admin: {
    createUser(attributes: Record<string, unknown>): Promise<WorkflowSingleResult>;
    deleteUser(id: string): Promise<{ error: { message?: string } | null }>;
    updateUserById(id: string, attributes: Record<string, unknown>): Promise<WorkflowSingleResult>;
  } };
}

export async function beginAudit(db: WorkflowDb, actorId: number, action: "create" | "delete" | "update", details: Record<string, unknown>): Promise<{ logId: number } | { error: string }> {
  const { data, error } = await db.from("operation_logs")
    .insert({ user_id: actorId, action, details: { ...details, status: "pending" } })
    .select("id").single();
  if (error || !data?.id) return { error: "无法记录审计意图，操作已取消，请稍后重试。" };
  return { logId: Number(data.id) };
}

export async function finishAudit(db: WorkflowDb, logId: number, details: Record<string, unknown>, status: "completed" | "failed", extra: Record<string, unknown> = {}): Promise<boolean> {
  const { error } = await db.from("operation_logs")
    .update({ details: { ...details, ...extra, status } })
    .eq("id", logId);
  return !error;
}

export async function createAccount(db: WorkflowDb, actorId: number, raw: Record<string, unknown>): Promise<WorkflowResult> {
  const account = {
    studentId: studentId(raw?.studentId), name: text(raw?.name), department: text(raw?.department),
    phone: text(raw?.phone), role: text(raw?.role), email: text(raw?.email),
    position: text(raw?.position), notes: text(raw?.notes),
  };
  if (!validStudentId(account.studentId)) return { body: { error: "学号须为 2 至 32 位字母、数字、下划线或短横线。" }, status: 400 };
  if (!account.name || account.name.length > 80) return { body: { error: "请填写姓名（最长 80 字）。" }, status: 400 };
  if (!account.department || account.department.length > 80) return { body: { error: "请填写部门（最长 80 字）。" }, status: 400 };
  if (!/^(?:\+?86[- ]?)?1[3-9][0-9]{9}$/.test(account.phone)) return { body: { error: "请填写有效的手机号。" }, status: 400 };
  if (!["super_admin", "admin", "member"].includes(account.role)) return { body: { error: "身份须为超级管理员、部门管理员或普通用户。" }, status: 400 };
  if (account.email && (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(account.email) || account.email.length > 254)) return { body: { error: "联系邮箱格式不正确。" }, status: 400 };
  if (account.position.length > 80 || account.notes.length > 500) return { body: { error: "职位或备注超出长度限制。" }, status: 400 };

  const { data: existing, error: lookupError } = await db.from("users").select("id").eq("student_id", account.studentId).maybeSingle();
  if (lookupError) return { body: { error: "学号检查失败，请稍后重试。" }, status: 503 };
  if (existing) return { body: { error: "学号已存在，现有账号未被修改。" }, status: 409 };

  const auditDetails = { type: "account_create", student_id: account.studentId, name: account.name, role: account.role };
  const intent = await beginAudit(db, actorId, "create", auditDetails);
  if ("error" in intent) return { body: { error: intent.error }, status: 503 };

  const departmentResult = await db.from("departments")
    .upsert({ name: account.department }, { onConflict: "name" }).select("id").single();
  const department = departmentResult.data as { id: number } | null;
  if (departmentResult.error || !department) {
    const logged = await finishAudit(db, intent.logId, auditDetails, "failed", { stage: "department" });
    return { body: { error: logged ? "部门创建失败。" : `部门创建失败。${AUDIT_FOLLOWUP}` }, status: 503 };
  }

  const createResult = await db.auth.admin.createUser({
    email: `${account.studentId}@student.513base.invalid`, password: initialPassword, email_confirm: true,
    user_metadata: { name: account.name },
  });
  const createdUser = createResult.data?.user as { id: string } | null;
  if (createResult.error || !createdUser) {
    const logged = await finishAudit(db, intent.logId, auditDetails, "failed", { stage: "auth_create" });
    return { body: { error: logged ? "Auth 账号已存在或创建失败，请联系开发者处理。" : `Auth 账号已存在或创建失败，请联系开发者处理。${AUDIT_FOLLOWUP}` }, status: 409 };
  }

  const profileResult = await db.from("users").update({
    student_id: account.studentId, name: account.name, department_id: department.id,
    phone: account.phone, email: account.email || null, role: account.role,
    position: account.position || null, notes: account.notes || null,
    is_active: true, must_change_password: true,
  }).eq("auth_user_id", createdUser.id).select("id").single();
  const profile = profileResult.data as { id: number } | null;
  if (profileResult.error || !profile) {
    const { error: cleanupError } = await db.auth.admin.deleteUser(createdUser.id);
    const logged = await finishAudit(db, intent.logId, auditDetails, "failed", { stage: "profile", cleaned_up: !cleanupError });
    return {
      body: { error: logged ? (cleanupError ? "资料保存失败，临时账号清理失败，请联系开发者处理。" : "资料保存失败，已撤销新账号，可修正后重试。") : `资料保存失败，已尝试撤销新账号。${AUDIT_FOLLOWUP}` },
      status: 503,
    };
  }

  const logged = await finishAudit(db, intent.logId, auditDetails, "completed", { stage: "done", target_user_id: profile.id });
  if (!logged) return { body: { error: `账号已创建（学号 ${account.studentId}），但审计状态更新失败，请联系开发者核查。` }, status: 503 };
  return { body: { success: true, userId: profile.id }, status: 200 };
}

export async function deleteAccount(db: WorkflowDb, actorId: number, rawUserId: unknown): Promise<WorkflowResult> {
  const userId = Number(rawUserId);
  if (!Number.isInteger(userId) || userId <= 0) return { body: { error: "人员标识不正确。" }, status: 400 };
  const { data: targetRow, error: targetError } = await db.from("users")
    .select("id, student_id, name, role, is_active, auth_user_id").eq("id", userId).maybeSingle();
  if (targetError) return { body: { error: "人员信息读取失败，请稍后重试。" }, status: 503 };
  if (!targetRow) return { body: { error: "人员不存在或已被删除。" }, status: 404 };
  const target = targetRow as unknown as { id: number; student_id: string | null; name: string; role: string; is_active: boolean; auth_user_id: string | null };
  if (target.id === actorId) return { body: { error: "不能删除当前登录的账号。" }, status: 409 };

  // Deleting the Auth user cascades into public.users and then into borrow records;
  // anyone with business history must be disabled instead of deleted.
  const [orders, returnRequests, changeRequests] = await Promise.all([
    db.from("borrow_orders").select("id", { count: "exact", head: true }).eq("user_id", target.id),
    db.from("borrow_return_requests").select("id", { count: "exact", head: true }).eq("user_id", target.id),
    db.from("inventory_change_requests").select("id", { count: "exact", head: true }).eq("requested_by", target.id),
  ]);
  const recordError = orders.error ?? returnRequests.error ?? changeRequests.error;
  if (recordError) return { body: { error: "业务记录检查失败，请稍后重试。" }, status: 503 };
  if ((orders.count ?? 0) > 0 || (returnRequests.count ?? 0) > 0 || (changeRequests.count ?? 0) > 0) {
    return { body: { error: "该人员存在借用、归还或库存申请记录，删除会连带清除业务历史；请改用「编辑」中的停用账号。" }, status: 409 };
  }
  // The actor is an active super admin and cannot delete themselves, so at least one
  // active super admin always remains after any allowed deletion.

  const auditDetails = { type: "account_delete", student_id: target.student_id, name: target.name, role: target.role };
  const intent = await beginAudit(db, actorId, "delete", auditDetails);
  if ("error" in intent) return { body: { error: intent.error }, status: 503 };

  if (target.auth_user_id) {
    const { error: authDeleteError } = await db.auth.admin.deleteUser(target.auth_user_id);
    if (authDeleteError) {
      const logged = await finishAudit(db, intent.logId, auditDetails, "failed", { stage: "auth_delete" });
      return { body: { error: logged ? "删除登录账号失败，人员资料未被修改，请稍后重试。" : `删除登录账号失败，人员资料未被修改。${AUDIT_FOLLOWUP}` }, status: 503 };
    }
  } else {
    const { error: profileDeleteError } = await db.from("users").delete().eq("id", target.id);
    if (profileDeleteError) {
      const logged = await finishAudit(db, intent.logId, auditDetails, "failed", { stage: "profile_delete" });
      return { body: { error: logged ? "删除人员资料失败，请稍后重试。" : `删除人员资料失败。${AUDIT_FOLLOWUP}` }, status: 503 };
    }
  }

  const logged = await finishAudit(db, intent.logId, auditDetails, "completed", { stage: "done", target_user_id: target.id });
  if (!logged) return { body: { error: `人员已删除（学号 ${target.student_id ?? "无"}），但审计状态更新失败，请联系开发者核查。` }, status: 503 };
  return { body: { success: true }, status: 200 };
}

export async function resetPassword(db: WorkflowDb, actorId: number, rawUserId: unknown): Promise<WorkflowResult> {
  const userId = Number(rawUserId);
  if (!Number.isInteger(userId) || userId <= 0) return { body: { error: "人员标识不正确。" }, status: 400 };
  const { data: targetRow, error: targetError } = await db.from("users")
    .select("id, student_id, name, role, is_active, auth_user_id").eq("id", userId).maybeSingle();
  if (targetError) return { body: { error: "人员信息读取失败，请稍后重试。" }, status: 503 };
  if (!targetRow) return { body: { error: "人员不存在或已被删除。" }, status: 404 };
  const target = targetRow as unknown as { id: number; student_id: string | null; name: string; role: string; is_active: boolean; auth_user_id: string | null };
  if (target.id === actorId) return { body: { error: "不能重置当前登录的账号。" }, status: 409 };
  if (!target.auth_user_id) return { body: { error: "该人员没有关联的登录账号，无需重置密码。" }, status: 409 };

  const auditDetails = { type: "account_password_reset", student_id: target.student_id, name: target.name, role: target.role };
  const intent = await beginAudit(db, actorId, "update", auditDetails);
  if ("error" in intent) return { body: { error: intent.error }, status: 503 };

  const { error: passwordError } = await db.auth.admin.updateUserById(target.auth_user_id, { password: initialPassword });
  if (passwordError) {
    const logged = await finishAudit(db, intent.logId, auditDetails, "failed", { stage: "auth_password" });
    return { body: { error: logged ? "密码重置失败，请稍后重试。" : `密码重置失败，请稍后重试。${AUDIT_FOLLOWUP}` }, status: 503 };
  }
  // The initial-password gate trigger only allows this write from the service context.
  const { error: gateError } = await db.from("users")
    .update({ must_change_password: true, password_changed_at: null }).eq("id", target.id);
  if (gateError) {
    const logged = await finishAudit(db, intent.logId, auditDetails, "failed", { stage: "password_flag" });
    return { body: { error: logged ? "密码已重置，但首次改密标记设置失败，请重试或联系开发者处理。" : `密码已重置，但首次改密标记设置失败。${AUDIT_FOLLOWUP}` }, status: 503 };
  }

  const logged = await finishAudit(db, intent.logId, auditDetails, "completed", { stage: "done", target_user_id: target.id });
  if (!logged) return { body: { error: `密码已重置（学号 ${target.student_id ?? "无"}），但审计状态更新失败，请联系开发者核查。` }, status: 503 };
  return { body: { success: true }, status: 200 };
}

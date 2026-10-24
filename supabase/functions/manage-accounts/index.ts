import { clients, initialPassword, preflight, respond, studentId, validStudentId, verifiedCaller } from "../_shared/accounts.ts";

// Single-account create/delete for 超级管理员, mirroring the import-accounts flow:
// service_role creates the Auth user, the on_auth_user_changed trigger inserts a
// disabled profile, and this function fills and activates it.
type AdminClient = ReturnType<typeof clients>["admin"];
type AccountPayload = { studentId: string; name: string; department: string; phone: string; role: string; email: string; position: string; notes: string };
type Result = { body: Record<string, unknown>; status: number };
const text = (value: unknown) => typeof value === "string" ? value.trim() : "";

Deno.serve(async (request) => {
  const early = preflight(request);
  if (early) return early;
  try {
    const { admin } = clients();
    const caller = await verifiedCaller(request, admin);
    if (!caller) return respond({ error: "登录已过期，请重新登录。" }, 401);
    const { data: actor } = await admin.from("users").select("id, role, is_active, must_change_password")
      .eq("auth_user_id", caller.id).maybeSingle();
    if (!actor?.is_active || actor.role !== "super_admin" || actor.must_change_password) return respond({ error: "仅超级管理员可管理账号。" }, 403);
    const body = await request.json();
    if (body?.action === "create") {
      const result = await createAccount(admin, actor.id, body.account);
      return respond(result.body, result.status);
    }
    if (body?.action === "delete") {
      const result = await deleteAccount(admin, actor.id, body.userId);
      return respond(result.body, result.status);
    }
    return respond({ error: "不支持的操作类型。" }, 400);
  } catch {
    return respond({ error: "账号管理服务暂不可用，请稍后重试。" }, 503);
  }
});

async function createAccount(admin: AdminClient, actorId: number, raw: Record<string, unknown>): Promise<Result> {
  const account: AccountPayload = {
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

  const { data: existing, error: lookupError } = await admin.from("users").select("id").eq("student_id", account.studentId).maybeSingle();
  if (lookupError) return { body: { error: "学号检查失败，请稍后重试。" }, status: 503 };
  if (existing) return { body: { error: "学号已存在，现有账号未被修改。" }, status: 409 };

  const { data: department, error: departmentError } = await admin.from("departments")
    .upsert({ name: account.department }, { onConflict: "name" }).select("id").single();
  if (departmentError || !department) return { body: { error: "部门创建失败。" }, status: 503 };

  const internalEmail = `${account.studentId}@student.513base.invalid`;
  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email: internalEmail, password: initialPassword, email_confirm: true,
    user_metadata: { name: account.name },
  });
  if (createError || !created.user) return { body: { error: "Auth 账号已存在或创建失败，请联系开发者处理。" }, status: 409 };

  const { data: profile, error: profileError } = await admin.from("users").update({
    student_id: account.studentId, name: account.name, department_id: department.id,
    phone: account.phone, email: account.email || null, role: account.role,
    position: account.position || null, notes: account.notes || null,
    is_active: true, must_change_password: true,
  }).eq("auth_user_id", created.user.id).select("id").single();
  if (profileError || !profile) {
    const { error: cleanupError } = await admin.auth.admin.deleteUser(created.user.id);
    return {
      body: { error: cleanupError ? "资料保存失败，临时账号清理失败，请联系开发者处理。" : "资料保存失败，已撤销新账号，可修正后重试。" },
      status: 503,
    };
  }
  await admin.from("operation_logs").insert({ user_id: actorId, action: "create", details: { type: "account_create", target_user_id: profile.id, student_id: account.studentId, role: account.role } });
  return { body: { success: true, userId: profile.id }, status: 200 };
}

async function deleteAccount(admin: AdminClient, actorId: number, rawUserId: unknown): Promise<Result> {
  const userId = Number(rawUserId);
  if (!Number.isInteger(userId) || userId <= 0) return { body: { error: "人员标识不正确。" }, status: 400 };
  const { data: target, error: targetError } = await admin.from("users")
    .select("id, student_id, name, role, is_active, auth_user_id").eq("id", userId).maybeSingle();
  if (targetError) return { body: { error: "人员信息读取失败，请稍后重试。" }, status: 503 };
  if (!target) return { body: { error: "人员不存在或已被删除。" }, status: 404 };
  if (target.id === actorId) return { body: { error: "不能删除当前登录的账号。" }, status: 409 };

  // Deleting the Auth user cascades into public.users and then into borrow records;
  // anyone with business history must be disabled instead of deleted.
  const [orders, returnRequests, changeRequests] = await Promise.all([
    admin.from("borrow_orders").select("id", { count: "exact", head: true }).eq("user_id", target.id),
    admin.from("borrow_return_requests").select("id", { count: "exact", head: true }).eq("user_id", target.id),
    admin.from("inventory_change_requests").select("id", { count: "exact", head: true }).eq("requested_by", target.id),
  ]);
  const recordError = orders.error ?? returnRequests.error ?? changeRequests.error;
  if (recordError) return { body: { error: "业务记录检查失败，请稍后重试。" }, status: 503 };
  if ((orders.count ?? 0) > 0 || (returnRequests.count ?? 0) > 0 || (changeRequests.count ?? 0) > 0) {
    return { body: { error: "该人员存在借用、归还或库存申请记录，删除会连带清除业务历史；请改用「编辑」中的停用账号。" }, status: 409 };
  }
  // The actor is an active super admin and cannot delete themselves, so at least one
  // active super admin always remains after any allowed deletion.

  if (target.auth_user_id) {
    const { error: authDeleteError } = await admin.auth.admin.deleteUser(target.auth_user_id);
    if (authDeleteError) return { body: { error: "删除登录账号失败，人员资料未被修改，请稍后重试。" }, status: 503 };
  } else {
    const { error: profileDeleteError } = await admin.from("users").delete().eq("id", target.id);
    if (profileDeleteError) return { body: { error: "删除人员资料失败，请稍后重试。" }, status: 503 };
  }
  await admin.from("operation_logs").insert({ user_id: actorId, action: "delete", details: { type: "account_delete", target_user_id: target.id, student_id: target.student_id, name: target.name, role: target.role } });
  return { body: { success: true }, status: 200 };
}

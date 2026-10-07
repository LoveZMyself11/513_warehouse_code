import { clients, initialPassword, preflight, respond, studentId, validStudentId, verifiedCaller } from "../_shared/accounts.ts";

type AccountRow = { rowNumber: number; studentId: string; name: string; department: string; phone: string; role: string; email: string; position: string; notes: string };
type RowResult = { rowNumber: number; studentId: string; name: string; success: boolean; error?: string };
const roleNames: Record<string, string> = { "普通用户": "member", "普通管理员": "admin", "部门管理员": "admin", "超级管理员": "super_admin" };
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
    if (!actor?.is_active || actor.role !== "super_admin" || actor.must_change_password) return respond({ error: "仅超级管理员可导入账号。" }, 403);
    const body = await request.json();
    if (!Array.isArray(body.rows) || body.rows.length < 1 || body.rows.length > 50) return respond({ error: "每批需包含 1 至 50 行。" }, 400);
    const rows: AccountRow[] = body.rows.map((raw: Record<string, unknown>, index: number) => ({
      rowNumber: Number.isInteger(raw.rowNumber) ? Number(raw.rowNumber) : index + 2,
      studentId: studentId(raw.studentId), name: text(raw.name), department: text(raw.department),
      phone: text(raw.phone), role: roleNames[text(raw.role)] || text(raw.role) || "member",
      email: text(raw.email), position: text(raw.position), notes: text(raw.notes),
    }));
    const counts = new Map<string, number>();
    rows.forEach((row) => counts.set(row.studentId, (counts.get(row.studentId) || 0) + 1));
    const results: RowResult[] = [];
    for (const row of rows) {
      const result = { rowNumber: row.rowNumber, studentId: row.studentId, name: row.name, success: false };
      const reject = (error: string) => results.push({ ...result, error });
      if (!validStudentId(row.studentId)) { reject("学号须为 2 至 32 位字母、数字、下划线或短横线。"); continue; }
      if (counts.get(row.studentId)! > 1) { reject("同一批次存在重复学号。"); continue; }
      if (!row.name || row.name.length > 80) { reject("请填写姓名（最长 80 字）。"); continue; }
      if (!row.department || row.department.length > 80) { reject("请填写部门（最长 80 字）。"); continue; }
      if (!/^(?:\+?86[- ]?)?1[3-9][0-9]{9}$/.test(row.phone)) { reject("请填写有效的手机号。"); continue; }
      if (!["super_admin", "admin", "member"].includes(row.role)) { reject("身份须为普通用户、部门管理员或超级管理员。"); continue; }
      if (row.email && (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(row.email) || row.email.length > 254)) { reject("联系邮箱格式不正确。"); continue; }
      if (row.position.length > 80 || row.notes.length > 500) { reject("职位或备注超出长度限制。"); continue; }

      const { data: existing, error: lookupError } = await admin.from("users").select("id").eq("student_id", row.studentId).maybeSingle();
      if (lookupError) { reject("学号检查失败，请稍后重试。"); continue; }
      if (existing) { reject("学号已存在，现有账号未被修改。"); continue; }
      const { data: department, error: departmentError } = await admin.from("departments")
        .upsert({ name: row.department }, { onConflict: "name" }).select("id").single();
      if (departmentError || !department) { reject("部门创建失败。"); continue; }

      const internalEmail = `${row.studentId}@student.513base.invalid`;
      const { data: created, error: createError } = await admin.auth.admin.createUser({
        email: internalEmail, password: initialPassword, email_confirm: true,
        user_metadata: { name: row.name },
      });
      if (createError || !created.user) { reject("Auth 账号已存在或创建失败，请联系开发者处理。"); continue; }

      // The Auth trigger creates a disabled profile; only this privileged import activates it.
      const { error: profileError } = await admin.from("users").update({
        student_id: row.studentId, name: row.name, department_id: department.id,
        phone: row.phone, email: row.email || null, role: row.role,
        position: row.position || null, notes: row.notes || null,
        is_active: true, must_change_password: true,
      }).eq("auth_user_id", created.user.id).select("id").single();
      if (profileError) {
        const { error: cleanupError } = await admin.auth.admin.deleteUser(created.user.id);
        reject(cleanupError ? "资料保存失败，临时账号清理失败，请联系开发者处理。" : "资料保存失败，已撤销新账号，可修正后重试。");
        continue;
      }
      results.push({ ...result, success: true });
    }
    const imported = results.filter((result) => result.success).length;
    await admin.from("operation_logs").insert({ user_id: actor.id, action: "create", details: { type: "account_import", imported, failed: results.length - imported } });
    return respond({ results, imported, failed: results.length - imported });
  } catch {
    return respond({ error: "导入服务暂不可用，请稍后重试。" }, 503);
  }
});

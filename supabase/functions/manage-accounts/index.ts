import { clients, preflight, respond, verifiedCaller } from "../_shared/accounts.ts";
import { createAccount, deleteAccount, resetPassword } from "../_shared/accountWorkflows.ts";

// HTTP shell for the account workflows; all logic lives in _shared/accountWorkflows.ts.
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
    if (body?.action === "reset_password") {
      const result = await resetPassword(admin, actor.id, body.userId);
      return respond(result.body, result.status);
    }
    return respond({ error: "不支持的操作类型。" }, 400);
  } catch {
    return respond({ error: "账号管理服务暂不可用，请稍后重试。" }, 503);
  }
});

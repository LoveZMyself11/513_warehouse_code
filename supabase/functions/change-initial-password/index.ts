import { clients, preflight, respond, validPassword, verifiedCaller } from "../_shared/accounts.ts";

Deno.serve(async (request) => {
  const early = preflight(request);
  if (early) return early;
  try {
    const { admin } = clients();
    const user = await verifiedCaller(request, admin);
    if (!user) return respond({ error: "登录已过期，请重新登录。" }, 401);
    const body = await request.json();
    if (!validPassword(body.password)) return respond({ error: "密码须为 10 至 128 位，包含字母和数字，且不能使用初始密码。" }, 400);
    const { data: profile, error } = await admin.from("users")
      .select("id, is_active, must_change_password").eq("auth_user_id", user.id).maybeSingle();
    if (error || !profile?.is_active) return respond({ error: "账户暂不可用。" }, 403);
    if (!profile.must_change_password) return respond({ error: "账户已完成首次密码设置。" }, 409);

    const { error: passwordError } = await admin.auth.admin.updateUserById(user.id, { password: body.password });
    if (passwordError) return respond({ error: "密码修改失败，请稍后重试。" }, 400);
    const { error: profileError } = await admin.from("users")
      .update({ must_change_password: false, password_changed_at: new Date().toISOString() })
      .eq("id", profile.id).eq("auth_user_id", user.id);
    if (profileError) return respond({ error: "密码已修改，账户状态更新失败，请重新提交相同的新密码。" }, 503);
    await admin.from("operation_logs").insert({ user_id: profile.id, action: "update", details: { type: "initial_password_changed" } });
    return respond({ ok: true });
  } catch {
    return respond({ error: "密码服务暂不可用，请稍后重试。" }, 503);
  }
});

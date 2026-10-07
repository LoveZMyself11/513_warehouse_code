import { clients, digest, preflight, respond, studentId, validStudentId } from "../_shared/accounts.ts";

Deno.serve(async (request) => {
  const early = preflight(request);
  if (early) return early;
  try {
    const body = await request.json();
    const identifier = studentId(body.studentId);
    const password = body.password;
    const failure = () => respond({ error: "学号或密码不正确，或账户已停用。" }, 401);
    if (!validStudentId(identifier) || typeof password !== "string" || !password || password.length > 128) return failure();

    const { admin, auth } = clients();
    const source = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
      || request.headers.get("cf-connecting-ip") || "unknown";
    const { data: allowed, error: limitError } = await admin.rpc("consume_account_login_attempt", {
      p_source_hash: await digest(source),
      p_identifier_hash: await digest(identifier),
    });
    if (limitError) return respond({ error: "登录服务暂不可用，请稍后再试。" }, 503);
    if (!allowed) return respond({ error: "尝试过于频繁，请 5 分钟后再试。" }, 429);

    const { data: profile, error } = await admin.from("users")
      .select("auth_user_id, is_active").eq("student_id", identifier).maybeSingle();
    if (error || !profile?.is_active || !profile.auth_user_id) return failure();
    const { data: authUser, error: userError } = await admin.auth.admin.getUserById(profile.auth_user_id);
    if (userError || !authUser.user?.email) return failure();

    const { data, error: loginError } = await auth.auth.signInWithPassword({ email: authUser.user.email, password });
    if (loginError || !data.session || data.user?.id !== profile.auth_user_id) return failure();
    return respond({ session: data.session });
  } catch {
    return respond({ error: "登录服务暂不可用，请稍后再试。" }, 503);
  }
});

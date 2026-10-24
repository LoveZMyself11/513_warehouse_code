import { createClient } from "npm:@supabase/supabase-js@2.116.0";

export { digest, initialPassword, studentId, validPassword, validStudentId } from "./accountCredentials.ts";


const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

export function respond(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

export function preflight(request: Request) {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return respond({ error: "仅支持 POST 请求。" }, 405);
  return null;
}

export function clients() {
  const url = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  if (!url || !serviceKey || !anonKey) throw new Error("账户服务配置不完整。");
  const options = { auth: { persistSession: false, autoRefreshToken: false } };
  return {
    admin: createClient(url, serviceKey, options),
    auth: createClient(url, anonKey, options),
  };
}

export async function verifiedCaller(request: Request, admin: ReturnType<typeof clients>["admin"]) {
  const authorization = request.headers.get("Authorization");
  if (!authorization?.startsWith("Bearer ")) return null;
  const { data, error } = await admin.auth.getUser(authorization.slice(7));
  return error ? null : data.user;
}

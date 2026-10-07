import { type FormEvent, useEffect, useState } from "react";
import { Boxes, IdCard, LockKeyhole } from "lucide-react";
import { Navigate, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "./AuthProvider";
import { accountFunctionError } from "./accountApi";
import LegalFooter from "../components/LegalFooter";

interface LoginLocationState {
  from?: string;
}

export default function LoginPage() {
  const { client, configured, loading, session } = useAuth();
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<{ type: "error" | "success"; text: string } | null>(null);
  const navigate = useNavigate();
  const location = useLocation();
  const destination = (location.state as LoginLocationState | null)?.from ?? "/";

  useEffect(() => {
    if (!loading && session) navigate(destination, { replace: true });
  }, [destination, loading, navigate, session]);

  if (!loading && session) return <Navigate to={destination} replace />;

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!client) return;

    setSubmitting(true);
    setMessage(null);

    try {
      const login = identifier.trim();
      if (login.includes("@")) {
        const { error } = await client.auth.signInWithPassword({ email: login, password });
        if (error) setMessage({ type: "error", text: "邮箱或密码不正确。" });
      } else {
        const { data, error } = await client.functions.invoke("student-login", { body: { studentId: login, password } });
        if (error || !data?.session) {
          setMessage({ type: "error", text: await accountFunctionError(error, data?.error || "学号登录暂不可用，请稍后重试。") });
        } else {
          const { error: sessionError } = await client.auth.setSession({ access_token: data.session.access_token, refresh_token: data.session.refresh_token });
          if (sessionError) setMessage({ type: "error", text: "登录状态保存失败，请重试。" });
        }
      }
    } catch {
      setMessage({ type: "error", text: "无法连接登录服务，请稍后重试。" });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className="auth-page">
      <section className="auth-panel" aria-labelledby="auth-title">
        <div className="auth-brand">
          <div className="brand-mark"><Boxes size={22} /></div>
          <div>
            <strong>513 仓库</strong>
            <span>物品管理台</span>
          </div>
        </div>

        <div className="auth-heading">
          <p className="eyebrow">账户访问</p>
          <h1 id="auth-title">登录管理台</h1>
          <p>513 仓库物品借用与归还</p>
        </div>

        {!configured ? (
          <div className="auth-message error" role="alert">
            缺少 Supabase 发布密钥。请按 <code>.env.example</code> 配置环境变量后重启应用。
          </div>
        ) : (
          <form className="auth-form" onSubmit={handleSubmit}>
            <label>
              <span>学号</span>
              <div className="auth-input"><IdCard size={17} /><input type="text" autoComplete="username" value={identifier} onChange={(event) => setIdentifier(event.target.value)} placeholder="学号或原邮箱账号" maxLength={254} required /></div>
            </label>
            <label>
              <span>密码</span>
              <div className="auth-input"><LockKeyhole size={17} /><input type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} required /></div>
            </label>

            {message && <div className={`auth-message ${message.type}`} role={message.type === "error" ? "alert" : "status"}>{message.text}</div>}

            <button className="primary-button auth-submit" type="submit" disabled={submitting}>
              {submitting ? "请稍候..." : "登录"}
            </button>
          </form>
        )}
      </section>
      <div className="auth-footer">
        <p>仅限仓库管理与借用人员使用</p>
        <LegalFooter />
      </div>
    </main>
  );
}

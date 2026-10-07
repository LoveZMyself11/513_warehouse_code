import { type FormEvent, useEffect, useState } from "react";
import { Boxes, LockKeyhole, Mail } from "lucide-react";
import { Navigate, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "./AuthProvider";

interface LoginLocationState {
  from?: string;
}

export default function LoginPage() {
  const { client, configured, loading, session } = useAuth();
  const [email, setEmail] = useState("");
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

    const { error } = await client.auth.signInWithPassword({ email, password });
    if (error) setMessage({ type: "error", text: "邮箱或密码不正确。" });

    setSubmitting(false);
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
          <p>使用已授权的邮箱账户继续。</p>
        </div>

        {!configured ? (
          <div className="auth-message error" role="alert">
            缺少 Supabase 发布密钥。请按 <code>.env.example</code> 配置环境变量后重启应用。
          </div>
        ) : (
          <form className="auth-form" onSubmit={handleSubmit}>
            <label>
              <span>邮箱</span>
              <div className="auth-input"><Mail size={17} /><input type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="name@example.com" required /></div>
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
      <p className="auth-footer">仅限仓库管理与借用人员使用</p>
    </main>
  );
}

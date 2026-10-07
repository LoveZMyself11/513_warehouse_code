import { type FormEvent, useState } from "react";
import { Boxes, LockKeyhole, LogOut } from "lucide-react";
import { useAuth } from "./AuthProvider";
import { accountFunctionError } from "./accountApi";

export default function ChangeInitialPassword() {
  const { client, refreshProfile } = useAuth();
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!client) return;
    if (password.length < 10 || !/[A-Za-z]/.test(password) || !/[0-9]/.test(password) || password === "513base123") {
      setError("新密码须至少 10 位，包含字母和数字，且不能使用初始密码。");
      return;
    }
    if (password !== confirmation) { setError("两次输入的密码不一致。"); return; }
    setSubmitting(true);
    setError(null);
    try {
      const { data, error: functionError } = await client.functions.invoke("change-initial-password", { body: { password } });
      if (functionError || !data?.ok) {
        setError(await accountFunctionError(functionError, data?.error || "密码修改失败，请稍后重试。"));
      } else {
        refreshProfile();
      }
    } catch {
      setError("无法连接密码服务，请稍后重试。");
    } finally {
      setSubmitting(false);
    }
  }

  return <main className="auth-page">
    <section className="auth-panel" aria-labelledby="password-title">
      <div className="auth-brand"><div className="brand-mark"><Boxes size={22} /></div><div><strong>513 仓库</strong><span>账户安全</span></div></div>
      <div className="auth-heading"><p className="eyebrow">首次登录</p><h1 id="password-title">设置新密码</h1><p>初始密码已到期，请设置个人密码。</p></div>
      <form className="auth-form" onSubmit={submit}>
        <label><span>新密码</span><div className="auth-input"><LockKeyhole size={17} /><input type="password" autoComplete="new-password" minLength={10} maxLength={128} placeholder="至少 10 位，含字母和数字" value={password} onChange={(event) => setPassword(event.target.value)} required /></div></label>
        <label><span>确认新密码</span><div className="auth-input"><LockKeyhole size={17} /><input type="password" autoComplete="new-password" minLength={10} maxLength={128} value={confirmation} onChange={(event) => setConfirmation(event.target.value)} required /></div></label>
        {error && <div className="auth-message error" role="alert">{error}</div>}
        <button className="primary-button auth-submit" disabled={submitting} type="submit">{submitting ? "正在保存..." : "保存新密码"}</button>
        <button className="secondary-button" type="button" onClick={() => void client?.auth.signOut()} disabled={submitting}><LogOut size={17} />退出登录</button>
      </form>
    </section>
  </main>;
}

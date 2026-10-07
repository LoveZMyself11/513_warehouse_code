import { Navigate, Outlet, useLocation } from "react-router-dom";
import { Boxes, LoaderCircle, LogOut, ShieldAlert } from "lucide-react";
import { useAuth } from "./AuthProvider";

export default function ProtectedRoute() {
  const { client, session, profile, loading, profileError } = useAuth();
  const location = useLocation();

  if (loading) {
    return (
      <main className="auth-loading" aria-live="polite">
        <div className="brand-mark"><Boxes size={22} /></div>
        <LoaderCircle className="spin" size={22} />
        <span>正在验证登录状态</span>
      </main>
    );
  }

  if (!session) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }

  if (!profile || !profile.isActive) {
    return (
      <main className="auth-page">
        <section className="auth-panel access-panel" aria-labelledby="access-title">
          <div className="auth-brand">
            <div className="brand-mark"><Boxes size={22} /></div>
            <div><strong>513 仓库</strong><span>物品管理台</span></div>
          </div>
          <div className="access-message">
            <ShieldAlert size={30} />
            <h1 id="access-title">账户暂不可用</h1>
            <p>{profile && !profile.isActive ? "账户已停用，请联系管理员。" : profileError ?? "账户尚未关联仓库用户资料。"}</p>
            <button className="secondary-button" onClick={() => client?.auth.signOut()}><LogOut size={17} />退出登录</button>
          </div>
        </section>
      </main>
    );
  }

  return <Outlet />;
}

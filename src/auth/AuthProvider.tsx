import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { Session, SupabaseClient } from "@supabase/supabase-js";
import { isSupabaseConfigured, supabase } from "../lib/supabase";
import type { UserProfile, UserRole } from "../types";

interface AuthContextValue {
  client: SupabaseClient | null;
  session: Session | null;
  profile: UserProfile | null;
  loading: boolean;
  configured: boolean;
  profileError: string | null;
  mustChangePassword: boolean;
  refreshProfile: () => void;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [profileLoading, setProfileLoading] = useState(false);
  const [profileError, setProfileError] = useState<string | null>(null);
  const [mustChangePassword, setMustChangePassword] = useState(false);
  const [profileRevision, setProfileRevision] = useState(0);
  const [loadedAuthId, setLoadedAuthId] = useState<string | null>(null);

  useEffect(() => {
    if (!supabase) {
      setAuthLoading(false);
      return;
    }

    let active = true;
    supabase.auth
      .getSession()
      .then(({ data, error }) => {
        if (!active) return;
        setSession(error ? null : data.session);
        setAuthLoading(false);
      })
      .catch(() => {
        if (!active) return;
        setSession(null);
        setAuthLoading(false);
      });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
      setAuthLoading(false);
    });

    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!supabase || !session) {
      setProfile(null);
      setProfileError(null);
      setProfileLoading(false);
      setMustChangePassword(false);
      setLoadedAuthId(null);
      return;
    }

    let active = true;
    setProfileLoading(true);
    setProfileError(null);

    supabase
      .from("users")
      .select("id, student_id, name, department_id, phone, email, position, notes, role, is_active, must_change_password")
      .eq("auth_user_id", session.user.id)
      .maybeSingle()
      .then(({ data, error }) => {
        if (!active) return;
        if (error || !data) {
          setProfile(null);
          setMustChangePassword(false);
          setProfileError(error?.message ?? "账户尚未关联仓库用户资料。请联系管理员。");
        } else {
          setMustChangePassword(Boolean(data.must_change_password));
          setProfile({
            id: data.id,
            studentId: data.student_id,
            name: data.name,
            departmentId: data.department_id,
            phone: data.phone,
            email: data.email,
            position: data.position,
            notes: data.notes,
            role: data.role as UserRole,
            isActive: data.is_active,
          });
        }
        setLoadedAuthId(session.user.id);
        setProfileLoading(false);
      }, () => {
        if (!active) return;
        setProfile(null);
        setProfileError("无法读取账户资料，请稍后重试。");
        setLoadedAuthId(session.user.id);
        setProfileLoading(false);
      });

    return () => {
      active = false;
    };
  }, [session, profileRevision]);

  const loading = authLoading || (Boolean(session) && (profileLoading || loadedAuthId !== session?.user.id));

  const value = useMemo(
    () => ({ client: supabase, session, profile, loading, configured: isSupabaseConfigured, profileError, mustChangePassword, refreshProfile: () => setProfileRevision((revision) => revision + 1) }),
    [session, profile, loading, profileError, mustChangePassword],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used inside AuthProvider");
  return context;
}

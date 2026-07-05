import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { User } from "@supabase/supabase-js";

export type OperatorProfile = {
  id: string;
  email: string | null;
  display_name: string | null;
  avatar_url: string | null;
};

/**
 * Live view of the currently signed-in operator. Keeps a small store of
 * the auth user plus their profile row. Returns null while loading or
 * signed out.
 */
export function useCurrentOperator(): {
  user: User | null;
  profile: OperatorProfile | null;
  loading: boolean;
} {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<OperatorProfile | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    const load = async (nextUser: User | null) => {
      if (!nextUser) {
        if (!cancelled) {
          setProfile(null);
          setLoading(false);
        }
        return;
      }
      const { data } = await supabase
        .from("profiles")
        .select("id,email,display_name,avatar_url")
        .eq("id", nextUser.id)
        .maybeSingle();
      if (cancelled) return;
      setProfile(
        (data as OperatorProfile | null) ?? {
          id: nextUser.id,
          email: nextUser.email ?? null,
          display_name: nextUser.email?.split("@")[0] ?? null,
          avatar_url: null,
        },
      );
      setLoading(false);
    };

    supabase.auth.getUser().then(({ data }) => {
      if (cancelled) return;
      setUser(data.user);
      load(data.user);
    });

    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      const nextUser = session?.user ?? null;
      setUser(nextUser);
      load(nextUser);
    });

    return () => {
      cancelled = true;
      sub.subscription.unsubscribe();
    };
  }, []);

  return { user, profile, loading };
}

export function operatorInitials(profile: OperatorProfile | null, user: User | null): string {
  const name = profile?.display_name ?? user?.email ?? "";
  const parts = name.split(/[\s._@-]+/).filter(Boolean);
  if (parts.length === 0) return "OP";
  const first = parts[0]?.[0] ?? "";
  const second = parts[1]?.[0] ?? "";
  return (first + second).toUpperCase() || "OP";
}

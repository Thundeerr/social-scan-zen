import { createFileRoute, Link, useNavigate, redirect } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { z } from "zod";
import { zodValidator, fallback } from "@tanstack/zod-adapter";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Loader2, ShieldCheck, Radar } from "lucide-react";

const searchSchema = z.object({
  redirect: fallback(z.string(), "/").default("/"),
});

export const Route = createFileRoute("/login")({
  ssr: false,
  validateSearch: zodValidator(searchSchema),
  beforeLoad: async ({ search }) => {
    const { data } = await supabase.auth.getUser();
    if (data.user) {
      throw redirect({ to: (search.redirect || "/") as string });
    }
  },
  head: () => ({
    meta: [
      { title: "Access Terminal — InstaScanner" },
      { name: "description", content: "Authorized operators only. InstaScanner is invite-only." },
      { name: "robots", content: "noindex,nofollow" },
    ],
  }),
  component: LoginPage,
});

function LoginPage() {
  const search = Route.useSearch();
  const navigate = useNavigate();
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Redirect target sanitisation — only same-origin relative paths.
  const redirectTo =
    typeof search.redirect === "string" && search.redirect.startsWith("/")
      ? search.redirect
      : "/";

  useEffect(() => {
    // If a session appears mid-flight (e.g. another tab), route in.
    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "SIGNED_IN" && session) {
        navigate({ to: redirectTo, replace: true });
      }
    });
    return () => sub.subscription.unsubscribe();
  }, [navigate, redirectTo]);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setLoading(false);
    if (error) {
      setError(error.message);
      toast.error("Access denied");
      return;
    }
    toast.success("Access granted");
    navigate({ to: redirectTo, replace: true });
  };

  return (
    <div className="relative min-h-screen w-full overflow-hidden bg-background text-foreground">
      {/* Ambient grid */}
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.15]"
        style={{
          backgroundImage:
            "linear-gradient(rgba(255,255,255,0.05) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.05) 1px, transparent 1px)",
          backgroundSize: "48px 48px",
        }}
      />
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_center,transparent_0%,hsl(var(--background))_70%)]" />

      <div className="relative z-10 flex min-h-screen items-center justify-center px-4">
        <div className="w-full max-w-[420px]">
          {/* Classified header */}
          <div className="mb-8 flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.28em] text-muted-foreground">
            <span className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-400/70 shadow-[0_0_10px_rgba(52,211,153,0.7)]" />
            Secure Access Terminal
          </div>

          <div className="rounded-lg border border-border/70 bg-card/40 backdrop-blur-sm">
            <div className="flex items-start gap-3 border-b border-border/60 px-6 py-5">
              <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-border/60 bg-background/60">
                <Radar className="h-4 w-4 text-muted-foreground" />
              </div>
              <div className="min-w-0">
                <div className="text-sm font-medium text-foreground">InstaScanner</div>
                <div className="mt-0.5 text-xs text-muted-foreground">
                  Autonomous intelligence platform · invite-only
                </div>
              </div>
            </div>

            <form onSubmit={onSubmit} className="space-y-5 px-6 py-6">
              <div className="space-y-1.5">
                <label htmlFor="email" className="block text-[10px] font-medium uppercase tracking-[0.2em] text-muted-foreground">
                  Operator ID
                </label>
                <input
                  id="email"
                  type="email"
                  autoComplete="email"
                  autoFocus
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="operator@domain"
                  className="w-full h-10 rounded-md border border-border/70 bg-background/60 px-3 text-sm text-foreground placeholder:text-muted-foreground/60 focus:border-primary/60 focus:outline-none focus:ring-2 focus:ring-primary/20"
                />
              </div>

              <div className="space-y-1.5">
                <label htmlFor="password" className="block text-[10px] font-medium uppercase tracking-[0.2em] text-muted-foreground">
                  Passphrase
                </label>
                <input
                  id="password"
                  type="password"
                  autoComplete="current-password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••••"
                  className="w-full h-10 rounded-md border border-border/70 bg-background/60 px-3 text-sm text-foreground placeholder:text-muted-foreground/60 focus:border-primary/60 focus:outline-none focus:ring-2 focus:ring-primary/20"
                />
              </div>

              {error && (
                <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                  {error}
                </div>
              )}

              <button
                type="submit"
                disabled={loading}
                className="group inline-flex h-10 w-full items-center justify-center gap-2 rounded-md bg-foreground text-sm font-medium text-background transition hover:bg-foreground/90 disabled:opacity-60"
              >
                {loading ? (
                  <>
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    Authenticating…
                  </>
                ) : (
                  <>
                    <ShieldCheck className="h-3.5 w-3.5" />
                    Authenticate
                  </>
                )}
              </button>
            </form>

            <div className="border-t border-border/60 px-6 py-3 text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
              No public sign-up. Access granted by invitation only.
            </div>
          </div>

          <div className="mt-6 flex items-center justify-between text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
            <span>Network active</span>
            <Link to="/" className="hover:text-foreground transition">
              ← Return
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ServicePicker, type ProviderService } from "./service-picker";
import { supabase } from "@/integrations/supabase/client";
import { extractUsername, isValidUsername, normalizeUsername } from "@/lib/monitor/usernames";

type Step = "profile" | "action" | "confirm";

export function AddMonitorDialog({ onCreated }: { onCreated?: () => void }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<Step>("profile");

  const [username, setUsername] = useState("");
  const parsedUsername = (() => {
    const raw = extractUsername(username);
    if (!raw || !isValidUsername(raw)) return null;
    return { username: raw, normalized: normalizeUsername(raw) };
  })();

  const [service, setService] = useState<ProviderService | null>(null);
  const [quantity, setQuantity] = useState("1");
  const [name, setName] = useState("");

  const target = parsedUsername
    ? `https://instagram.com/${parsedUsername.username}`
    : "";

  const reset = () => {
    setStep("profile");
    setUsername("");
    setService(null);
    setQuantity("1");
    setName("");
  };

  const createMutation = useMutation({
    mutationFn: async () => {
      if (!parsedUsername) throw new Error("Enter a valid username");
      if (!service) throw new Error("Select a service");
      const qty = Math.max(1, Number(quantity) || 1);

      const { data: user, error: userError } = await supabase.auth.getUser();
      if (userError || !user.user) throw new Error("Not signed in");
      const uid = user.user.id;

      const { data: account, error: accountError } = await supabase
        .from("monitor_accounts")
        .insert({
          user_id: uid,
          username: parsedUsername.username,
          normalized_username: parsedUsername.normalized,
        })
        .select("id")
        .maybeSingle();

      if (accountError) throw accountError;
      if (!account) throw new Error("Account could not be created");

      const { error: templateError } = await supabase.from("monitor_action_templates").insert({
        account_id: account.id,
        name: name || service.name.slice(0, 60) || "Order",
        service_reference: service.service,
        quantity: qty,
        target_template: "https://instagram.com/{username}",
        position: 0,
        dry_run: false,
        enabled: true,
      });

      if (templateError) throw templateError;
      return account.id;
    },
    onSuccess: (id) => {
      toast.success("Account added and armed");
      void qc.invalidateQueries({ queryKey: ["monitor-accounts"] });
      void qc.invalidateQueries({ queryKey: ["monitor-templates", id] });
      reset();
      setOpen(false);
      onCreated?.();
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Could not add account"),
  });

  const canProceedToAction = Boolean(parsedUsername);
  const canProceedToConfirm = Boolean(service);

  const estimatedCost = service
    ? ((Number(quantity) || 0) * Number(service.rate || 0)) / 1000
    : 0;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm">
          <Plus className="mr-1.5 h-3.5 w-3.5" /> Add account
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Add account</DialogTitle>
          <DialogDescription>
            {step === "profile" && "Enter the Instagram handle to watch."}
            {step === "action" && "Pick the service that fires when it turns public."}
            {step === "confirm" && "Review before arming the monitor."}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {step === "profile" && (
            <div className="space-y-2">
              <Label htmlFor="monitor-username">Username</Label>
              <Input
                id="monitor-username"
                placeholder="@handle or https://instagram.com/handle"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                {parsedUsername ? (
                  <span className="text-success">Valid: @{parsedUsername.username}</span>
                ) : username ? (
                  <span className="text-destructive">Not a valid Instagram handle</span>
                ) : (
                  "Use @handle or a profile URL."
                )}
              </p>
            </div>
          )}

          {step === "action" && (
            <div className="space-y-4">
              <ServicePicker
                onSelect={(s) => {
                  setService(s);
                  setQuantity(String(Math.max(1, s.min)));
                  setName((n) => n || s.name.slice(0, 60));
                }}
                selectedService={service?.service}
              />
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="monitor-qty">Quantity</Label>
                  <Input
                    id="monitor-qty"
                    type="number"
                    min={service?.min ?? 1}
                    max={service?.max ?? undefined}
                    value={quantity}
                    onChange={(e) => setQuantity(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="monitor-name">Template name</Label>
                  <Input
                    id="monitor-name"
                    placeholder="Order"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label>Target</Label>
                <p className="rounded-md border border-border/60 bg-muted/30 px-3 py-2 font-mono text-xs">
                  {target || "—"}
                </p>
              </div>
            </div>
          )}

          {step === "confirm" && parsedUsername && service && (
            <div className="space-y-3 rounded-lg border border-border/60 bg-muted/20 p-4 text-sm">
              <p>
                When <span className="font-medium">@{parsedUsername.username}</span> turns public,
                place order{" "}
                <span className="font-mono text-muted-foreground">#{service.service}</span> ×{" "}
                {quantity}.
              </p>
              <p className="text-xs text-muted-foreground">
                Estimated cost: {estimatedCost.toFixed(4)} USD · target {target}
              </p>
            </div>
          )}
        </div>

        <DialogFooter>
          {step !== "profile" && (
            <Button variant="secondary" onClick={() => setStep(step === "confirm" ? "action" : "profile")}>
              Back
            </Button>
          )}
          {step === "profile" && (
            <Button disabled={!canProceedToAction} onClick={() => setStep("action")}>
              Continue
            </Button>
          )}
          {step === "action" && (
            <Button disabled={!canProceedToConfirm} onClick={() => setStep("confirm")}>
              Continue
            </Button>
          )}
          {step === "confirm" && (
            <Button onClick={() => createMutation.mutate()} disabled={createMutation.isPending}>
              {createMutation.isPending ? "Adding…" : "Add account & arm"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

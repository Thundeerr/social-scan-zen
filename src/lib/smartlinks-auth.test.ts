import { beforeEach, expect, it, vi } from "vitest";
const command = vi.hoisted(() => vi.fn(async () => ({ ok: true })));
vi.mock("./smartlinks.server", () => ({ smartlinkCommand: command }));
vi.mock("@/integrations/supabase/auth-middleware", () => ({ requireSupabaseAuth: {} }));
vi.mock("@tanstack/react-start", () => ({
  createServerFn: () => ({
    middleware() {
      return this;
    },
    inputValidator() {
      return this;
    },
    handler(fn: unknown) {
      return fn;
    },
  }),
}));
import { smartlinkFn } from "./smartlinks.functions";
beforeEach(() => command.mockClear());
const invoke = (user: unknown, error: unknown = null) =>
  (smartlinkFn as unknown as (input: unknown) => Promise<unknown>)({
    data: { action: "overview" },
    context: {
      userId: "operator-id",
      supabase: { auth: { getUser: async () => ({ data: { user }, error }) } },
    },
  });
it.each([null, { id: "different-id" }, { id: "operator-id", is_anonymous: true }])(
  "rejects missing, mismatched or anonymous live identity: %j",
  async (user) => {
    await expect(invoke(user)).rejects.toThrow("Bitte erneut anmelden");
    expect(command).not.toHaveBeenCalled();
  },
);
it("rejects a revoked or failed session", async () => {
  await expect(invoke({ id: "operator-id" }, Error("revoked"))).rejects.toThrow();
  expect(command).not.toHaveBeenCalled();
});
it("passes a verified identity to the ownership-checked service", async () => {
  await expect(invoke({ id: "operator-id", is_anonymous: false })).resolves.toEqual({ ok: true });
  expect(command).toHaveBeenCalledWith("operator-id", { action: "overview" });
});

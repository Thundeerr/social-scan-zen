import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";
const db = new PGlite(),
  owner = crypto.randomUUID();
try {
  await db.exec(
    "create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create table auth.users(id uuid primary key);",
  );
  await db.exec(
    await readFile(
      new URL(
        "../supabase/migrations/20261028175839_business_cost_allocation.sql",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  await db.query("insert into auth.users values($1)", [owner]);
  for (const role of ["anon", "authenticated"]) {
    await db.exec(`set role ${role}`);
    for (const table of ["business_cost_allocations", "wavespeed_task_attributions"])
      await assert.rejects(db.exec(`select * from ${table}`), (e) => e.code === "42501");
    await db.exec("reset role");
  }
  await db.exec("set role service_role");
  await db.query(
    "insert into business_cost_allocations values($1,'test','Test','kiikii','EUR',5725,'2026-10-28',false,'Confirmed')",
    [owner],
  );
  await assert.rejects(
    db.query(
      "insert into business_cost_allocations values($1,'bad','Test','kiikii','BTC',5725,'2026-10-28',false,'Confirmed')",
      [owner],
    ),
    (e) => e.code === "23514",
  );
  await db.query(
    "insert into wavespeed_task_attributions(user_id,provider_id,model,evidence) values($1,repeat('a',32),'kiikii','manifest proof')",
    [owner],
  );
  await assert.rejects(
    db.query(
      "insert into wavespeed_task_attributions(user_id,provider_id,model,evidence) values($1,repeat('a',32),'kiikii','manifest proof')",
      [owner],
    ),
    (e) => e.code === "23505",
  );
  console.log("Allocation ACL, constraints and attribution uniqueness passed");
} finally {
  await db.close();
}

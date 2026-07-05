# InstaScanner — Frontend Plan

A premium, dark-mode-only internal dashboard for monitoring Instagram accounts. Frontend only, no backend, no auth, all dummy data.

## Design system

- Dark mode only. Force `.dark` class on `<html>` and remove light theme toggling from the shell.
- Update `src/styles.css` tokens for a Linear/Vercel-inspired palette:
  - `--background` near-black (`oklch(0.16 0.01 260)`), elevated surfaces `--card` slightly lighter.
  - Subtle blue accent as `--primary` (`oklch(0.68 0.16 250)`), used sparingly for status dots, focus rings, active nav, primary buttons.
  - Muted foreground, thin borders (`oklch(1 0 0 / 8%)`), soft shadows.
- Rounded corners (`--radius: 0.75rem`), generous spacing, `Inter` via `<link>` in `__root.tsx` head.
- Typography scale: small labels uppercase tracked, tabular numerics for KPIs.

## Layout shell

`src/routes/__root.tsx` gets a real app shell (kept simple, no auth):

```
┌──────────────────────────────────────────────┐
│ Topbar: logo · search · scan status · avatar │
├────────┬─────────────────────────────────────┤
│Sidebar │ <Outlet />                          │
│        │                                     │
└────────┴─────────────────────────────────────┘
```

- New components under `src/components/layout/`: `AppSidebar.tsx`, `TopBar.tsx`, `AppShell.tsx`.
- Sidebar items (TanStack `Link` with `activeProps`): Dashboard `/`, Tracked Accounts `/accounts`, New Posts `/posts`, Downloads `/downloads`, Scanner `/scanner`, Settings `/settings`. Logo + "InstaScanner / Private Instagram Monitoring" at top, owner mini-card at bottom.
- Top bar: wordmark, `⌘K`-styled search input, scan status pill (pulsing blue dot + "Scanning · 12 min ago"), avatar.

## Routes

Each is a separate route file with its own `head()` metadata and route-specific title.

1. `src/routes/index.tsx` — **Dashboard**
   - 5 KPI cards (Tracked Accounts 247, New Posts Today 34, Last Scan 12 min ago, Scanner Status Running, API Provider Instagram Looter). Each card: label, big number, subtle delta/subtext, tiny icon.
   - Two-column grid below:
     - Left (wide): "Recent Posts Feed" — list of ~8 post cards. Each card: avatar, username, "detected 14 min ago", 1:1 thumbnail (dummy image), caption preview (2 lines), action row (View / Download / Approve / Ignore) with icon buttons.
     - Right (narrow): "Scanner Activity" timeline with vertical rail, timestamps and events per spec plus a few extra realistic lines.

2. `src/routes/accounts.tsx` — **Tracked Accounts**
   - Header with title, description, and "Add Account" primary button (opens shadcn `Dialog` with a stub form — no submit logic).
   - Search + status filter chips.
   - shadcn `Table`: Avatar, Username, Status (Active/Paused pill), Last Scan, Posts Today, Actions (`⋯` menu: Pause, Rescan, Remove).
   - 20+ dummy rows (nike, adidas, apple, spacex, etc.).

3. `src/routes/posts.tsx` — **New Posts**
   - Filter tabs: Today, Yesterday, Approved, Ignored, Downloaded (client-side filter over dummy list).
   - Responsive gallery grid (2/3/4 cols) of large thumbnails with hover overlay showing username, caption, and quick actions.

4. `src/routes/downloads.tsx` — **Downloads**
   - Centered empty state: soft illustration (inline SVG), "No downloads yet", helper text, secondary button "Browse new posts" linking to `/posts`.

5. `src/routes/scanner.tsx` — **Scanner**
   - Health KPI grid: Queue size 12, Requests (last hour) 1,284, Success Rate 99.2%, Avg Response Time 412 ms, Estimated Next Scan in 3 min.
   - Sparkline placeholders (static SVGs) for requests and response time.
   - Recent scan log card (reuses activity timeline component).

6. `src/routes/settings.tsx` — **Settings**
   - Stacked setting cards: API Provider (Select: Instagram Looter / RapidAPI / Custom), Scan Interval (Select: 5/15/30/60 min), Notifications (Switches: Email, Desktop, New posts only), Dark Mode (Switch, locked on with note "Dark mode only").
   - All controls are local `useState`, purely cosmetic.

## Dummy data

`src/lib/mock-data.ts` exports typed arrays: `trackedAccounts`, `recentPosts`, `scannerActivity`, `kpis`, `scannerHealth`. Thumbnails use `https://picsum.photos/seed/<slug>/600/600`, avatars `https://i.pravatar.cc/80?u=<slug>`. Captions and usernames are realistic (brands, creators).

## Components to add

- `src/components/kpi-card.tsx`
- `src/components/post-card.tsx`
- `src/components/activity-timeline.tsx`
- `src/components/status-pill.tsx`
- `src/components/empty-state.tsx`
- shadcn primitives to install if missing: `button`, `card`, `input`, `table`, `dialog`, `dropdown-menu`, `select`, `switch`, `tabs`, `avatar`, `badge`, `separator`, `tooltip`, `scroll-area`.

## Technical notes

- Force dark mode by adding `className="dark"` to `<html>` in `RootShell` and updating `body` bg token.
- Update root `head()` to real title/description: "InstaScanner — Private Instagram Monitoring".
- All navigation via `<Link to="...">`; no `<a href>` for internal routes.
- No server functions, no Supabase, no auth — pure client rendering with static data.
- Icons via `lucide-react` (already present).

## Out of scope

Backend, API integration, database, authentication, real image downloads, form submission logic.

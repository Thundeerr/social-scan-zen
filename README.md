# InstaScan

We are building a brand new web application called "InstaScanner".

This is a private internal tool. It is NOT a public SaaS.

Only two people (Owner and Co-Founder) will ever use it.

The goal is to monitor hundreds of Instagram accounts and present newly detected posts in a clean review dashboard.

For now, DO NOT implement any backend logic, API integrations or database.

Build only the frontend with realistic dummy data.

--------------------------------------------------
GENERAL STYLE
--------------------------------------------------

Create a premium, modern dashboard.

Design inspiration:

• Linear
• Raycast
• Vercel Dashboard
• Stripe Dashboard
• Notion

The application should feel minimal, extremely polished and fast.

Use rounded corners.

Soft shadows.

Beautiful spacing.

Dark mode only.

No bright colors except subtle blue accents.

The dashboard should feel like an internal intelligence tool.

--------------------------------------------------
BRANDING
--------------------------------------------------

Name:

InstaScanner

Tagline:

Private Instagram Monitoring

--------------------------------------------------
LAYOUT
--------------------------------------------------

Left Sidebar

Top Navigation

Main Dashboard

--------------------------------------------------
SIDEBAR
--------------------------------------------------

Dashboard

Tracked Accounts

New Posts

Downloads

Scanner

Settings

--------------------------------------------------
TOP BAR
--------------------------------------------------

Logo

Search bar

Current scan status

Owner avatar

--------------------------------------------------
DASHBOARD
--------------------------------------------------

Top KPI cards

Tracked Accounts

247

New Posts Today

34

Last Scan

12 minutes ago

Scanner Status

Running

API Provider

Instagram Looter

--------------------------------------------------
MAIN SECTION

Recent Posts Feed

Display multiple Instagram cards with realistic dummy data.

Each card should contain:

Instagram avatar

Username

Time detected

Thumbnail

Caption preview

Buttons

View

Download

Approve

Ignore

--------------------------------------------------
RIGHT PANEL

Scanner Activity

Example timeline:

14:02

Started scan

14:03

Checked @nike

14:03

2 new posts

14:04

Checked @adidas

14:05

No new posts

14:06

Scan complete

--------------------------------------------------
TRACKED ACCOUNTS PAGE

Beautiful table

Columns

Avatar

Username

Status

Last Scan

Posts Today

Actions

Include an "Add Account" button.

--------------------------------------------------
NEW POSTS PAGE

Gallery view

Large thumbnails

Filters

Today

Yesterday

Approved

Ignored

Downloaded

--------------------------------------------------
DOWNLOAD PAGE

Empty state with illustration.

--------------------------------------------------
SCANNER PAGE

Display scanner health.

Queue size

Requests

Success Rate

Average Response Time

Estimated next scan

--------------------------------------------------
SETTINGS

API Provider

Scan Interval

Notifications

Dark Mode

--------------------------------------------------
IMPORTANT

Do NOT build backend.

Do NOT create Supabase.

Do NOT add authentication.

Use realistic placeholder data.

Focus entirely on creating an incredibly polished dashboard UI.

The goal is to make this feel like a premium internal application that could realistically be used every day.

This project was built with [Lovable](https://lovable.dev).

**Live app**: https://social-scan-zen.lovable.app

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/ce0fb3b8-4989-4edb-bd54-0e1864d5ab04).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```

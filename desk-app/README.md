# The Desk — Director / EA Execution Workspace

A real, deployed web app: separate logins for the Director and the EA, a live
shared database, AI task capture (type or speak), reminders, an AI portal,
and direct chat between both desks.

Stack: **Next.js** (app) + **Supabase** (auth + database + realtime) + **Vercel** (hosting).

---

## 1. Create your Supabase project (~5 min)

1. Go to https://supabase.com → **New project**. Pick any name/region, set a database password (save it somewhere).
2. Once it's ready, open **SQL Editor → New query**, paste the entire contents of `supabase/schema.sql` from this project, and click **Run**.
3. Go to **Authentication → Users → Add user** and create two accounts:
   - Director's real email + a password
   - EA's real email + a password
   (Turn off "auto confirm" only if you want them to verify by email first — for an internal tool, leave auto-confirm on.)
4. Click into each user to copy their **UID**.
5. Back in **SQL Editor**, run (with your real UIDs and names):
   ```sql
   insert into profiles (id, role, name) values
     ('paste-director-uid-here', 'director', 'Director Name'),
     ('paste-ea-uid-here', 'ea', 'EA Name');
   ```
6. Go to **Project Settings → API**. Copy:
   - **Project URL** → this is `NEXT_PUBLIC_SUPABASE_URL`
   - **anon public** key → this is `NEXT_PUBLIC_SUPABASE_ANON_KEY`

## 2. Get an Anthropic API key (~1 min)

Go to https://console.anthropic.com → **API Keys → Create key**. This powers the
voice-to-task AI and the AI portal. It's billed separately from your Claude.ai
subscription (pay-as-you-go, based on usage).

## 3. Run it locally first (optional but recommended)

```bash
npm install
cp .env.example .env.local
# paste your 3 keys into .env.local
npm run dev
```
Open http://localhost:3000, sign in with the Director or EA account you created.

## 4. Deploy to Vercel (~5 min)

1. Push this project to a GitHub repo (Vercel deploys from GitHub).
2. Go to https://vercel.com → **Add New → Project** → import that repo.
3. In **Environment Variables**, add the same 3 keys from `.env.example`
   (`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `ANTHROPIC_API_KEY`).
4. Click **Deploy**. You'll get a live URL (e.g. `the-desk.vercel.app`) — that's
   the real, permanent link for both the Director and the EA.

## How data flows

- **Auth**: Supabase Auth — real email/password accounts, one per person.
- **Database**: Postgres tables `tasks`, `task_updates`, `reminders`, `chat_messages`,
  protected by row-level security (see `supabase/schema.sql`).
- **Live sync**: Supabase Realtime — the moment one desk changes something, the
  other desk updates within a second, no refresh needed.
- **AI**: two server-side API routes (`/api/parse-task`, `/api/ai-chat`) call
  Claude using your `ANTHROPIC_API_KEY`. The key never reaches the browser.
- **Voice capture**: the browser's built-in Speech Recognition (Chrome only, no
  extra service needed).

## Adding a third person later

Create their Supabase Auth user, add a `profiles` row with `role` set to
`'director'` or `'ea'` (only these two roles exist right now — say the word if
you want more roles like Unit Head or Finance, same pattern as your MDOS reference).

## Notes / things to decide later

- Right now sign-up is **admin-only** (you create accounts in Supabase, not a
  public signup form) — appropriate for a 2-person internal tool.
- Password reset: Supabase has a built-in "forgot password" email flow; ask if
  you want that wired into the login screen.
- Custom domain: once deployed, add your domain under Vercel → Project →
  Settings → Domains.

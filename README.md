# EliMatic HQ V6 — GitHub + Supabase + Gemini

This is a cloud-deployable scaffold, not a live deployment. GitHub is the source repository and GitHub Pages hosts the dashboard; Supabase provides user authentication, a shared database and an Edge Function; GitHub Actions triggers an hourly job tick; Gemini generates the reports.

## Deploy (in order)

1. Create a **private GitHub repository** and upload the contents of this ZIP, preserving `.github/workflows/agent-cron.yml`. For GitHub Pages, either enable Pages on the repository if your account supports Pages for this repo visibility, or create a separate public frontend repository. **Public frontend files contain no secret keys.**
2. Create a Supabase project. In the SQL Editor run `supabase/migrations/001_hq.sql`. This enables row-level security so users can only read their own records.
3. Install the Supabase CLI, log in and link the project. From this folder:
   ```
   supabase login
   supabase link --project-ref YOUR_PROJECT_REF
   supabase secrets set GEMINI_API_KEY=YOUR_GEMINI_KEY HQ_CRON_SECRET=YOUR_LONG_RANDOM_SECRET
   supabase functions deploy hq --no-verify-jwt
   ```
   The `HQ_CRON_SECRET` is a random long string used only by the GitHub scheduler. Do not put it in browser files.
4. In `config.js`, enter **only** the Supabase project URL and public publishable/anon key from Supabase's API settings. This file is safe to expose as long as RLS is correctly enabled. Never put a Gemini key, service-role key or cron secret in frontend files.
5. In GitHub repository **Settings → Secrets and variables → Actions**, create:
   - `HQ_FUNCTION_URL` = `https://YOUR_PROJECT.supabase.co/functions/v1/hq`
   - `HQ_CRON_SECRET` = the exact secret used in step 3.
6. Configure GitHub Pages to deploy the repository root (Settings → Pages → Deploy from branch). Your site will be at a `github.io` URL. If the repo is private and Pages isn't available, publish the frontend files in a separate public repo, keeping backend source and secrets in the private repo.
7. Open the site, create an account and sign in. If Supabase email confirmation is enabled, confirm the email first.
8. In GitHub Actions, manually run **EliMatic HQ agent tick** to test execution. Then inspect the Supabase `hq_jobs` table and dashboard results. Scheduled ticks run hourly but GitHub scheduled workflows can be delayed or skipped.

## How it works

- All 10 agents are implemented as **role instructions** and share job results from the same user in Supabase.
- A user can queue a mission or add a recurring schedule from the dashboard.
- The hourly GitHub Action sends a request with a secret header to the Supabase Edge Function.
- The function creates due jobs and processes up to 2 queued jobs per tick.
- YouTube, acting and business workflows create sequential jobs; later jobs require approval.
- The function uses the Supabase service role server-side only and verifies each signed-in user's JWT before accepting interactive actions.
- `verify_jwt = false` is intentional because the scheduler authenticates with `x-hq-cron`; the function itself checks the secret for ticks and checks JWTs for all other operations.

## Important limitations and safety

- This **does not yet provide live** YouTube Analytics, casting search, calendar, email or payments. The agents can only use mission text and stored previous reports, and must not claim otherwise.
- Supabase and Gemini have plan limits and potential usage costs. Verify quotas and billing before enabling recurring jobs.
- GitHub Actions schedules are **not a reliable 24/7 job runner** and can be delayed. This is a low-cost starting architecture.
- The cloud V6 dashboard does not automatically migrate V5's browser localStorage data. `legacy-v5.html` is retained as a separate prototype.
- The `tick` function currently processes two jobs per invocation to bound execution time. It is not guaranteed exactly-once processing under concurrent requests; production hardening requires atomic database job claiming, retries and observability.
- **Do not put private information in agent mission text unless you are comfortable storing it in your Supabase project and sending it to Gemini.**
- Supabase Auth sign-up may be open to anyone with your URL. RLS isolates accounts, but you should disable public sign-ups or restrict allowed users if this is only your private HQ.
- To test the GitHub Pages dashboard, you must deploy it. Opening `index.html` from a file URL may not work because it imports a module.

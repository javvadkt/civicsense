# UPSC Current Affairs Hub

Source code for the UPSC Current Affairs Hub. This export is configured to build on Vercel with standard Next.js.

## Deploy on Vercel

Import this GitHub repository in Vercel and use the repository root as the Root Directory. Select the **Next.js** framework preset. Use the default build command (`pnpm run build`) and leave the Output Directory at its Next.js default (`.next`). Set the project Node.js version to 22.13 or newer.

The Vercel build runs `next build`, which creates `.next/routes-manifest.json`. The original ChatGPT Sites build uses Vinext and targets Cloudflare; it is available as `pnpm run build:sites` but must not be used as Vercel's build command.

## Local development

Requirements: Node.js 22.13+ and pnpm 11.25.0. Run:

```sh
pnpm install
pnpm dev
```

## Supabase

Read [`supabase/README.md`](supabase/README.md) before changing the database. SQL scripts are run in the Supabase SQL Editor; they are not run by a Vercel deployment. Edge Function source is under `supabase/functions/`; Vercel does not deploy those functions to Supabase automatically. Keep the service-role key in Supabase Edge Function secrets only. The browser app uses the Supabase publishable key, which is intended for client-side use and must be protected by correct Row Level Security policies.

The browser reuses identical read responses for up to 30 seconds and coalesces concurrent identical reads. Successful writes invalidate that session's cached reads, and the workspace header's **Refresh** button bypasses the cache. Quiz answer autosaves and the active-quiz close poll are never cached.

After changing the app's hosting domain, add the Vercel domain to Supabase Authentication's Site URL and Redirect URLs as needed for password reset or other auth redirects.

# Minus on Supabase

Your account, devices and the phone ↔ PC link run on Supabase. The app only ever holds the
**publishable** key (in `site/app/config.js`); every table is locked to its owner with row
level security. The secret key is never used by the app and never belongs in this repo.

One-time setup for project `hwioabkfnqppgdfscukz`:

1. **Tables.** Supabase → SQL Editor → New query → paste all of `setup.sql` → Run.
2. **GitHub sign-in.**
   - On GitHub: Settings → Developer settings → OAuth Apps → New OAuth App.
     - Homepage URL: `https://getminus.vercel.app`
     - Authorization callback URL: `https://hwioabkfnqppgdfscukz.supabase.co/auth/v1/callback`
   - In Supabase: Authentication → Sign In / Providers → GitHub → turn it on, paste the
     Client ID and a new Client Secret from that OAuth app → Save.
3. **Where sign-in may return to.** Authentication → URL Configuration:
   - Site URL: `https://getminus.vercel.app`
   - Redirect URLs: add `minus://auth/callback` (the apps) and `https://getminus.vercel.app/**`
4. **QR pairing.** Edge Functions → Deploy a new function → via Editor → name it `pair` →
   paste `functions/pair/index.ts` → Deploy. (It uses Supabase's own built-in secrets.)

That's all. Sign in on your PC, then Settings → Devices → New, and scan the code with your phone.

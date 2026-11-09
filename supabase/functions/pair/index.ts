// Pairs a phone (or another computer) with your account using the QR code a signed-in
// PC shows. The phone sends the code; if it's valid, unused and not expired, this signs
// the phone in as you by returning a one-time sign-in token, and marks the code used.
//
// Deploy: Supabase dashboard -> Edge Functions -> Deploy a new function -> name it "pair",
// paste this file. It uses the project's built-in SUPABASE_URL and
// SUPABASE_SERVICE_ROLE_KEY secrets, which never leave Supabase.
import { createClient } from "npm:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  if (req.method !== "POST") return json({ error: "use POST" }, 405);

  let code = "";
  try {
    ({ code } = await req.json());
  } catch {
    return json({ error: "send { code }" }, 400);
  }
  if (typeof code !== "string" || !/^[0-9a-f]{48}$/.test(code)) return json({ error: "That code isn't valid." }, 400);

  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { persistSession: false },
  });

  // claim the code atomically: only an unused, unexpired code gets marked used
  const { data: row, error } = await admin
    .from("pairing_codes")
    .update({ used_at: new Date().toISOString() })
    .eq("code", code)
    .is("used_at", null)
    .gt("expires_at", new Date().toISOString())
    .select("owner")
    .maybeSingle();
  if (error) return json({ error: "Couldn't check the code. Try again." }, 500);
  if (!row) return json({ error: "That code expired or was already used. Make a new one on your PC." }, 410);

  const { data: user, error: uerr } = await admin.auth.admin.getUserById(row.owner);
  if (uerr || !user?.user?.email) return json({ error: "Couldn't find your account." }, 404);

  // a one-time sign-in token for that account; the phone exchanges it for a session
  const { data: link, error: lerr } = await admin.auth.admin.generateLink({ type: "magiclink", email: user.user.email });
  if (lerr || !link?.properties?.hashed_token) return json({ error: "Couldn't sign the device in." }, 500);

  return json({ token_hash: link.properties.hashed_token, type: "magiclink" });
});

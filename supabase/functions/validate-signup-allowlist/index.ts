// Supabase Auth Hook: "Before User Created" — DEFENSE IN DEPTH ONLY.
//
// ⚠️ IMPORTANT — Lovable Cloud deployment note:
// Lovable Cloud does NOT expose the Supabase Dashboard, so this function
// CANNOT be registered as a "Before User Created" Auth Hook. The PRIMARY
// allowlist enforcement is the database trigger
// `enforce_signup_allowlist_trigger` (BEFORE INSERT ON auth.users), created
// by migration 20260605_enforce_signup_allowlist. This edge function is
// kept deployed as a hardened fallback in case the hook ever becomes
// configurable (or the project migrates to a self-managed Supabase
// instance), but it is NOT in the live signup path on Lovable Cloud.
//
// Security:
// - Verifies Standard Webhooks signature using AUTH_HOOK_SECRET before
//   processing the body. Unsigned/invalid requests get a generic 403.
// - verify_jwt remains false (Supabase Auth would invoke without JWT).
// - Logs include email/decision for audit; HTTP body never reveals it.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { Webhook } from "https://esm.sh/standardwebhooks@1.0.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, webhook-id, webhook-timestamp, webhook-signature",
};

interface BeforeUserCreatedPayload {
  user: {
    id: string;
    email?: string;
    phone?: string;
    raw_user_meta_data?: Record<string, unknown>;
  };
}

// Generic, indistinguishable rejection used for ANY failure path that is
// reachable without a valid signature, or for any business rejection.
// Same message + same http_code regardless of cause → no enumeration.
const GENERIC_REJECTION = {
  error: {
    http_code: 403,
    message: "Registro no permitido. Solicita acceso a un administrador.",
  },
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const rawBody = await req.text();

  // ─── 1. Verify signature (Standard Webhooks) ─────────────────
  const secret = Deno.env.get("AUTH_HOOK_SECRET");
  if (!secret) {
    console.error("[validate-signup-allowlist] AUTH_HOOK_SECRET not configured");
    return jsonResponse(GENERIC_REJECTION);
  }

  const webhookId = req.headers.get("webhook-id") ?? "";
  const webhookTimestamp = req.headers.get("webhook-timestamp") ?? "";
  const webhookSignature = req.headers.get("webhook-signature") ?? "";

  if (!webhookId || !webhookTimestamp || !webhookSignature) {
    console.warn("[validate-signup-allowlist] Missing webhook signature headers");
    return jsonResponse(GENERIC_REJECTION);
  }

  let verifiedPayload: BeforeUserCreatedPayload;
  try {
    // Standard Webhooks expects the secret in `whsec_BASE64` form. Supabase
    // gives it prefixed as `v1,whsec_...`; strip the version prefix.
    const normalizedSecret = secret.startsWith("v1,") ? secret.slice(3) : secret;
    const wh = new Webhook(normalizedSecret);
    verifiedPayload = wh.verify(rawBody, {
      "webhook-id": webhookId,
      "webhook-timestamp": webhookTimestamp,
      "webhook-signature": webhookSignature,
    }) as BeforeUserCreatedPayload;
  } catch (err) {
    console.warn(
      "[validate-signup-allowlist] Signature verification failed:",
      (err as Error)?.message ?? "unknown",
    );
    return jsonResponse(GENERIC_REJECTION);
  }

  // ─── 2. Process the (now-trusted) payload ────────────────────
  const email = verifiedPayload?.user?.email?.toLowerCase().trim();
  if (!email) {
    console.warn("[validate-signup-allowlist] Verified payload missing email");
    return jsonResponse(GENERIC_REJECTION);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data, error } = await admin
    .from("allowed_emails")
    .select("email")
    .eq("email", email)
    .maybeSingle();

  if (error) {
    console.error("[validate-signup-allowlist] DB error:", error);
    // Do NOT leak DB state to the caller. Same generic rejection.
    return jsonResponse(GENERIC_REJECTION);
  }

  if (!data) {
    console.info(
      `[validate-signup-allowlist] Signup rejected — not in allowlist: ${email}`,
    );
    return jsonResponse(GENERIC_REJECTION);
  }

  console.info(`[validate-signup-allowlist] Signup allowed: ${email}`);
  return jsonResponse({});
});

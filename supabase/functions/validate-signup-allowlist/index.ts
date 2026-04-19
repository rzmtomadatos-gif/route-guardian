// Supabase Auth Hook: "Before User Created"
// Validates that the email being registered exists in public.allowed_emails
// before allowing the auth.users INSERT to proceed.
//
// Configure in Supabase Dashboard:
//   Authentication → Hooks → Before User Created Hook
//   URL: https://<project>.supabase.co/functions/v1/validate-signup-allowlist
//
// This is the server-side enforcement of the email allowlist.
// The client-side check in AuthPage.tsx remains as a UX hint, but this hook
// is the authoritative gate that cannot be bypassed.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

interface BeforeUserCreatedPayload {
  user: {
    id: string;
    email?: string;
    phone?: string;
    raw_user_meta_data?: Record<string, unknown>;
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const payload = (await req.json()) as BeforeUserCreatedPayload;
    const email = payload?.user?.email?.toLowerCase().trim();

    if (!email) {
      return new Response(
        JSON.stringify({
          error: {
            http_code: 400,
            message: "Email is required for signup.",
          },
        }),
        {
          status: 200, // Hook responses are always 200; the error field signals rejection
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
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
      return new Response(
        JSON.stringify({
          error: {
            http_code: 500,
            message: "No se pudo validar el correo. Inténtalo de nuevo.",
          },
        }),
        {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    if (!data) {
      return new Response(
        JSON.stringify({
          error: {
            http_code: 403,
            message:
              "Este correo no está autorizado. Solicita acceso a un administrador.",
          },
        }),
        {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    // Allow the signup
    return new Response(JSON.stringify({}), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("[validate-signup-allowlist] Unexpected error:", err);
    return new Response(
      JSON.stringify({
        error: {
          http_code: 500,
          message: "Error interno validando el registro.",
        },
      }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  }
});

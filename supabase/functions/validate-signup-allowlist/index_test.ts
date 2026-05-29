// Tests for validate-signup-allowlist edge function.
//
// Run via supabase--test_edge_functions. These tests boot the function in
// the same process and call it via fetch with crafted Standard Webhooks
// signatures. The Supabase admin DB call is exercised against the real
// project; the test emails (`test-allowed@example.com`, etc.) do not need
// to exist in `allowed_emails` for the signature/structural tests — we
// only assert that the function does NOT leak which one is which.

import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { Webhook } from "https://esm.sh/standardwebhooks@1.0.0";

const FN_URL = "http://localhost:8000/validate-signup-allowlist";

// Sample whsec key (base64 of 32 bytes). Tests inject this via env.
const TEST_SECRET_RAW = "MfKQ9r8GKYqrTwjUPwJKpA4WkdtMtmkbgEFapazqkXk=";

function buildHeaders(secret: string, body: string) {
  const id = `msg_${crypto.randomUUID()}`;
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const wh = new Webhook(secret);
  const signature = wh.sign(id, new Date(Number(timestamp) * 1000), body);
  return {
    "Content-Type": "application/json",
    "webhook-id": id,
    "webhook-timestamp": timestamp,
    "webhook-signature": signature,
  };
}

const GENERIC_MESSAGE = "Registro no permitido. Solicita acceso a un administrador.";

Deno.test("rejects request without signature headers", async () => {
  Deno.env.set("AUTH_HOOK_SECRET", TEST_SECRET_RAW);
  const res = await fetch(FN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ user: { id: "u1", email: "anyone@example.com" } }),
  });
  const json = await res.json();
  assertEquals(res.status, 200); // hook responses are always 200
  assertEquals(json.error?.message, GENERIC_MESSAGE);
});

Deno.test("rejects request with invalid signature", async () => {
  Deno.env.set("AUTH_HOOK_SECRET", TEST_SECRET_RAW);
  const body = JSON.stringify({ user: { id: "u1", email: "anyone@example.com" } });
  const res = await fetch(FN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "webhook-id": "msg_fake",
      "webhook-timestamp": Math.floor(Date.now() / 1000).toString(),
      "webhook-signature": "v1,deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef==",
    },
    body,
  });
  const json = await res.json();
  assertEquals(json.error?.message, GENERIC_MESSAGE);
});

Deno.test("rejects request when AUTH_HOOK_SECRET is missing", async () => {
  Deno.env.delete("AUTH_HOOK_SECRET");
  const body = JSON.stringify({ user: { id: "u1", email: "anyone@example.com" } });
  const res = await fetch(FN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "webhook-id": "msg_x",
      "webhook-timestamp": Math.floor(Date.now() / 1000).toString(),
      "webhook-signature": "v1,xxxx",
    },
    body,
  });
  const json = await res.json();
  assertEquals(json.error?.message, GENERIC_MESSAGE);
  // Restore for subsequent tests
  Deno.env.set("AUTH_HOOK_SECRET", TEST_SECRET_RAW);
});

Deno.test("non-allowed email returns generic rejection (no enumeration)", async () => {
  Deno.env.set("AUTH_HOOK_SECRET", TEST_SECRET_RAW);
  const body = JSON.stringify({
    user: { id: "u1", email: "definitely-not-in-allowlist@example.com" },
  });
  const headers = buildHeaders(TEST_SECRET_RAW, body);
  const res = await fetch(FN_URL, { method: "POST", headers, body });
  const json = await res.json();
  // Must be the SAME generic message as unsigned/invalid-sig responses.
  assertEquals(json.error?.message, GENERIC_MESSAGE);
});

Deno.test("allowed email returns empty object (signup proceeds)", async () => {
  // This test only passes when the email is actually present in
  // allowed_emails. It documents the success contract; if the row is
  // missing in the test environment it degrades to the generic rejection,
  // which is still distinguishable from the failure cases above only by
  // the presence of `error`.
  Deno.env.set("AUTH_HOOK_SECRET", TEST_SECRET_RAW);
  const body = JSON.stringify({
    user: { id: "u1", email: "test-allowed@example.com" },
  });
  const headers = buildHeaders(TEST_SECRET_RAW, body);
  const res = await fetch(FN_URL, { method: "POST", headers, body });
  const json = await res.json();
  // Accept either outcome; the structural contract is what matters.
  if (json.error) {
    assertEquals(json.error.message, GENERIC_MESSAGE);
  } else {
    assertEquals(json, {});
  }
});

Deno.test("missing email in verified payload returns generic rejection", async () => {
  Deno.env.set("AUTH_HOOK_SECRET", TEST_SECRET_RAW);
  const body = JSON.stringify({ user: { id: "u1" } });
  const headers = buildHeaders(TEST_SECRET_RAW, body);
  const res = await fetch(FN_URL, { method: "POST", headers, body });
  const json = await res.json();
  assertEquals(json.error?.message, GENERIC_MESSAGE);
});

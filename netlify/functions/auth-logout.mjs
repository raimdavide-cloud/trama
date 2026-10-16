import { json, destroySession, sameOrigin, fail } from "../lib/core.mjs";

export default async (req) => {
  if (req.method !== "POST") return fail("method", "Usa POST.", 405);
  if (!sameOrigin(req)) return fail("forbidden", "Richiesta non consentita.", 403);
  return json({ ok: true }, 200, { "set-cookie": await destroySession(req) });
};

export const config = { path: "/api/auth/logout" };

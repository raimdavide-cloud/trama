import { env, randomId, cookie } from "../lib/core.mjs";
import { authorizeUrl } from "../lib/atlassian.mjs";

export default async () => {
  if (!env("ATLASSIAN_CLIENT_ID") || !env("APP_URL")) {
    return new Response("Configurazione mancante: ATLASSIAN_CLIENT_ID e APP_URL.", { status: 500 });
  }
  const state = randomId(16);
  return new Response(null, {
    status: 302,
    headers: { location: authorizeUrl(state), "set-cookie": cookie("bs_oauth_state", state, { maxAge: 600, path: "/api/auth" }) },
  });
};

export const config = { path: "/api/auth/login" };

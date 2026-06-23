// Google OAuth — exchange a refresh_token for a short-lived access_token.
// Run scripts/get_refresh_token.mjs locally once to obtain refresh_token, then
// register it: `wrangler secret put GOOGLE_REFRESH_TOKEN`.
//
// Ref: https://developers.google.com/identity/protocols/oauth2/web-server#offline

export interface GoogleAuthConfig {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
}

export async function getAccessToken(cfg: GoogleAuthConfig): Promise<string> {
  const body = new URLSearchParams({
    client_id: cfg.clientId,
    client_secret: cfg.clientSecret,
    refresh_token: cfg.refreshToken,
    grant_type: "refresh_token",
  });
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Google OAuth ${res.status}: ${detail.slice(0, 300)}`);
  }
  const data = (await res.json()) as { access_token?: string; expires_in?: number };
  if (!data.access_token) throw new Error("Google OAuth: access_token missing");
  return data.access_token;
}

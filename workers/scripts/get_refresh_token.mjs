// Run once locally to obtain a Google OAuth refresh_token. Register the result with
// `wrangler secret put GOOGLE_REFRESH_TOKEN`.
//
// Prerequisites (Google Cloud Console):
//   1. Create a new project.
//   2. Enable the Gmail API.
//   3. Configure OAuth consent screen (Testing mode is fine). Add your Gmail as a test user.
//   4. Credentials → Create OAuth client ID (type: Desktop App).
//      Note client_id / client_secret.
//
// Run:
//   GOOGLE_CLIENT_ID=xxx GOOGLE_CLIENT_SECRET=yyy node scripts/get_refresh_token.mjs
//   → Open the URL in a browser → consent → the local server captures the code →
//     refresh_token is printed.

import { createServer } from "node:http";

const CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const REDIRECT = "http://localhost:53682/oauth2callback";
const SCOPE = "https://www.googleapis.com/auth/gmail.modify";

if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error("Please set GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET before running.");
  process.exit(1);
}

const authUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
authUrl.searchParams.set("client_id", CLIENT_ID);
authUrl.searchParams.set("redirect_uri", REDIRECT);
authUrl.searchParams.set("response_type", "code");
authUrl.searchParams.set("scope", SCOPE);
authUrl.searchParams.set("access_type", "offline");
authUrl.searchParams.set("prompt", "consent");

console.log("\n=== Authorization steps ===");
console.log("1. Open this URL in your browser and approve:");
console.log("   " + authUrl.toString());
console.log("2. The local server will receive the code and print refresh_token.\n");
console.log("Local server: http://localhost:53682\n");

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", "http://localhost:53682");
  if (url.pathname !== "/oauth2callback") {
    res.writeHead(404);
    res.end();
    return;
  }
  const code = url.searchParams.get("code");
  if (!code) {
    res.writeHead(400);
    res.end("missing code");
    return;
  }
  res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  res.end("<h1>Authorized</h1><p>Return to the terminal.</p>");

  const body = new URLSearchParams({
    code,
    client_id: CLIENT_ID,
    client_secret: CLIENT_SECRET,
    redirect_uri: REDIRECT,
    grant_type: "authorization_code",
  });
  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });
  const data = await tokenRes.json();
  if (!tokenRes.ok) {
    console.error("\nToken exchange failed:", data);
    process.exit(1);
  }
  console.log("\n=== refresh_token obtained ===");
  console.log("\nrefresh_token:");
  console.log(data.refresh_token);
  console.log("\nNext: register secrets with wrangler:");
  console.log(`  cd workers && wrangler secret put GOOGLE_REFRESH_TOKEN`);
  console.log("  (paste the refresh_token at the prompt)");
  console.log("\nAlso:");
  console.log(`  wrangler secret put GOOGLE_CLIENT_ID`);
  console.log(`  wrangler secret put GOOGLE_CLIENT_SECRET`);
  console.log(`  wrangler secret put ANTHROPIC_API_KEY`);
  server.close();
});

server.listen(53682);

// Lightweight local stand-in for `netlify dev`'s function runtime, used only
// for local development against a local Postgres instance. Netlify itself
// runs each netlify/functions/*.mjs file directly in production, routed by
// its own `config.path` — this script just adapts Node's http server to the
// same Fetch Request/Response contract so the exact same handler code can be
// exercised without the full Netlify CLI (whose Edge Functions bootstrap
// needs network access this shim skips).
import { createServer } from "node:http";
import groupsHandler from "../netlify/functions/groups.mjs";
import feedbackHandler from "../netlify/functions/feedback.mjs";

const port = process.env.FUNCTIONS_PORT || 9000;

function routeFor(pathname) {
  if (pathname === "/api/feedback" || pathname.startsWith("/api/feedback/")) return feedbackHandler;
  if (pathname === "/api/groups" || pathname.startsWith("/api/groups/")) return groupsHandler;
  return null;
}

const server = createServer(async (req, res) => {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const body = chunks.length ? Buffer.concat(chunks) : undefined;

  const url = `http://localhost:${port}${req.url}`;
  const handler = routeFor(new URL(url).pathname);
  if (!handler) {
    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "not_found" }));
    return;
  }

  const request = new Request(url, {
    method: req.method,
    headers: req.headers,
    body: req.method === "GET" || req.method === "HEAD" ? undefined : body,
  });

  try {
    const response = await handler(request);
    const text = await response.text();
    res.writeHead(response.status, Object.fromEntries(response.headers.entries()));
    res.end(text);
  } catch (err) {
    console.error(err);
    res.writeHead(500, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "server_error" }));
  }
});

server.listen(port, () => {
  console.log(`Local functions shim listening on http://localhost:${port}`);
});

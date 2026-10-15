"use strict";
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname);
const port = Number(process.env.PORT) || 4173;
const types = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".mp3": "audio/mpeg",
  ".mp4": "video/mp4"
};

http.createServer(function (request, response) {
  if (request.method !== "GET" && request.method !== "HEAD") {
    response.writeHead(405, { "Content-Type": "text/plain; charset=utf-8", "Allow": "GET, HEAD" });
    response.end("Method not allowed");
    return;
  }
  let pathname;
  try { pathname = decodeURIComponent(new URL(request.url, "http://localhost").pathname); }
  catch (_) { response.writeHead(400); response.end("Bad request"); return; }
  const target = path.resolve(root, "." + pathname);
  if (target !== root && !target.startsWith(root + path.sep)) {
    response.writeHead(403); response.end("Forbidden"); return;
  }
  const file = pathname.endsWith("/") || !path.extname(target) ? path.join(target, "index.html") : target;
  fs.stat(file, function (error, stat) {
    if (error || !stat.isFile()) { response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" }); response.end("Not found"); return; }
    response.writeHead(200, {
      "Content-Type": types[path.extname(file).toLowerCase()] || "application/octet-stream",
      "Content-Length": stat.size,
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff"
    });
    if (request.method === "HEAD") { response.end(); return; }
    fs.createReadStream(file).pipe(response);
  });
}).listen(port, "127.0.0.1", function () {
  process.stdout.write("ECHO//VOID local server listening at http://localhost:" + port + "\n");
});

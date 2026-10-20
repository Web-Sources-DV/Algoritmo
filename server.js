/* Servidor estático de desarrollo. No expone CSV, .git ni archivos del entorno. */
"use strict";
const http = require("node:http");
const fs = require("node:fs/promises");
const path = require("node:path");
const allowed = new Map([
  ["/", "index.html"],
  ["/index.html", "index.html"],
  ["/styles.css", "styles.css"],
  ["/js/core.js", "js/core.js"],
  ["/js/app.js", "js/app.js"],
]);
const types = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
};
const port = Number(process.env.PORT || 8080);
http
  .createServer(async (req, res) => {
    const url = new URL(req.url, "http://localhost"),
      file = allowed.get(url.pathname);
    if (!file || !["GET", "HEAD"].includes(req.method)) {
      res.writeHead(404);
      res.end("Not found");
      return;
    }
    try {
      const body = await fs.readFile(path.join(__dirname, file));
      res.writeHead(200, {
        "Content-Type": types[path.extname(file)],
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "no-cache",
      });
      res.end(req.method === "HEAD" ? undefined : body);
    } catch {
      res.writeHead(500);
      res.end("Cannot read application file");
    }
  })
  .listen(port, "0.0.0.0", () =>
    console.log(
      `ValueBet: servidor listo en puerto ${port}. Abrir index.html directamente también funciona.`,
    ),
  );

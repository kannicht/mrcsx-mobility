import { createServer } from "node:https";
import { readFileSync } from "node:fs";

const jwks = readFileSync("/fixture/jwks.json");

const server = createServer({
  key: readFileSync("/fixture/server.key"),
  cert: readFileSync("/fixture/server.crt"),
  minVersion: "TLSv1.2",
}, (req, res) => {
  if (
    req.method === "GET" &&
    req.url === "/.well-known/jwks.json"
  ) {
    res.writeHead(200, {
      "Content-Type": "application/json",
    });

    res.end(jwks);
    return;
  }

  res.writeHead(404);
  res.end();
});

server.listen(3443, "0.0.0.0", () => {
  console.log("Test JWKS server ready");
});

process.once("SIGTERM", () => server.close());

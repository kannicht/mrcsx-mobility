import { createServer } from "node:https";
import { readFileSync } from "node:fs";

const jwks = readFileSync("/fixture/jwks.json");

let geocodeRequests = 0;

const places = [
  {
    type: "STOP",
    id: "fixture-stop-1",
    name: "Braunschweig Hauptbahnhof",
    lat: 52.253967,
    lon: 10.538819,
    country: "DE",
    zip: "38102",
    tz: "Europe/Berlin",
    areas: [
      {
        name: "Niedersachsen",
        adminLevel: 4,
      },
      {
        name: "Braunschweig",
        adminLevel: 6,
        default: true,
      },
    ],
    modes: [
      "HIGHSPEED_RAIL",
      "LONG_DISTANCE",
      "REGIONAL_RAIL",
      "TRAM",
      "BUS",
    ],
  },
  {
    type: "PLACE",
    id: "fixture-place-1",
    name: "Braunschweig Hauptbahnhof",
    lat: 52.2530358,
    lon: 10.5400307,
    country: "DE",
  },
];

function sendJson(res, status, body) {
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
  });

  res.end(JSON.stringify(body));
}

const server = createServer({
  key: readFileSync("/fixture/server.key"),
  cert: readFileSync("/fixture/server.crt"),
  minVersion: "TLSv1.2",
}, (req, res) => {
  const url = new URL(
    req.url ?? "/",
    "https://oauth-fixture:3443",
  );

  if (req.method !== "GET") {
    res.writeHead(405);
    res.end();
    return;
  }

  if (url.pathname === "/.well-known/jwks.json") {
    res.writeHead(200, {
      "Content-Type": "application/json",
    });

    res.end(jwks);
    return;
  }

  if (url.pathname === "/fixture/stats") {
    sendJson(res, 200, { geocodeRequests });
    return;
  }

  if (url.pathname === "/api/v1/geocode") {
    geocodeRequests++;

    if (
      req.headers.authorization !== undefined ||
      req.headers.cookie !== undefined
    ) {
      sendJson(res, 400, {
        error: "Unexpected credentials",
      });
      return;
    }

    if (
      req.headers["user-agent"] !==
      "mrcsx-mobility-docker-test/0.3.0"
    ) {
      sendJson(res, 400, {
        error: "Unexpected user agent",
      });
      return;
    }

    const query = url.searchParams.get("text");

    if (query === "Provider failure") {
      sendJson(res, 503, {
        error: "Simulated service failure",
      });
      return;
    }

    if (query === "Braunschweig Hauptbahnhof") {
      sendJson(res, 200, places);
      return;
    }

    sendJson(res, 200, []);
    return;
  }

  res.writeHead(404);
  res.end();
});

server.listen(3443, "0.0.0.0", () => {
  console.log("Test OAuth and Transitous server ready");
});

process.once("SIGTERM", () => server.close());

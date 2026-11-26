import { writeFile } from "node:fs/promises";
import { join } from "node:path";

import { createOAuthFixture } from "../helpers/oauth.ts";

const directory = process.argv[2];

if (!directory) {
  throw new Error("Missing fixture directory");
}

const fixture = await createOAuthFixture();

const issuer = "https://oauth-fixture:3443";

const token = await fixture.sign({
  iss: issuer,
  exp: Math.floor(Date.now() / 1000) + 600,
});

const invalidScopeToken = await fixture.sign({
  iss: issuer,
  scope: "openid",
  exp: Math.floor(Date.now() / 1000) + 600,
});

await writeFile(
  join(directory, "jwks.json"),
  JSON.stringify(fixture.jwks),
  { mode: 0o644 },
);

await writeFile(
  join(directory, "token"),
  token,
  { mode: 0o600 },
);

await writeFile(
  join(directory, "invalid-scope-token"),
  invalidScopeToken,
  { mode: 0o600 },
);

console.log("OAuth test fixture generated");

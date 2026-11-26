import assert from "node:assert/strict";
import { test } from "node:test";

import {
  createHttpServer,
} from "../src/http-server.ts";

import {
  RESOURCE_METADATA_PATH,
} from "../src/auth/metadata.ts";

import {
  createOAuthFixture,
} from "./helpers/oauth.ts";

test("HTTP authentication enforcement", async (t) => {
  const fixture = await createOAuthFixture();

  const { server, close } = createHttpServer(
    fixture.authConfig,
    fixture.verifyToken,
  );

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });

  const address = server.address();

  assert.ok(address && typeof address !== "string");

  const baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    await t.test("Health remains public", async () => {
      const response = await fetch(`${baseUrl}/health`);

      assert.equal(response.status, 200);
    });

    await t.test("OAuth metadata remains public", async () => {
      const response = await fetch(
        `${baseUrl}${RESOURCE_METADATA_PATH}`,
      );

      assert.equal(response.status, 200);

      assert.deepEqual(await response.json(), {
        resource: fixture.authConfig.resource,
        authorization_servers: [
          fixture.authConfig.issuer,
        ],
        scopes_supported: ["mobility:read"],
        bearer_methods_supported: ["header"],
        resource_name: "mrcsx Mobility",
      });
    });

    for (const method of ["GET", "POST", "DELETE"]) {
      await t.test(`${method} requires authentication`, async () => {
        const response = await fetch(`${baseUrl}/mcp`, {
          method,
        });

        assert.equal(response.status, 401);

        const challenge =
          response.headers.get("www-authenticate");

        assert.ok(challenge?.startsWith("Bearer "));
        assert.ok(challenge?.includes("resource_metadata="));
        assert.ok(challenge?.includes('scope="mobility:read"'));
        assert.ok(!challenge?.includes("error="));
      });
    }

    await t.test("Invalid token returns 401", async () => {
      const response = await fetch(`${baseUrl}/mcp`, {
        method: "POST",
        headers: {
          Authorization: "Bearer invalid.token.value",
        },
      });

      assert.equal(response.status, 401);

      assert.ok(
        response.headers.get("www-authenticate")
          ?.includes('error="invalid_token"'),
      );
    });

    await t.test("Missing scope returns 403", async () => {
      const token = await fixture.sign({
        scope: "openid",
      });

      const response = await fetch(`${baseUrl}/mcp`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      assert.equal(response.status, 403);

      assert.ok(
        response.headers.get("www-authenticate")
          ?.includes('error="insufficient_scope"'),
      );
    });

    await t.test("Unauthorized user returns 403", async () => {
      const token = await fixture.sign({
        sub: "unauthorized-user",
      });

      const response = await fetch(`${baseUrl}/mcp`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      assert.equal(response.status, 403);
    });

    await t.test("Unauthorized client returns 403", async () => {
      const token = await fixture.sign({
        client_id: "unauthorized-client",
      });

      const response = await fetch(`${baseUrl}/mcp`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      assert.equal(response.status, 403);
    });

    await t.test("Foreign origin rejected", async () => {
      const token = await fixture.sign();

      const response = await fetch(`${baseUrl}/mcp`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          Origin: "https://foreign.example.test",
        },
      });

      assert.ok(response.status >= 400);
    });
  } finally {
    await close();
  }
});

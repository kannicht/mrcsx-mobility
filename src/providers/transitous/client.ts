import { ProviderError } from "../errors.ts";

import type {
  TransitousConfig,
} from "./config.ts";

import {
  transitousGeocodeResponseSchema,
} from "./schemas.ts";

import type {
  TransitousPlace,
} from "./schemas.ts";

async function readBoundedJson(
  response: Response,
  maxBytes: number,
): Promise<unknown> {
  const declaredLength =
    response.headers.get("content-length");

  if (
    declaredLength !== null &&
    Number(declaredLength) > maxBytes
  ) {
    await response.body?.cancel();

    throw new ProviderError(
      "INVALID_RESPONSE",
      "Transitous response exceeds size limit",
    );
  }

  if (!response.body) {
    throw new ProviderError(
      "INVALID_RESPONSE",
      "Transitous returned an empty response body",
    );
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8", {
    fatal: true,
  });

  let bytes = 0;
  let text = "";

  try {
    while (true) {
      const { done, value } = await reader.read();

      if (done) {
        break;
      }

      bytes += value.byteLength;

      if (bytes > maxBytes) {
        throw new ProviderError(
          "INVALID_RESPONSE",
          "Transitous response exceeds size limit",
        );
      }

      try {
        text += decoder.decode(value, {
          stream: true,
        });
      } catch {
        throw new ProviderError(
          "INVALID_RESPONSE",
          "Transitous returned invalid UTF-8",
        );
      }
    }

    try {
      text += decoder.decode();
      return JSON.parse(text);
    } catch {
      throw new ProviderError(
        "INVALID_RESPONSE",
        "Transitous returned invalid JSON",
      );
    }
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}

function mapHttpError(status: number): ProviderError {
  if (status === 429) {
    return new ProviderError(
      "RATE_LIMITED",
      "Transitous rate limit reached",
      true,
    );
  }

  if (status >= 500) {
    return new ProviderError(
      "UNAVAILABLE",
      "Transitous is temporarily unavailable",
      true,
    );
  }

  return new ProviderError(
    "REQUEST_REJECTED",
    "Transitous rejected the request",
  );
}

export class TransitousClient {
  readonly #config: TransitousConfig;
  readonly #fetch: typeof fetch;

  constructor(
    config: TransitousConfig,
    fetchImplementation: typeof fetch = fetch,
  ) {
    this.#config = config;
    this.#fetch = fetchImplementation;
  }

  async geocode(
    query: string,
  ): Promise<TransitousPlace[]> {
    const url = new URL(
      "/api/v1/geocode",
      this.#config.baseUrl,
    );

    url.searchParams.set("text", query);

    const signal = AbortSignal.timeout(
      this.#config.timeoutMs,
    );

    try {
      const response = await this.#fetch(url, {
        method: "GET",
        redirect: "error",
        credentials: "omit",
        signal,

        headers: {
          Accept: "application/json",
          "User-Agent": this.#config.userAgent,
        },
      });

      if (!response.ok) {
        await response.body?.cancel();
        throw mapHttpError(response.status);
      }

      const contentType =
        response.headers.get("content-type")
          ?.split(";")[0]
          ?.trim()
          .toLowerCase();

      if (contentType !== "application/json") {
        await response.body?.cancel();

        throw new ProviderError(
          "INVALID_RESPONSE",
          "Transitous returned an unexpected content type",
        );
      }

      const body = await readBoundedJson(
        response,
        this.#config.maxResponseBytes,
      );

      const result =
        transitousGeocodeResponseSchema.safeParse(body);

      if (!result.success) {
        throw new ProviderError(
          "INVALID_RESPONSE",
          "Transitous response schema validation failed",
        );
      }

      return result.data;
    } catch (error) {
      if (error instanceof ProviderError) {
        throw error;
      }

      if (signal.aborted) {
        throw new ProviderError(
          "TIMEOUT",
          "Transitous request timed out",
          true,
        );
      }

      throw new ProviderError(
        "NETWORK_ERROR",
        "Transitous could not be reached",
        true,
      );
    }
  }
}

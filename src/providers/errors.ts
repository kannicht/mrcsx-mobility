export type ProviderErrorCode =
  | "TIMEOUT"
  | "NETWORK_ERROR"
  | "RATE_LIMITED"
  | "BUSY"
  | "UNAVAILABLE"
  | "INVALID_RESPONSE"
  | "REQUEST_REJECTED";

export class ProviderError extends Error {
  readonly code: ProviderErrorCode;
  readonly retryable: boolean;

  constructor(
    code: ProviderErrorCode,
    message: string,
    retryable = false,
  ) {
    super(message);

    this.name = "ProviderError";
    this.code = code;
    this.retryable = retryable;
  }
}

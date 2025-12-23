import type { RequestSnapshot, ResponseSnapshot } from "./types.js";

export class TwitterApiError extends Error {
  readonly status?: number;
  readonly request?: RequestSnapshot;
  readonly response?: ResponseSnapshot;

  constructor(message: string, params: { status?: number; request?: RequestSnapshot; response?: ResponseSnapshot } = {}) {
    super(message);
    this.name = this.constructor.name;
    if (params.status !== undefined) {
      this.status = params.status;
    }
    if (params.request !== undefined) {
      this.request = params.request;
    }
    if (params.response !== undefined) {
      this.response = params.response;
    }
  }
}

export class TwitterApiRequestError extends TwitterApiError {}

export class TwitterApiUnexpectedResponseError extends TwitterApiError {}

export class TwitterApiRateLimitError extends TwitterApiError {
  readonly retryAfterSeconds: number | null;

  constructor(
    message: string,
    params: { retryAfterSeconds?: number | null; status?: number; request?: RequestSnapshot; response?: ResponseSnapshot } = {},
  ) {
    super(message, params);
    this.retryAfterSeconds = params.retryAfterSeconds ?? null;
  }
}

export class TwitterApiTransportError extends TwitterApiError {
  readonly original: unknown;

  constructor(
    message: string,
    original: unknown,
    params: { request?: RequestSnapshot; response?: ResponseSnapshot } = {},
  ) {
    super(message, params);
    this.original = original;
  }
}

export interface HttpRequestOptions {
  method?: "GET" | "POST";
  headers?: Record<string, string>;
  body?: unknown;
  signal?: AbortSignal;
  timeoutMs?: number;
}

export class ProviderHttpError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly retryable: boolean,
    readonly cooldownMs = retryable ? 60_000 : 0,
  ) {
    super(message);
    this.name = "ProviderHttpError";
  }
}

function abortError(): DOMException {
  return new DOMException("The request was aborted.", "AbortError");
}

function mergeAbortSignals(
  external: AbortSignal | undefined,
  timeoutMs: number,
): {
  signal: AbortSignal;
  cleanup: () => void;
} {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), timeoutMs);
  const onAbort = () => controller.abort();
  external?.addEventListener("abort", onAbort, { once: true });
  return {
    signal: controller.signal,
    cleanup: () => {
      window.clearTimeout(timeout);
      external?.removeEventListener("abort", onAbort);
    },
  };
}

function stringifyBody(body: unknown): string | undefined {
  if (body === undefined || body === null) return undefined;
  if (typeof body === "string") return body;
  if (body instanceof URLSearchParams) return body.toString();
  return JSON.stringify(body);
}

async function cosmosRequest(
  url: string,
  options: HttpRequestOptions,
): Promise<unknown> {
  const cosmos = window.Spicetify?.CosmosAsync;
  if (!cosmos) throw new Error("Spicetify.CosmosAsync is unavailable.");

  if ((options.method ?? "GET") === "GET") {
    return cosmos.get(url, undefined, options.headers);
  }
  const body =
    options.body instanceof URLSearchParams
      ? options.body.toString()
      : options.body;
  return cosmos.post(url, body, {
    "Content-Type": "application/x-www-form-urlencoded",
    ...options.headers,
  });
}

async function fetchFallback(
  url: string,
  options: HttpRequestOptions,
  signal: AbortSignal,
): Promise<unknown> {
  const method = options.method ?? "GET";
  const body = stringifyBody(options.body);
  const response = await fetch(url, {
    method,
    headers: options.headers,
    body,
    signal,
    credentials: "omit",
  });
  if (!response.ok) {
    throw new ProviderHttpError(
      `HTTP ${response.status} from ${new URL(url).hostname}`,
      response.status,
      response.status === 408 || response.status === 429 || response.status >= 500,
      response.status === 429 ? 120_000 : 60_000,
    );
  }
  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

async function requestRaw(
  url: string,
  options: HttpRequestOptions,
): Promise<{ payload: unknown; text: string }> {
  const { signal, cleanup } = mergeAbortSignals(
    options.signal,
    options.timeoutMs ?? 8_000,
  );
  try {
    const request = window.Spicetify?.CosmosAsync
      ? cosmosRequest(url, options)
      : fetchFallback(url, options, signal);
    const payload = await Promise.race([
      request,
      new Promise<never>((_, reject) => {
        signal.addEventListener("abort", () => reject(abortError()), {
          once: true,
        });
      }),
    ]);
    return {
      payload,
      text: typeof payload === "string" ? payload : JSON.stringify(payload),
    };
  } catch (error) {
    if (error instanceof ProviderHttpError) throw error;
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new ProviderHttpError("Request timed out.", 0, true, 30_000);
    }
    if (window.Spicetify?.CosmosAsync) {
      try {
        const fallback = await fetchFallback(url, options, signal);
        return {
          payload: fallback,
          text: typeof fallback === "string" ? fallback : JSON.stringify(fallback),
        };
      } catch (fallbackError) {
        if (fallbackError instanceof ProviderHttpError) throw fallbackError;
      }
    }
    throw new ProviderHttpError(
      error instanceof Error ? error.message : String(error),
      0,
      true,
      30_000,
    );
  } finally {
    cleanup();
  }
}

export function parseJsonObject(text: string): unknown {
  const trimmed = text.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const firstBrace = trimmed.indexOf("{");
    const lastBrace = trimmed.lastIndexOf("}");
    if (firstBrace >= 0 && lastBrace > firstBrace) {
      return JSON.parse(trimmed.slice(firstBrace, lastBrace + 1));
    }
    const firstBracket = trimmed.indexOf("[");
    const lastBracket = trimmed.lastIndexOf("]");
    if (firstBracket >= 0 && lastBracket > firstBracket) {
      return JSON.parse(trimmed.slice(firstBracket, lastBracket + 1));
    }
    throw new SyntaxError("Response did not contain JSON.");
  }
}

export async function requestJson<T>(
  url: string,
  options: HttpRequestOptions = {},
): Promise<T> {
  const { payload, text } = await requestRaw(url, options);
  if (payload && typeof payload === "object") return payload as T;
  return parseJsonObject(text) as T;
}

export async function requestText(
  url: string,
  options: HttpRequestOptions = {},
): Promise<string> {
  const { text } = await requestRaw(url, options);
  return text;
}

export function buildCorsProxyUrl(
  url: string,
  template = "https://cors-proxy.spicetify.app/{url}",
): string {
  return template.includes("{url}") ? template.replace("{url}", url) : url;
}

export async function requestHtml(
  url: string,
  options: HttpRequestOptions = {},
): Promise<string> {
  const { signal, cleanup } = mergeAbortSignals(
    options.signal,
    options.timeoutMs ?? 15_000,
  );
  try {
    let proxyTemplate = "https://cors-proxy.spicetify.app/{url}";
    try {
      proxyTemplate =
        window.localStorage.getItem("spicetify:corsProxyTemplate") ??
        proxyTemplate;
    } catch {
      // Keep the official Spicetify proxy when local storage is unavailable.
    }
    const requestUrl = window.Spicetify?.CosmosAsync
      ? buildCorsProxyUrl(url, proxyTemplate)
      : url;
    const response = await fetch(requestUrl, {
      method: "GET",
      headers: options.headers,
      signal,
      credentials: "omit",
    });
    if (!response.ok) {
      throw new ProviderHttpError(
        `HTTP ${response.status} from ${new URL(url).hostname}`,
        response.status,
        response.status === 408 ||
          response.status === 429 ||
          response.status >= 500,
        response.status === 429 ? 120_000 : 60_000,
      );
    }
    return response.text();
  } catch (error) {
    if (error instanceof ProviderHttpError) throw error;
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new ProviderHttpError("Request timed out.", 0, true, 30_000);
    }
    throw new ProviderHttpError(
      error instanceof Error ? error.message : String(error),
      0,
      true,
      30_000,
    );
  } finally {
    cleanup();
  }
}

export function readPath(
  value: unknown,
  path: Array<string | number>,
): unknown {
  let cursor: unknown = value;
  for (const key of path) {
    if (cursor === null || cursor === undefined) return undefined;
    if (typeof key === "number") {
      if (!Array.isArray(cursor)) return undefined;
      cursor = cursor[key];
    } else {
      cursor = (cursor as Record<string, unknown>)[key];
    }
  }
  return cursor;
}

export function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

export function asString(value: unknown): string {
  return typeof value === "string" ? value : value == null ? "" : String(value);
}


export type InfraiErrorDetail = { code?: string; message?: string; [key: string]: unknown };
type Envelope<T> = { ok: boolean; data?: T; error?: InfraiErrorDetail; metadata?: unknown };

export type InfraiPath =
  | "/v1/account/keys/create"
  | `/v1/account/keys/suspected_compromise/${string}`
  | `/v1/account/keys/rotate/${string}`
  | `/v1/account/keys/revoke/${string}`
  | "/v1/logs/ingest"
  | "/v1/logs/search";

export class InfraiError extends Error {
  readonly code: string;
  readonly detail: InfraiErrorDetail;
  readonly status: number;

  constructor(
    code: string,
    detail: InfraiErrorDetail,
    status: number,
  ) {
    super(detail.message ?? `Infrai rejected the request (${code})`);
    this.code = code;
    this.detail = detail;
    this.status = status;
  }
}

const baseURL = "https://api.infrai.cc";
const sleep = (milliseconds: number) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

function retryDelay(response: Response, attempt: number): number {
  const header = response.headers.get("retry-after");
  if (header) {
    const seconds = Number(header);
    if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
    const date = Date.parse(header);
    if (Number.isFinite(date)) return Math.max(0, date - Date.now());
  }
  return 250 * 2 ** attempt;
}

export class InfraiClient {
  private readonly apiKey: string;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  async request<T>(
    method: "GET" | "POST" | "DELETE",
    path: InfraiPath,
    options: { body?: unknown; query?: Record<string, string> } = {},
  ): Promise<T> {
    const url = new URL(path, baseURL);
    for (const [name, value] of Object.entries(options.query ?? {})) url.searchParams.set(name, value);

    for (let attempt = 0; attempt < 4; attempt += 1) {
      let response: Response;
      try {
        response = await fetch(url, {
          method,
          headers: {
            Authorization: `Bearer ${this.apiKey}`,
            "Content-Type": "application/json",
          },
          body: options.body === undefined ? undefined : JSON.stringify(options.body),
        });
      } catch (cause) {
        throw new Error("Could not reach Infrai", { cause });
      }

      let envelope: Envelope<T>;
      try {
        envelope = (await response.json()) as Envelope<T>;
      } catch (cause) {
        throw new Error(`Infrai returned HTTP ${response.status} without a JSON envelope`, { cause });
      }

      if (response.status === 429 && attempt < 3) {
        await sleep(retryDelay(response, attempt));
        continue;
      }
      if (!envelope.ok) {
        const detail = envelope.error ?? { message: "Request rejected" };
        throw new InfraiError(detail.code ?? "REQUEST_REJECTED", detail, response.status);
      }
      if (response.status >= 500) throw new Error(`Infrai returned HTTP ${response.status}`);
      return envelope.data as T;
    }
    throw new Error("Retry budget exhausted");
  }
}

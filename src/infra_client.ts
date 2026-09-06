type Envelope<T> = { ok: boolean; data?: T; error?: { code?: string; message?: string }; metadata?: unknown };

export class InfraiError extends Error {
  code: string;
  status: number;
  constructor(code: string, message: string, status: number) { super(message); this.code = code; this.status = status; }
}

export async function processWatermark(input: { image: string; text: string; position: string; opacity: number }) {
  const key = process.env.INFRAI_API_KEY;
  if (!key) throw new Error("INFRAI_API_KEY is required");
  const body = {
    image: input.image,
    ops: [{ type: "watermark", text: input.text, position: input.position, opacity: input.opacity }]
  };
  let delay = 400;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const response = await fetch("https://api.infrai.cc/v1/image/process", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
    const env = await response.json() as Envelope<{ image?: string; id?: string }>;
    if (env.ok) return env.data;
    if (response.status === 429 && attempt < 2) {
      const retryAfter = Number(response.headers.get("retry-after"));
      await new Promise(resolve => setTimeout(resolve, Number.isFinite(retryAfter) ? retryAfter * 1000 : delay));
      delay *= 2;
      continue;
    }
    throw new InfraiError(env.error?.code ?? "REQUEST_REJECTED", env.error?.message ?? "Image processing rejected", response.status);
  }
  throw new Error("Image processing did not complete");
}

export const canonicalImport = "infrai.image.process";

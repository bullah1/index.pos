import { createOpenAI } from "@ai-sdk/openai";
import { streamText, type ModelMessage } from "ai";
import { createLovableAiGatewayRunIdFetch } from "./run-id.ts";

const GATEWAY = "https://ai.gateway.lovable.dev/v1";
const MODEL = "openai/gpt-6-astra";

export class GatewayError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

/** Streams the model call server-side and returns the final text. */
export async function askModel(apiKey: string, instructions: string, messages: ModelMessage[]) {
  const runIdFetch = createLovableAiGatewayRunIdFetch(undefined);
  let failure: { status: number; message: string } | null = null;
  const fetchWithStatus = async (input: RequestInfo | URL, init?: RequestInit) => {
    const res = await runIdFetch.fetch(input, init);
    if (!res.ok) {
      let message = `AI request failed (${res.status})`;
      try { const j = await res.clone().json(); message = j?.error?.message ?? j?.message ?? message; } catch { /* ignore */ }
      failure = { status: res.status, message };
    }
    return res;
  };
  const provider = createOpenAI({
    baseURL: GATEWAY,
    apiKey,
    headers: { "Lovable-API-Key": apiKey, "X-Lovable-AIG-SDK": "vercel-ai-sdk" },
    fetch: fetchWithStatus,
  });
  const result = streamText({
    model: provider.responses(MODEL),
    instructions,
    messages,
    maxRetries: 0,
    providerOptions: {
      openai: {
        store: false,
        forceReasoning: true,
        reasoningEffort: "medium",
        reasoningSummary: "auto",
        include: ["reasoning.encrypted_content"],
      },
    },
  });
  try {
    const text = await result.text;
    if (failure) throw new GatewayError((failure as { status: number }).status, (failure as { message: string }).message);
    return text;
  } catch (e) {
    const f = failure as { status: number; message: string } | null;
    if (f) throw new GatewayError(f.status, f.message);
    throw e;
  }
}

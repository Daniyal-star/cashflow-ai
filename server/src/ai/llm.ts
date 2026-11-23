/**
 * Provider-independent LLM wrapper for the AI CFO.
 *
 * Configuration is read from environment variables only:
 *   CFO_AI_API_KEY   required; when missing or empty no provider is created
 *   CFO_AI_BASE_URL  optional; default https://api.openai.com/v1
 *   CFO_AI_MODEL     optional; default gpt-4o-mini
 *
 * The key is never logged, returned, or included in error messages.
 */

export interface LlmProvider {
  name: string;
  complete(system: string, user: string, signal: AbortSignal): Promise<string>;
}

const DEFAULT_BASE_URL = "https://api.openai.com/v1";
const DEFAULT_MODEL = "gpt-4o-mini";

interface OpenAiCompatibleConfig {
  apiKey: string;
  baseUrl: string;
  model: string;
}

function createOpenAiCompatibleProvider(config: OpenAiCompatibleConfig): LlmProvider {
  return {
    name: `openai-compatible:${config.model}`,
    async complete(system: string, user: string, signal: AbortSignal): Promise<string> {
      const response = await fetch(`${config.baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${config.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: config.model,
          temperature: 0,
          response_format: { type: "json_object" },
          messages: [
            { role: "system", content: system },
            { role: "user", content: user },
          ],
        }),
        signal,
      });
      if (!response.ok) {
        // Status code only: the response body and the key must never reach the error text.
        throw new Error(`LLM provider responded with HTTP ${response.status}`);
      }
      const data = (await response.json()) as { choices?: Array<{ message?: { content?: unknown } }> };
      const content = data.choices?.[0]?.message?.content;
      if (typeof content !== "string") {
        throw new Error("LLM provider returned no message content");
      }
      return content;
    },
  };
}

/** Returns null unless CFO_AI_API_KEY is set to a non-empty value. */
export function createProviderFromEnv(env: NodeJS.ProcessEnv): LlmProvider | null {
  const apiKey = env.CFO_AI_API_KEY?.trim() ?? "";
  if (apiKey === "") return null;
  const baseUrl = (env.CFO_AI_BASE_URL?.trim() || DEFAULT_BASE_URL).replace(/\/+$/, "");
  const model = env.CFO_AI_MODEL?.trim() || DEFAULT_MODEL;
  return createOpenAiCompatibleProvider({ apiKey, baseUrl, model });
}

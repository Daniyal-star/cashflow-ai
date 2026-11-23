
/**
 * Provider-independent LLM wrapper for the AI CFO.
 *
 * Supports OpenAI-compatible APIs, including Gemini.
 * Automatically retries temporary provider failures.
 * API keys are never logged or exposed in errors.
 */

export interface LlmProvider {
  name: string;
  complete(system: string, user: string, signal: AbortSignal): Promise<string>;
}

const DEFAULT_BASE_URL = "https://api.openai.com/v1";
const DEFAULT_MODEL = "gpt-4o-mini";
const MAX_RETRIES = 2;

interface OpenAiCompatibleConfig {
  apiKey: string;
  baseUrl: string;
  model: string;
}

function wait(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new Error("LLM request aborted"));
      return;
    }

    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);

    const onAbort = () => {
      clearTimeout(timer);
      reject(new Error("LLM request aborted"));
    };

    signal.addEventListener("abort", onAbort, { once: true });
  });
}

function createOpenAiCompatibleProvider(
  config: OpenAiCompatibleConfig
): LlmProvider {
  return {
    name: `openai-compatible:${config.model}`,

    async complete(
      system: string,
      user: string,
      signal: AbortSignal
    ): Promise<string> {

      for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
        if (signal.aborted) {
          throw new Error("LLM request aborted");
        }

        let response: Response;

        try {
          response = await fetch(
            `${config.baseUrl}/chat/completions`,
            {
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
            }
          );
        } catch (error) {
          if (signal.aborted) {
            throw new Error("LLM request aborted or timed out");
          }
          throw error;
        }

        if (response.ok) {
          const data = (await response.json()) as {
            choices?: Array<{
              message?: { content?: unknown };
            }>;
          };

          const content = data.choices?.[0]?.message?.content;

          if (typeof content !== "string") {
            throw new Error("LLM provider returned no message content");
          }

          return content;
        }

        const status = response.status;

        // Retry temporary server-side failures only.
        const retryable = [500, 502, 503, 504].includes(status);

        if (!retryable || attempt === MAX_RETRIES) {
          throw new Error(
            `LLM provider responded with HTTP ${status}`
          );
        }

        const delay = attempt === 0 ? 1000 : 2500;

        console.warn(
          `[AI CFO] Provider returned HTTP ${status}. Retrying in ${delay}ms (attempt ${attempt + 1}/${MAX_RETRIES}).`
        );

        await wait(delay, signal);
      }

      throw new Error("LLM provider failed after retries");
    },
  };
}

/** Returns null unless CFO_AI_API_KEY is configured. */
export function createProviderFromEnv(
  env: NodeJS.ProcessEnv
): LlmProvider | null {
  const apiKey = env.CFO_AI_API_KEY?.trim() ?? "";

  if (apiKey === "") {
    return null;
  }

  const baseUrl = (
    env.CFO_AI_BASE_URL?.trim() || DEFAULT_BASE_URL
  ).replace(/\/+$/, "");

  const model = env.CFO_AI_MODEL?.trim() || DEFAULT_MODEL;

  return createOpenAiCompatibleProvider({
    apiKey,
    baseUrl,
    model,
  });
}

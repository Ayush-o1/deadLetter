// A live model provider that speaks the widely supported "chat completions" HTTP
// format, so it works with hosted services and local servers alike.
//
// Never needed by the test suite or the evaluation. The API key is only ever sent
// in the Authorization header; it is not logged and never appears in an error.
import { plannerSystemPrompt, quarantineSystemPrompt, quarantineUserMessage } from '../prompts.js';

export class ProviderError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ProviderError';
  }
}

/** Parse a model reply that should be JSON, tolerating a ```json fence. */
export function parseJsonReply(text) {
  const unfenced = text
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '');
  try {
    return JSON.parse(unfenced);
  } catch {
    throw new ProviderError('The model reply was not valid JSON');
  }
}

/**
 * @param {object} cfg
 * @param {string} cfg.baseUrl e.g. https://api.example.com/v1
 * @param {string} [cfg.apiKey]
 * @param {string} cfg.plannerModel
 * @param {string} [cfg.quarantineModel] defaults to the planner model
 * @param {typeof fetch} [cfg.fetchImpl] injectable for tests
 * @param {number} [cfg.timeoutMs]
 */
export function createOpenAICompatibleProviders({
  baseUrl,
  apiKey,
  plannerModel,
  quarantineModel = plannerModel,
  fetchImpl = fetch,
  timeoutMs = 30_000,
}) {
  const endpoint = `${baseUrl.replace(/\/+$/, '')}/chat/completions`;

  async function chat(model, messages) {
    let response;
    try {
      response = await fetchImpl(endpoint, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}),
        },
        body: JSON.stringify({
          model,
          messages,
          temperature: 0,
          response_format: { type: 'json_object' },
        }),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch {
      throw new ProviderError('Could not reach the model provider');
    }
    if (!response.ok)
      throw new ProviderError(`The model provider returned HTTP ${response.status}`);
    const body = await response.json().catch(() => null);
    const content = body?.choices?.[0]?.message?.content;
    if (typeof content !== 'string')
      throw new ProviderError('The model provider sent an unexpected reply');
    return parseJsonReply(content);
  }

  return {
    planner: {
      async plan({ request, tools }) {
        const reply = await chat(plannerModel, [
          { role: 'system', content: plannerSystemPrompt(tools) },
          { role: 'user', content: request },
        ]);
        if (reply?.error === 'cannot_plan') {
          const err = new ProviderError(
            String(reply.reason ?? 'The model could not plan this request').slice(0, 300),
          );
          err.code = 'cannot_plan';
          throw err;
        }
        return reply;
      },
    },
    quarantine: {
      async extract({ task, instruction, output, content }) {
        const reply = await chat(quarantineModel, [
          { role: 'system', content: quarantineSystemPrompt(output) },
          { role: 'user', content: quarantineUserMessage({ task, instruction, content }) },
        ]);
        return reply?.value;
      },
    },
  };
}

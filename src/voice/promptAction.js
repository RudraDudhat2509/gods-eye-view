/**
 * Prompt bar — the pure core.
 *
 * Turns a typed command into one GEV action the same way voice does, but
 * without OpenAI: a free open-weight model (via OpenRouter) reads the tool
 * list and replies with plain JSON naming one tool + its arguments. This
 * module builds that instruction and parses/validates the reply. It never
 * touches the network, the DOM, or the Cesium viewer — the server route
 * (vite.config.js) calls the model, and the client (gevPrompt.js) calls
 * runGevAction — which is also what keeps this file unit-testable.
 *
 * A model can hallucinate a tool name, malform the JSON, or wrap it in prose.
 * Every one of those must come back as a clean {ok:false} rather than reach
 * the live globe, so validation here is the actual safety boundary, not a
 * formality.
 */

/** Longest prompt accepted from the input box. Mirrors the other free-text caps in gevActions.js. */
export const PROMPT_MAX_LENGTH = 300;

/**
 * Build the system message: every tool's name/description/parameters, plus a
 * short instruction to reply with nothing but one JSON object. Reusing the
 * live GEV_REALTIME_TOOLS schema (vite.config.js) means this list can never
 * drift from what runGevAction actually accepts.
 * @param {Array<{name:string, description?:string, parameters?:object}>} tools
 * @returns {string}
 */
export function buildPromptSystemMessage(tools) {
  const catalog = tools.map((tool) => ({
    name: tool.name,
    description: tool.description || '',
    parameters: tool.parameters || { type: 'object', properties: {} },
  }));
  return [
    "You are GEV Prompt Control, a command parser for a Cesium geospatial app called God's Eye View.",
    'Given one typed user request, pick the single best-matching tool below and reply with EXACTLY ONE JSON object and nothing else — no prose, no markdown fences.',
    'Reply shape: {"action": "<tool name>", "args": {...}} using only the argument names that tool defines.',
    'If no tool genuinely matches the request, reply {"action": null, "reason": "<short reason>"}.',
    'Never invent a tool name or an argument name that is not listed below.',
    `Tools: ${JSON.stringify(catalog)}`,
  ].join('\n');
}

/** Find the first balanced top-level `{...}` object in free-form text. */
function extractFirstJsonObject(text) {
  const source = String(text || '');
  const start = source.indexOf('{');
  if (start === -1) return null;
  let depth = 0;
  for (let i = start; i < source.length; i += 1) {
    if (source[i] === '{') depth += 1;
    else if (source[i] === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(start, i + 1);
    }
  }
  return null;
}

/**
 * Parse and validate a model's reply against the real tool list. Returns
 * `{ok:true, action, args}` (action is null for an honest no-match), or
 * `{ok:false, error}` for anything that cannot be trusted to dispatch.
 * @param {string} rawModelText Raw chat-completion content.
 * @param {Array<{name:string}>} tools The same tool list the model was given.
 */
export function extractPromptAction(rawModelText, tools) {
  const jsonText = extractFirstJsonObject(rawModelText);
  if (!jsonText) return { ok: false, error: 'Model reply contained no JSON object' };

  let parsed;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    return { ok: false, error: 'Model reply was not valid JSON' };
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { ok: false, error: 'Model reply JSON was not an object' };
  }

  if (parsed.action === null || parsed.action === undefined) {
    return { ok: true, action: null, reason: typeof parsed.reason === 'string' ? parsed.reason : null };
  }

  if (typeof parsed.action !== 'string') {
    return { ok: false, error: 'Model reply "action" was not a string' };
  }
  const knownNames = new Set(tools.map((tool) => tool.name));
  if (!knownNames.has(parsed.action)) {
    return { ok: false, error: `Model named an unknown tool: ${parsed.action}` };
  }
  const args = parsed.args && typeof parsed.args === 'object' && !Array.isArray(parsed.args)
    ? parsed.args
    : {};
  return { ok: true, action: parsed.action, args };
}

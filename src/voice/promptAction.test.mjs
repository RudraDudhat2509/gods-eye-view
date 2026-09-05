import assert from 'node:assert/strict';
import test from 'node:test';
import { buildPromptSystemMessage, extractPromptAction, PROMPT_MAX_LENGTH } from './promptAction.js';

const TOOLS = [
  { name: 'zoom_to_globe', description: 'Zoom out to a globe view.', parameters: { type: 'object', properties: {} } },
  {
    name: 'set_layer_visibility',
    description: 'Enable or disable a data layer.',
    parameters: {
      type: 'object',
      properties: { layerId: { type: 'string' }, enabled: { type: 'boolean' } },
      required: ['layerId', 'enabled'],
    },
  },
];

test('buildPromptSystemMessage embeds every tool name and description', () => {
  const message = buildPromptSystemMessage(TOOLS);
  assert.match(message, /zoom_to_globe/);
  assert.match(message, /set_layer_visibility/);
  assert.match(message, /Enable or disable a data layer\./);
  assert.match(message, /JSON object/);
});

test('extracts a clean action + args from a well-formed reply', () => {
  const result = extractPromptAction(
    '{"action": "set_layer_visibility", "args": {"layerId": "flights", "enabled": true}}',
    TOOLS,
  );
  assert.deepEqual(result, {
    ok: true,
    action: 'set_layer_visibility',
    args: { layerId: 'flights', enabled: true },
  });
});

test('extracts JSON even when the model wraps it in prose or a markdown fence', () => {
  const result = extractPromptAction(
    'Sure! Here you go:\n```json\n{"action": "zoom_to_globe", "args": {}}\n```\nDone.',
    TOOLS,
  );
  assert.equal(result.ok, true);
  assert.equal(result.action, 'zoom_to_globe');
});

test('defaults args to {} when the model omits it', () => {
  const result = extractPromptAction('{"action": "zoom_to_globe"}', TOOLS);
  assert.deepEqual(result, { ok: true, action: 'zoom_to_globe', args: {} });
});

test('passes through an honest no-match as action:null with a reason', () => {
  const result = extractPromptAction(
    '{"action": null, "reason": "That is small talk, not a GEV command."}',
    TOOLS,
  );
  assert.deepEqual(result, {
    ok: true,
    action: null,
    reason: 'That is small talk, not a GEV command.',
  });
});

test('rejects a hallucinated tool name instead of dispatching it', () => {
  const result = extractPromptAction('{"action": "delete_the_planet", "args": {}}', TOOLS);
  assert.equal(result.ok, false);
  assert.match(result.error, /unknown tool/i);
});

test('rejects a reply with no JSON object at all', () => {
  const result = extractPromptAction('I am not sure what you mean.', TOOLS);
  assert.equal(result.ok, false);
  assert.match(result.error, /no JSON object/i);
});

test('rejects malformed JSON rather than throwing', () => {
  const result = extractPromptAction('{"action": "zoom_to_globe", "args": {}', TOOLS);
  assert.equal(result.ok, false);
});

test('rejects a JSON array or non-object payload', () => {
  assert.equal(extractPromptAction('[1, 2, 3]', TOOLS).ok, false);
});

test('rejects a non-string action', () => {
  const result = extractPromptAction('{"action": 42}', TOOLS);
  assert.equal(result.ok, false);
  assert.match(result.error, /not a string/i);
});

test('drops a non-object args instead of passing it through', () => {
  const result = extractPromptAction('{"action": "zoom_to_globe", "args": "everything"}', TOOLS);
  assert.deepEqual(result, { ok: true, action: 'zoom_to_globe', args: {} });
});

test('PROMPT_MAX_LENGTH is a small, sane cap', () => {
  assert.ok(PROMPT_MAX_LENGTH > 0 && PROMPT_MAX_LENGTH <= 1000);
});

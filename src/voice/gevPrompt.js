import { createGevActionRunner } from './gevActions.js';
import { PROMPT_MAX_LENGTH } from './promptAction.js';

/**
 * Prompt bar — a typed alternative to GEV Voice for when there is no OpenAI
 * key (or no mic). Same tool set, same runGevAction dispatcher, different
 * front door: a typed sentence goes to /api/prompt/route (a free open-weight
 * model on OpenRouter, server-side), which decides which action to run.
 *
 * `createGevActionRunner` is idempotent per viewer (see gevActions.js /
 * cameraVerbs.js), so building a second independent runner here — alongside
 * whatever GEV Voice already built from the same five objects — is safe.
 */

function createPromptBar() {
  let root = document.getElementById('gev-prompt-bar');
  if (!root) {
    root = document.createElement('div');
    root.id = 'gev-prompt-bar';
    root.dataset.status = 'idle';
    root.innerHTML = `
      <div class="gev-prompt-kicker">PROMPT</div>
      <form id="gev-prompt-form" autocomplete="off">
        <input id="gev-prompt-input" type="text" maxlength="${PROMPT_MAX_LENGTH}"
          placeholder="Type a command… e.g. &quot;zoom to Tokyo&quot;" aria-label="Type a GEV command" />
        <button id="gev-prompt-submit" type="submit">RUN</button>
      </form>
      <div id="gev-prompt-detail" class="gev-prompt-detail"></div>
    `;
    const commandDock = document.getElementById('command-dock');
    (commandDock || document.body).appendChild(root);
  }
  return {
    root,
    form: root.querySelector('#gev-prompt-form'),
    input: root.querySelector('#gev-prompt-input'),
    submitButton: root.querySelector('#gev-prompt-submit'),
    detail: root.querySelector('#gev-prompt-detail'),
  };
}

/**
 * @param {object} deps
 * @param {import('cesium').Viewer} deps.viewer
 * @param {object} deps.styleManager
 * @param {object} deps.dataManager
 * @param {object|null} [deps.sceneDirector]
 * @param {object|null} [deps.annotations]
 * @returns {{root: HTMLElement, submit: (text: string) => Promise<void>}}
 */
export function initGevPromptBar({ viewer, styleManager, dataManager, sceneDirector = null, annotations = null }) {
  const runAction = createGevActionRunner({ viewer, styleManager, dataManager, sceneDirector, annotations });
  const ui = createPromptBar();
  let busy = false;

  function setStatus(status, detail) {
    ui.root.dataset.status = status;
    ui.detail.textContent = detail || '';
  }

  async function submit(text) {
    const prompt = String(text || '').trim().slice(0, PROMPT_MAX_LENGTH);
    if (!prompt || busy) return;
    busy = true;
    ui.input.disabled = true;
    ui.submitButton.disabled = true;
    setStatus('thinking', 'THINKING…');
    try {
      const response = await fetch('/api/prompt/route', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok || body.ok === false) {
        setStatus('error', body.error || 'Prompt request failed');
        return;
      }
      if (body.action === null) {
        setStatus('error', body.reason || "Didn't find a matching command");
        return;
      }
      let result;
      try {
        result = await runAction(body.action, body.args || {}, { isCurrent: () => true });
      } catch (error) {
        setStatus('error', error?.message || `${body.action} failed`);
        return;
      }
      if (result?.ok === false) {
        setStatus('error', result.error || `${body.action} failed`);
        return;
      }
      setStatus('success', body.action);
    } finally {
      busy = false;
      ui.input.disabled = false;
      ui.submitButton.disabled = false;
    }
  }

  ui.form.addEventListener('submit', (event) => {
    event.preventDefault();
    const text = ui.input.value;
    ui.input.value = '';
    void submit(text);
  });

  return { root: ui.root, submit };
}

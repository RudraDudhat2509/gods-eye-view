import assert from 'node:assert/strict';
import test from 'node:test';
import { openRouterPromptProxy } from '../../vite.config.js';

function installRoutes() {
  const routes = new Map();
  openRouterPromptProxy().configureServer({
    middlewares: {
      use(path, handler) {
        routes.set(path, handler);
      },
    },
  });
  return routes;
}

function invokeRoute(handler, { method = 'POST', url = '/', remoteAddress = '127.0.0.1', body } = {}) {
  return new Promise((resolve, reject) => {
    const headers = new Map();
    const req = {
      method,
      url,
      headers: {},
      socket: { remoteAddress },
      on(event, cb) {
        if (event === 'data' && body !== undefined) cb(Buffer.from(body));
        if (event === 'end') cb();
      },
    };
    const res = {
      statusCode: 200,
      setHeader(name, value) {
        headers.set(String(name).toLowerCase(), String(value));
      },
      end(responseBody = '') {
        resolve({
          statusCode: this.statusCode,
          headers: Object.fromEntries(headers),
          body: responseBody ? JSON.parse(String(responseBody)) : null,
        });
      },
    };
    Promise.resolve(handler(req, res)).catch(reject);
  });
}

function withEnv(overrides, fn) {
  const previous = {};
  for (const key of Object.keys(overrides)) previous[key] = process.env[key];
  Object.assign(process.env, overrides);
  return Promise.resolve()
    .then(fn)
    .finally(() => {
      for (const key of Object.keys(overrides)) {
        if (previous[key] === undefined) delete process.env[key];
        else process.env[key] = previous[key];
      }
    });
}

function withMockedFetch(impl, fn) {
  const previous = globalThis.fetch;
  globalThis.fetch = impl;
  return Promise.resolve()
    .then(fn)
    .finally(() => {
      globalThis.fetch = previous;
    });
}

test('rejects anything but POST', async () => {
  await withEnv({ OPENROUTER_API_KEY: 'test-key' }, async () => {
    const routes = installRoutes();
    const response = await invokeRoute(routes.get('/api/prompt/route'), { method: 'GET' });
    assert.equal(response.statusCode, 405);
  });
});

test('reports 503 when no key is configured, without calling the network', async () => {
  await withEnv({ OPENROUTER_API_KEY: '' }, async () => {
    let fetchCalled = false;
    await withMockedFetch(() => { fetchCalled = true; }, async () => {
      const routes = installRoutes();
      const response = await invokeRoute(routes.get('/api/prompt/route'), {
        body: JSON.stringify({ prompt: 'zoom out' }),
      });
      assert.equal(response.statusCode, 503);
      assert.deepEqual(response.body, { error: 'OPENROUTER_API_KEY is not set' });
      assert.equal(fetchCalled, false);
    });
  });
});

test('rejects a blank prompt before touching the network', async () => {
  await withEnv({ OPENROUTER_API_KEY: 'test-key' }, async () => {
    let fetchCalled = false;
    await withMockedFetch(() => { fetchCalled = true; }, async () => {
      const routes = installRoutes();
      const response = await invokeRoute(routes.get('/api/prompt/route'), {
        body: JSON.stringify({ prompt: '   ' }),
      });
      assert.equal(response.statusCode, 400);
      assert.equal(fetchCalled, false);
    });
  });
});

test('dispatches a well-formed model reply as a clean action', async () => {
  await withEnv({ OPENROUTER_API_KEY: 'test-key' }, async () => {
    await withMockedFetch(async (url, init) => {
      assert.equal(url, 'https://openrouter.ai/api/v1/chat/completions');
      assert.equal(init.headers.Authorization, 'Bearer test-key');
      const sent = JSON.parse(init.body);
      assert.equal(sent.messages[1].content, 'zoom out to a globe view');
      return {
        ok: true,
        status: 200,
        json: async () => ({
          choices: [{ message: { content: '{"action": "zoom_to_globe", "args": {}}' } }],
        }),
      };
    }, async () => {
      const routes = installRoutes();
      const response = await invokeRoute(routes.get('/api/prompt/route'), {
        body: JSON.stringify({ prompt: 'zoom out to a globe view' }),
      });
      assert.equal(response.statusCode, 200);
      assert.deepEqual(response.body, { ok: true, action: 'zoom_to_globe', args: {} });
    });
  });
});

test('surfaces an upstream failure without dispatching anything', async () => {
  await withEnv({ OPENROUTER_API_KEY: 'test-key' }, async () => {
    await withMockedFetch(async () => ({
      ok: false,
      status: 429,
      json: async () => ({ error: { message: 'rate limited upstream' } }),
    }), async () => {
      const routes = installRoutes();
      const response = await invokeRoute(routes.get('/api/prompt/route'), {
        body: JSON.stringify({ prompt: 'zoom out' }),
      });
      assert.equal(response.statusCode, 429);
      assert.deepEqual(response.body, { ok: false, error: 'rate limited upstream' });
    });
  });
});

test('never lets a network error crash the route', async () => {
  await withEnv({ OPENROUTER_API_KEY: 'test-key' }, async () => {
    await withMockedFetch(async () => { throw new Error('DNS lookup failed'); }, async () => {
      const routes = installRoutes();
      const response = await invokeRoute(routes.get('/api/prompt/route'), {
        body: JSON.stringify({ prompt: 'zoom out' }),
      });
      assert.equal(response.statusCode, 502);
      assert.deepEqual(response.body, { ok: false, error: 'DNS lookup failed' });
    });
  });
});

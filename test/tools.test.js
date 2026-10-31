import assert from 'node:assert/strict';
import test from 'node:test';

import { runTool } from '../extension/tools.js';

function immediateSetTimeout(fn) {
  fn();
  return 0;
}

test('runTool sends non-responsive tools to the page', async (t) => {
  const previousChrome = globalThis.chrome;
  globalThis.chrome = {
    tabs: {
      sendMessage: async (tabId, message) => {
        assert.equal(tabId, 19);
        assert.deepEqual(message, {
          type: 'PP_TOOL',
          name: 'inspect_element',
          args: { element: 0 }
        });
        return { element: { id: 'btn' } };
      }
    }
  };

  t.after(() => {
    globalThis.chrome = previousChrome;
  });

  const result = await runTool(19, 'inspect_element', { element: 0 });
  assert.deepEqual(result, { element: { id: 'btn' } });
});

test('runTool returns a clear error when the page cannot be reached', async (t) => {
  const previousChrome = globalThis.chrome;
  globalThis.chrome = {
    tabs: {
      sendMessage: async () => {
        throw new Error('Receiving end does not exist');
      }
    }
  };

  t.after(() => {
    globalThis.chrome = previousChrome;
  });

  const result = await runTool(9, 'inspect_element', { element: 0 });
  assert.match(result.error, /Could not reach the page/);
});

test('verify_responsive runs checks at each width and restores metrics', async (t) => {
  const previousChrome = globalThis.chrome;
  const previousSetTimeout = globalThis.setTimeout;
  const debuggerCalls = [];
  const widthCalls = [];
  const sentVerifyMessages = [];
  const verifyResults = [
    { allPass: true, results: [{ line: 'ok mobile' }], warnings: [] },
    { allPass: false, results: [{ line: 'failed desktop' }], warnings: ['shifted sibling'] }
  ];

  globalThis.setTimeout = immediateSetTimeout;
  globalThis.chrome = {
    debugger: {
      attach: async (target, protocolVersion) => {
        debuggerCalls.push(['attach', target, protocolVersion]);
      },
      sendCommand: async (_target, command, payload) => {
        if (command === 'Emulation.setDeviceMetricsOverride') widthCalls.push(payload.width);
        debuggerCalls.push(['sendCommand', command]);
      },
      detach: async (target) => {
        debuggerCalls.push(['detach', target]);
      }
    },
    tabs: {
      sendMessage: async (tabId, message) => {
        sentVerifyMessages.push({ tabId, message });
        return verifyResults.shift();
      }
    }
  };

  t.after(() => {
    globalThis.chrome = previousChrome;
    globalThis.setTimeout = previousSetTimeout;
  });

  const checks = [{ type: 'visible' }];
  const result = await runTool(44, 'verify_responsive', { checks, widths: [375, 1280] });

  assert.equal(result.allPass, false);
  assert.equal(result.byWidth.length, 2);
  assert.deepEqual(widthCalls, [375, 1280]);
  assert.equal(sentVerifyMessages.length, 2);
  assert.deepEqual(sentVerifyMessages[0], {
    tabId: 44,
    message: { type: 'PP_TOOL', name: 'verify', args: { checks } }
  });
  assert.ok(debuggerCalls.some((c) => c[0] === 'sendCommand' && c[1] === 'Emulation.clearDeviceMetricsOverride'));
  assert.ok(debuggerCalls.some((c) => c[0] === 'detach'));
});

test('verify_responsive returns a setup error when debugger attach fails', async (t) => {
  const previousChrome = globalThis.chrome;
  globalThis.chrome = {
    debugger: {
      attach: async () => {
        throw new Error('Permission denied');
      }
    }
  };

  t.after(() => {
    globalThis.chrome = previousChrome;
  });

  const result = await runTool(11, 'verify_responsive', { checks: [{ type: 'visible' }] });
  assert.match(result.error, /Could not resize the viewport/);
});
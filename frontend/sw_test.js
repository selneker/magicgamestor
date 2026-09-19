// MOCKED browser-test harness: loads real public/sw.js in a Node VM with
// mocked self/registration/clients. Does NOT modify production worker.
const fs = require('fs');
const vm = require('vm');
const assert = require('assert');
require('dotenv').config({ path: __dirname + '/.env' });
const ORIGIN = new URL(process.env.REACT_APP_BACKEND_URL).origin;

const code = fs.readFileSync(__dirname + '/public/sw.js', 'utf8');

function makeSelf() {
  const listeners = {};
  const showNotificationCalls = [];
  const openWindowCalls = [];
  return {
    listeners,
    showNotificationCalls,
    openWindowCalls,
    self: {
      URL: URL,
      addEventListener: (type, fn) => { listeners[type] = fn; },
      skipWaiting: () => {},
      location: { origin: ORIGIN },
      registration: {
        showNotification: (title, opts) => {
          showNotificationCalls.push({ title, opts });
          return Promise.resolve();
        },
      },
      clients: {
        claim: () => Promise.resolve(),
        matchAll: async () => makeSelf._nextClients || [],
        openWindow: (url) => { openWindowCalls.push(url); return Promise.resolve({ url }); },
      },
    },
  };
}

async function run() {
  const results = [];

  // --- Test 1: push event → showNotification called with correct fields
  {
    const ctx = makeSelf();
    const sandbox = { self: ctx.self, URL: URL }; sandbox.self.self = sandbox.self;
    vm.createContext(sandbox);
    vm.runInContext(code, sandbox);
    const payload = { title: 'Nouvelle commande', body: 'Commande #MG-0001 · 30 UC', orderId: 'ord-1', url: '/admin/commandes?order=ord-1' };
    const event = {
      data: { json: () => payload },
      _p:null, waitUntil(p){this._p=p;},
    };
    ctx.listeners.push(event); await event._p;
    assert.strictEqual(ctx.showNotificationCalls.length, 1, 'showNotification once');
    const call = ctx.showNotificationCalls[0];
    assert.strictEqual(call.title, 'Nouvelle commande');
    assert.strictEqual(call.opts.body, payload.body);
    assert.strictEqual(call.opts.tag, 'ord-1');
    assert.strictEqual(call.opts.data.url, payload.url);
    results.push('push_with_full_payload: PASS');
  }

  // --- Test 2: push event with EMPTY payload → falls back to defaults
  {
    const ctx = makeSelf();
    const sandbox = { self: ctx.self, URL: URL }; sandbox.self.self = sandbox.self; vm.createContext(sandbox);
    vm.runInContext(code, sandbox);
    await ctx.listeners.push({ data: null, waitUntil: (p) => p });
    const c = ctx.showNotificationCalls[0];
    assert.strictEqual(c.title, 'Magic Game Store');
    assert.ok(c.opts.body.includes('nouvelle commande'));
    assert.strictEqual(c.opts.tag, 'mgs-order');
    assert.strictEqual(c.opts.data.url, '/admin/commandes');
    results.push('push_defaults_when_no_payload: PASS');
  }

  // --- Test 3: notificationclick WITH existing same-origin window → navigate + focus, NO openWindow
  {
    const ctx = makeSelf();
    let navigated = null; let focused = false;
    makeSelf._nextClients = [{
      url: ORIGIN + '/admin',
      navigate: async (href) => { navigated = href; },
      focus: async () => { focused = true; return 'focused'; },
    }];
    const sandbox = { self: ctx.self, URL: URL }; sandbox.self.self = sandbox.self; vm.createContext(sandbox);
    vm.runInContext(code, sandbox);
    const event = {
      notification: { close: () => {}, data: { url: '/admin/commandes?order=ord-9' } },
      _p: null,
      waitUntil(p) { this._p = p; },
    };
    ctx.listeners.notificationclick(event); await event._p;
    assert.ok(navigated && navigated.includes('/admin/commandes'), 'client.navigate called');
    assert.ok(navigated.includes('order=ord-9'), 'query preserved on navigate');
    assert.strictEqual(focused, true, 'client.focus called');
    assert.strictEqual(ctx.openWindowCalls.length, 0, 'openWindow NOT called');
    results.push('click_focuses_existing_window: PASS');
  }

  // --- Test 4: notificationclick WITH NO windows → openWindow
  {
    const ctx = makeSelf();
    makeSelf._nextClients = [];
    const sandbox = { self: ctx.self, URL: URL }; sandbox.self.self = sandbox.self; vm.createContext(sandbox);
    vm.runInContext(code, sandbox);
    const event = {
      notification: { close: () => {}, data: { url: '/admin/commandes?order=ord-2' } },
      _p:null, waitUntil(p){this._p=p;},
    };
    ctx.listeners.notificationclick(event); await event._p;
    assert.strictEqual(ctx.openWindowCalls.length, 1, 'openWindow called once');
    assert.ok(ctx.openWindowCalls[0].includes('/admin/commandes'));
    assert.ok(ctx.openWindowCalls[0].includes('order=ord-2'));
    results.push('click_opens_new_window_when_no_client: PASS');
  }

  // --- Test 5: notificationclick with foreign origin url → do nothing (safety)
  {
    const ctx = makeSelf();
    makeSelf._nextClients = [];
    const sandbox = { self: ctx.self, URL: URL }; sandbox.self.self = sandbox.self; vm.createContext(sandbox);
    vm.runInContext(code, sandbox);
    const event = {
      notification: { close: () => {}, data: { url: 'https://evil.example.com/admin/commandes' } },
      _p:null, waitUntil(p){this._p=p;},
    };
    ctx.listeners.notificationclick(event); await event._p;
    assert.strictEqual(ctx.openWindowCalls.length, 0, 'no openWindow on foreign origin');
    results.push('click_ignores_foreign_origin: PASS');
  }

  // --- Test 6: notificationclick with non-admin pathname → ignored
  {
    const ctx = makeSelf();
    makeSelf._nextClients = [];
    const sandbox = { self: ctx.self, URL: URL }; sandbox.self.self = sandbox.self; vm.createContext(sandbox);
    vm.runInContext(code, sandbox);
    const event = {
      notification: { close: () => {}, data: { url: '/other/path' } },
      _p:null, waitUntil(p){this._p=p;},
    };
    ctx.listeners.notificationclick(event); await event._p;
    assert.strictEqual(ctx.openWindowCalls.length, 0, 'no openWindow for non-admin path');
    results.push('click_ignores_non_admin_path: PASS');
  }

  console.log('\n=== SW MOCKED harness results ===');
  results.forEach((r) => console.log('  - ' + r));
  console.log('ALL PASS (' + results.length + ' cases)');
}

run().catch((e) => { console.error('FAIL', e); process.exit(1); });

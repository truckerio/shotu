import assert from "node:assert/strict";
import test from "node:test";
import { waitForSignedInSession, workspaceEntryReady } from "./signin-handoff.js";

function sessionAtom(initial = { data: null, isPending: false, isRefetching: false }) {
  let state = initial;
  const listeners = new Set();
  return {
    get: () => state,
    listen(callback) { listeners.add(callback); return () => listeners.delete(callback); },
    set(next) { state = next; for (const callback of listeners) callback(state); },
    get listenerCount() { return listeners.size; },
  };
}

test("entry follows automatic session refresh, including a superseding refresh", async () => {
  const atom = sessionAtom();
  let resolved = false;
  const wait = waitForSignedInSession(atom).then(() => { resolved = true; });
  await Promise.resolve();
  assert.equal(resolved, false, "initial unauthenticated state must wait for scheduled refresh");
  atom.set({ data: null, isPending: true, isRefetching: true });
  atom.set({ data: null, isPending: true, isRefetching: true });
  await Promise.resolve();
  assert.equal(resolved, false, "superseded request must not reject a valid pending refresh");
  atom.set({ data: { user: { id: "test" } }, isPending: false, isRefetching: false });
  await wait;
  assert.equal(atom.listenerCount, 0);
});

test("entry accepts an already settled session and restores retry after refresh failure", async () => {
  const ready = sessionAtom({ data: { user: { id: "test" } }, isPending: false });
  await waitForSignedInSession(ready);
  assert.equal(ready.listenerCount, 0);
  for (const result of [{ data: null }, { data: null, error: { status: 401 } }]) {
    const atom = sessionAtom({ data: null, isPending: true });
    const wait = waitForSignedInSession(atom);
    atom.set({ ...result, isPending: false, isRefetching: false });
    await assert.rejects(wait, /session could not be confirmed/);
    assert.equal(atom.listenerCount, 0);
  }
});

test("entry cancellation and timeout remove session subscriptions", async () => {
  const atom = sessionAtom();
  const controller = new AbortController();
  const wait = waitForSignedInSession(atom, { signal: controller.signal });
  controller.abort();
  await assert.rejects(wait, { name: "AbortError" });
  assert.equal(atom.listenerCount, 0);
  await assert.rejects(waitForSignedInSession(atom, { timeoutMs: 1 }), /timed out/);
  assert.equal(atom.listenerCount, 0);
});

test("kiosk subscribes before explicitly refreshing its raw API-created session", async () => {
  const atom = sessionAtom();
  let refreshes = 0;
  const wait = waitForSignedInSession(atom, { refresh: () => {
    refreshes++;
    assert.equal(atom.listenerCount, 1);
    atom.set({ data: null, isPending: true, isRefetching: true });
  } });
  atom.set({ data: { user: { id: "kiosk-mechanic" } }, isPending: false, isRefetching: false });
  await wait;
  assert.equal(refreshes, 1);
  assert.equal(atom.listenerCount, 0);
});

test("kiosk refresh failure and prior cancellation leave no listener or notification", async () => {
  const atom = sessionAtom();
  await assert.rejects(waitForSignedInSession(atom, { refresh: () => { throw new Error("refresh failed"); } }), /refresh failed/);
  assert.equal(atom.listenerCount, 0);
  const controller = new AbortController();
  controller.abort();
  let notified = false;
  await assert.rejects(waitForSignedInSession(atom, { signal: controller.signal, refresh: () => { notified = true; } }), { name: "AbortError" });
  assert.equal(notified, false);
});

test("entry waits for both app and nested route fallbacks, not just the profile dock", () => {
  const root = (main, loading) => ({ querySelector: (selector) => selector === "main" ? main : loading });
  assert.equal(workspaceEntryReady(null), false);
  assert.equal(workspaceEntryReady(root(null, null)), false);
  assert.equal(workspaceEntryReady(root({}, {})), false);
  assert.equal(workspaceEntryReady(root({}, null)), true);
});

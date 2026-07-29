import assert from "node:assert/strict";
import test from "node:test";
import {
  getInactivityRemainingMs,
  initialActivityTimestamp,
  parseInactivityMessage,
  shouldEnforceInactivity,
  transitionInactivityState,
} from "./inactivity-session.js";

const TIMEOUT_MS = 120_000;

test("admin and office standard sessions stay remembered while kiosk keeps its own lock", () => {
  assert.equal(shouldEnforceInactivity({
    authenticated: true,
    role: "admin",
    sessionMode: "standard",
  }), false);
  assert.equal(shouldEnforceInactivity({
    authenticated: true,
    role: "office",
    sessionMode: "standard",
  }), false);
  assert.equal(shouldEnforceInactivity({
    authenticated: true,
    role: "mechanic",
    sessionMode: "kiosk",
  }), false);
  assert.equal(shouldEnforceInactivity({
    authenticated: true,
    role: "mechanic",
    sessionMode: "standard",
  }), true);
  assert.equal(shouldEnforceInactivity({
    authenticated: true,
    role: "surveillance",
    sessionMode: "standard",
  }), true);
});

test("session expires after 120 seconds without activity", () => {
  const state = { lastActivityAt: 1_000, status: "active" };
  const result = transitionInactivityState(state, { type: "check" }, 121_000, TIMEOUT_MS);

  assert.equal(result.status, "expired");
  assert.equal(getInactivityRemainingMs(state, 121_000, TIMEOUT_MS), 0);
});

test("real activity resets inactivity deadline", () => {
  const state = { lastActivityAt: 1_000, status: "active" };
  const active = transitionInactivityState(state, { type: "activity", at: 100_000 }, 100_000, TIMEOUT_MS);
  const checked = transitionInactivityState(active, { type: "check" }, 219_999, TIMEOUT_MS);

  assert.equal(active.lastActivityAt, 100_000);
  assert.equal(checked.status, "active");
  assert.equal(getInactivityRemainingMs(active, 219_999, TIMEOUT_MS), 1);
});

test("return from hidden tab expires from timestamp despite throttled timers", () => {
  const state = { lastActivityAt: 5_000, status: "active" };
  const result = transitionInactivityState(state, { type: "check" }, 130_000, TIMEOUT_MS);

  assert.equal(result.status, "expired");
});

test("cross-tab logout message expires session immediately", () => {
  const state = { lastActivityAt: 100_000, status: "active" };
  const message = parseInactivityMessage(JSON.stringify({ type: "logout", at: 101_000, nonce: "other-tab" }));
  const result = transitionInactivityState(state, message, 101_000, TIMEOUT_MS);

  assert.deepEqual(message, { type: "logout", at: 101_000 });
  assert.equal(result.status, "expired");
});

test("cross-tab activity extends deadline but future timestamps are ignored", () => {
  const state = { lastActivityAt: 10_000, status: "active" };
  const updated = transitionInactivityState(state, { type: "activity", at: 20_000 }, 20_000, TIMEOUT_MS);
  const rejected = transitionInactivityState(updated, { type: "activity", at: 25_000 }, 20_000, TIMEOUT_MS);

  assert.equal(updated.lastActivityAt, 20_000);
  assert.equal(rejected.lastActivityAt, 20_000);
});

test("late cross-tab activity cannot revive an already timed-out session", () => {
  const state = { lastActivityAt: 10_000, status: "active" };
  const expired = transitionInactivityState(state, { type: "check" }, 140_000, TIMEOUT_MS);
  const result = transitionInactivityState(expired, { type: "activity", at: 139_000 }, 140_000, TIMEOUT_MS);

  assert.equal(result.status, "expired");
  assert.equal(result.lastActivityAt, 10_000);
});

test("same session keeps its activity deadline after browser reopen", () => {
  const stored = JSON.stringify({ sessionKey: "session-1", lastActivityAt: 10_000 });

  assert.equal(initialActivityTimestamp(stored, "session-1", 150_000), 10_000);
});

test("new login session receives a fresh inactivity deadline", () => {
  const stored = JSON.stringify({ sessionKey: "session-1", lastActivityAt: 10_000 });

  assert.equal(initialActivityTimestamp(stored, "session-2", 150_000), 150_000);
});

test("cross-tab events retain session scope", () => {
  assert.deepEqual(
    parseInactivityMessage(JSON.stringify({
      type: "activity",
      at: 20_000,
      sessionKey: "session-1",
    })),
    { type: "activity", at: 20_000, sessionKey: "session-1" },
  );
});

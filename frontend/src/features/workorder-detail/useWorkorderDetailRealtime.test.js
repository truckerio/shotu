import assert from "node:assert/strict";
import test from "node:test";
import {
  shouldRefreshWorkorderDetail,
  WORKORDER_DETAIL_REFRESH_MS,
} from "./useWorkorderDetailRealtime.js";

test("workorder detail realtime uses a short operator-friendly polling interval", () => {
  assert.equal(WORKORDER_DETAIL_REFRESH_MS, 3000);
});

test("workorder detail realtime pauses when hidden or mechanic progress is unsafe to overwrite", () => {
  assert.equal(shouldRefreshWorkorderDetail({
    enabled: true,
    workorderId: "wo-1",
    paused: false,
    documentHidden: false,
  }), true);
  assert.equal(shouldRefreshWorkorderDetail({
    enabled: true,
    workorderId: "wo-1",
    paused: true,
    documentHidden: false,
  }), false);
  assert.equal(shouldRefreshWorkorderDetail({
    enabled: true,
    workorderId: "wo-1",
    paused: false,
    documentHidden: true,
  }), false);
  assert.equal(shouldRefreshWorkorderDetail({
    enabled: true,
    workorderId: "",
    paused: false,
    documentHidden: false,
  }), false);
});

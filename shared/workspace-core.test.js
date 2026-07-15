"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  clone,
  isReservedRuntimeId,
  idleGesture,
  transitionGesture,
  runAtomicTransaction
} = require("./workspace-core");

test("reserved runtime IDs have one shared definition", () => {
  assert.equal(isReservedRuntimeId("__runtime_state"), true);
  assert.equal(isReservedRuntimeId("__runtime:edge"), true);
  assert.equal(isReservedRuntimeId("runtime_state"), false);
});

test("gesture ownership rejects overlapping pointers and invalid modes", () => {
  const first = transitionGesture(idleGesture(), "pendingNode", { pointerType: "touch", pointerId: 1 }, { now: 10 });
  assert.equal(first.ok, true);
  assert.deepEqual(first.state, { mode: "pendingNode", pointerId: 1, pointerType: "touch", startedAt: 10 });

  const stolen = transitionGesture(first.state, "nodeDrag", { pointerType: "touch", pointerId: 2 });
  assert.equal(stolen.ok, false);
  assert.equal(stolen.reason, "pointer-owned");
  assert.deepEqual(stolen.state, first.state);

  const drag = transitionGesture(first.state, "nodeDrag", { pointerType: "touch", pointerId: 1 });
  assert.equal(drag.ok, true);
  assert.equal(transitionGesture(drag.state, "pendingEdge", { pointerType: "touch", pointerId: 1 }).ok, false);
  assert.deepEqual(transitionGesture(drag.state, "idle").state, idleGesture());
});

test("gesture transition matrix is exhaustive and pinch has multi-pointer ownership", () => {
  const modes = Object.keys(require("./workspace-core").GESTURE_TRANSITIONS);
  const transitions = require("./workspace-core").GESTURE_TRANSITIONS;
  const event = { pointerType: "touch", pointerId: 7 };

  for (const from of modes) {
    const current = from === "idle"
      ? idleGesture()
      : { mode: from, pointerId: from === "pinch" ? null : 7, pointerType: "touch", startedAt: 1 };
    for (const to of modes) {
      const result = transitionGesture(current, to, event, { now: 0 });
      const allowed = from === to || transitions[from].includes(to);
      assert.equal(result.ok, allowed, `${from} -> ${to}`);
    }
  }

  const pinch = transitionGesture(
    { mode: "nodeDrag", pointerId: 7, pointerType: "touch", startedAt: 1 },
    "pinch",
    null
  );
  assert.equal(pinch.ok, true);
  assert.deepEqual(pinch.state, { mode: "pinch", pointerId: null, pointerType: "touch", startedAt: 1 });
  assert.deepEqual(
    transitionGesture(idleGesture(), "pendingCanvas", { pointerType: "mouse" }, { now: 0 }).state,
    { mode: "pendingCanvas", pointerId: "mouse", pointerType: "mouse", startedAt: 0 }
  );
});

test("atomic transactions isolate drafts and expose the rollback snapshot", () => {
  const input = { states: [{ id: "start" }], sparse: new Array(1), missing: undefined };
  const inputBefore = clone(input);
  let thrown;

  try {
    runAtomicTransaction(input, draft => {
      draft.states.push({ id: "review" });
      draft.sparse[0] = "filled";
      throw new Error("reject batch");
    });
  } catch (error) {
    thrown = error;
  }

  assert.equal(thrown && thrown.message, "reject batch");
  assert.deepEqual(thrown.transactionBefore, inputBefore);
  assert.deepEqual(input, inputBefore);
  assert.equal(Object.prototype.hasOwnProperty.call(input.sparse, 0), false);
  assert.equal(Object.prototype.hasOwnProperty.call(input, "missing"), true);
});

test("atomic transactions return normalized values without mutating input", () => {
  const input = { count: 1 };
  const transaction = runAtomicTransaction(input, draft => {
    draft.count += 1;
    return "updated";
  }, {
    normalize: draft => ({ ...draft, canonical: true }),
    validate: value => ({ ok: value.count === 2, issues: [] })
  });

  assert.deepEqual(input, { count: 1 });
  assert.deepEqual(transaction.value, { count: 2, canonical: true });
  assert.equal(transaction.result, "updated");
});

test("atomic transactions reject asynchronous operations before they can escape", () => {
  assert.throws(
    () => runAtomicTransaction({ count: 1 }, async draft => { draft.count += 1; }),
    /must be synchronous/
  );
});

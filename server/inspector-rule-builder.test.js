"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  compileCondition,
  contextFieldsForTransition,
  parseCondition,
  removeRule
} = require("./inspector-rule-builder");

test("transition rule builder edits single rule rows and compiles contract conditions", () => {
  const parsed = parseCondition("states.checkbox_a.checked == true && states.email.value != \"\"");
  assert.equal(parsed.join, "and");
  assert.equal(parsed.rules.length, 2);
  assert.deepEqual(parsed.rules[0], { field: "states.checkbox_a.checked", operator: "==", value: true });
  assert.deepEqual(parsed.rules[1], { field: "states.email.value", operator: "!=", value: "" });

  const remaining = removeRule(parsed.rules, 0);
  assert.deepEqual(remaining.map(rule => rule.field), ["states.email.value"]);
  assert.equal(compileCondition(remaining, parsed.join), "states.email.value != \"\"");
});

test("transition listener fields are context-aware for the connected source state and event payload", () => {
  const model = {
    states: [
      {
        id: "checkbox_a",
        title: "Checkbox A",
        data: { checked: false },
        dataTypes: { checked: "boolean" }
      },
      {
        id: "checkbox_b",
        title: "Checkbox B",
        data: { checked: true },
        dataTypes: { checked: "boolean" }
      }
    ]
  };
  const transition = { from: "checkbox_a", to: "done" };
  const contract = {
    datasets: [
      {
        id: "realtime.sip.call.incoming",
        label: "Incoming call",
        fields: { caller: "text", callee: "text", callId: "text" }
      }
    ]
  };
  const fields = contextFieldsForTransition(model, transition, contract);
  const paths = fields.map(field => field.path);
  assert.ok(paths.includes("states.checkbox_a.checked"));
  assert.ok(!paths.includes("states.checkbox_b.checked"));
  assert.ok(paths.includes("realtime.sip.call.incoming.detail.caller"));

  const checkbox = fields.find(field => field.path === "states.checkbox_a.checked");
  assert.equal(checkbox.label, "Checkbox A · checked");
  assert.equal(checkbox.type, "boolean");
});

test("rule builder keeps composed OR listeners readable", () => {
  const condition = compileCondition([
    { field: "states.checkbox_a.checked", operator: "==", value: true },
    { field: "realtime.sip.call.incoming.detail.caller", operator: "==", value: "+491234" }
  ], "or");
  assert.equal(condition, "states.checkbox_a.checked == true || realtime.sip.call.incoming.detail.caller == +491234");
  assert.deepEqual(parseCondition(condition).rules.map(rule => rule.field), [
    "states.checkbox_a.checked",
    "realtime.sip.call.incoming.detail.caller"
  ]);
});

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  compileCondition,
  contextFieldsForTransition,
  operatorsForFieldType,
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

test("transition listener fields are context-aware and keep checkbox ids distinct", () => {
  const model = {
    states: [
      { id: "checkbox_a", title: "Checkbox A", data: { checked: false, label: "Altlast" }, dataTypes: { checked: "boolean" } },
      { id: "checkbox_b", title: "Checkbox B", data: { checked: true }, dataTypes: { checked: "boolean" } },
      { id: "email", title: "E-Mail", data: { value: "", label: "E-Mail" }, dataTypes: { value: "email" } },
      { id: "search", title: "Suchfeld", data: { value: "", placeholder: "Suche" }, dataTypes: { value: "text" } }
    ]
  };
  const transition = { from: "checkbox_a", to: "done" };
  const contract = {
    datasets: [
      { id: "realtime.sip.call.incoming", label: "Incoming call", fields: { caller: "text", callee: "text", callId: "text" } }
    ]
  };
  const fields = contextFieldsForTransition(model, transition, contract);
  const paths = fields.map(field => field.path);

  assert.ok(paths.includes("states.checkbox_a.checked"));
  assert.ok(paths.includes("states.checkbox_b.checked"));
  assert.ok(paths.includes("states.email.value"));
  assert.ok(paths.includes("states.search.value"));
  assert.ok(!paths.includes("states.checkbox_a.label"));
  assert.ok(!paths.includes("states.search.placeholder"));
  assert.ok(paths.includes("realtime.sip.call.incoming.detail.caller"));

  const checkboxA = fields.find(field => field.path === "states.checkbox_a.checked");
  const checkboxB = fields.find(field => field.path === "states.checkbox_b.checked");
  assert.equal(checkboxA.label, "Checkbox A (checkbox_a) · checked");
  assert.equal(checkboxB.label, "Checkbox B (checkbox_b) · checked");
  assert.equal(checkboxA.sourceState, true);
  assert.equal(checkboxB.sourceState, false);
  assert.equal(checkboxA.type, "boolean");
});

test("checkbox and input combinations compile as simple readable rules", () => {
  const condition = compileCondition([
    { field: "states.checkbox_a.checked", operator: "==", value: true },
    { field: "states.checkbox_b.checked", operator: "==", value: false },
    { field: "states.email.value", operator: "!=", value: "" },
    { field: "states.search.value", operator: "==", value: "Yuneo" }
  ], "and");
  assert.equal(condition, "states.checkbox_a.checked == true && states.checkbox_b.checked == false && states.email.value != \"\" && states.search.value == \"Yuneo\"");
  const parsed = parseCondition(condition);
  assert.equal(parsed.join, "and");
  assert.deepEqual(parsed.rules.map(rule => rule.field), [
    "states.checkbox_a.checked",
    "states.checkbox_b.checked",
    "states.email.value",
    "states.search.value"
  ]);
});

test("rule builder keeps composed OR listeners readable", () => {
  const condition = compileCondition([
    { field: "states.checkbox_a.checked", operator: "==", value: true },
    { field: "realtime.sip.call.incoming.detail.caller", operator: "==", value: "+491234" }
  ], "or");
  assert.equal(condition, "states.checkbox_a.checked == true || realtime.sip.call.incoming.detail.caller == \"+491234\"");
  assert.deepEqual(parseCondition(condition).rules.map(rule => rule.field), [
    "states.checkbox_a.checked",
    "realtime.sip.call.incoming.detail.caller"
  ]);
});

test("rule builder offers simple operators per field type", () => {
  assert.deepEqual(operatorsForFieldType("boolean"), ["==", "!=", "truthy", "falsy"]);
  assert.deepEqual(operatorsForFieldType("number"), ["==", "!=", ">", ">=", "<", "<="]);
  assert.deepEqual(operatorsForFieldType("email"), ["==", "!=", "truthy", "falsy"]);
});

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const presetLibrary = require("./preset-library");

test("DaisyUI pricing card snippets become editable pricing presets", () => {
  const snippet = `
<div data-zustand-daisyui-render class="aura aura-rainbow">
  <div class="card w-96 bg-base-100 shadow-sm">
    <div class="card-body">
      <span class="badge badge-xs badge-warning">Most Popular</span>
      <div class="flex justify-between">
        <h2 class="text-3xl font-bold">Premium</h2>
        <span class="text-xl">$29/mo</span>
      </div>
      <ul class="mt-6 flex flex-col gap-2 text-xs">
        <li><span>High-resolution image generation</span></li>
        <li><span>Customizable style templates</span></li>
        <li><span>Batch processing capabilities</span></li>
        <li><span>AI-driven image enhancements</span></li>
      </ul>
      <div class="mt-6"><button class="btn btn-primary btn-block">Subscribe</button></div>
    </div>
  </div>
</div>`;

  const preset = presetLibrary.parseDaisySnippet({
    snippet,
    id: "custom_aura_pricing_card_test",
    title: "Aura Pricing Card",
    categoryId: "websuite-builder",
    packageIds: ["website.builder"]
  });

  assert.equal(preset.variant, "pricing");
  assert.equal(preset.data.plans.length, 1);
  assert.deepEqual(preset.data.plans[0], {
    title: "Premium",
    badge: "Most Popular",
    price: "$29/mo",
    period: "",
    body: "",
    features: [
      "High-resolution image generation",
      "Customizable style templates",
      "Batch processing capabilities",
      "AI-driven image enhancements"
    ],
    actionLabel: "Subscribe",
    highlight: true
  });
});

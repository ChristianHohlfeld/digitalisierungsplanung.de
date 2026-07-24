"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const eventCatalog = require("./event-catalog");
const presetLibrary = require("./preset-library");
const productContract = require("./product-contract");

test("managed Daisy presets expose fully qualified component data paths", () => {
  const eventCatalogValue = eventCatalog.loadEventCatalogFile();
  const library = presetLibrary.loadPresetLibraryFile();
  library.presets.push({
    id: "custom_contract_pricing_path",
    variant: "pricing",
    title: "Contract Pricing",
    description: "Ensures managed Daisy presets mount under a writable field.",
    categoryId: "websuite-builder",
    packageIds: ["website.builder"],
    data: {
      title: "",
      body: "",
      plans: [{
        title: "Premium",
        badge: "Most Popular",
        price: "$29/mo",
        period: "",
        body: "",
        features: ["Editable feature"],
        actionLabel: "Subscribe",
        highlight: true,
        transitionId: ""
      }]
    }
  });

  const contract = productContract.productContractResponse({ eventCatalog: eventCatalogValue, presetLibrary: library });
  const preset = contract.presets.find(item => item.id === "custom_contract_pricing_path");
  assert.ok(preset);
  assert.equal(preset.builtIn, false);
  assert.equal(preset.components[0].type, "daisy");
  assert.equal(preset.components[0].dataPath, "states.custom_contract_pricing_path.view");
  assert.equal(preset.data.view.plans[0].title, "Premium");
  assert.equal(preset.data.view.plans[0].price, "$29/mo");
  assert.ok(preset.stateContribution.fields.includes("states.custom_contract_pricing_path.view"));
  assert.ok(preset.stateContribution.fields.includes("states.custom_contract_pricing_path.view.plans"));
  assert.ok(!preset.components.some(component => component.dataPath === "states.custom_contract_pricing_path"));
});

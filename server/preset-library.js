"use strict";

const core = require("./preset-library-core");

function serializePresetLibrary(value) {
  return core.serializePresetLibrary(value).replace(/</g, "\\u003c");
}

module.exports = {
  ...core,
  serializePresetLibrary
};

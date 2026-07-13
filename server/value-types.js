"use strict";

const MAX_SAFE_RANGE = Number.MAX_SAFE_INTEGER;

const VALUE_TYPE_DEFINITIONS = Object.freeze({
  text: {
    label: "Text",
    jsonType: "string",
    default: "",
    constraints: { minLength: 0, maxLength: 20000 }
  },
  email: {
    label: "E-Mail",
    jsonType: "string",
    default: "",
    constraints: { format: "email", minLength: 0, maxLength: 320 }
  },
  password: {
    label: "Password",
    jsonType: "string",
    default: "",
    constraints: { sensitive: true, minLength: 0, maxLength: 4096 }
  },
  number: {
    label: "Number",
    jsonType: "number",
    default: 0,
    constraints: { finite: true, min: -MAX_SAFE_RANGE, max: MAX_SAFE_RANGE }
  },
  boolean: {
    label: "Boolean",
    jsonType: "boolean",
    default: false,
    constraints: { enum: [true, false] }
  },
  url: {
    label: "URL",
    jsonType: "string",
    default: "",
    constraints: { format: "url", protocols: ["http", "https"], minLength: 0, maxLength: 2048 }
  },
  image: {
    label: "Image",
    jsonType: "string",
    default: "",
    constraints: { format: "image-url-or-data-uri", protocols: ["http", "https", "data"], minLength: 0, maxLength: 1000000 }
  },
  object: {
    label: "Object",
    jsonType: "object",
    default: {},
    constraints: { plainObject: true, maxDepth: 8, maxProperties: 200 }
  },
  list: {
    label: "List",
    jsonType: "array",
    default: [],
    constraints: { maxDepth: 8, maxItems: 1000 }
  }
});

const VALID_VALUE_TYPES = new Set(Object.keys(VALUE_TYPE_DEFINITIONS));

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeValueType(value, fallback = "") {
  const type = String(value || "").trim().toLowerCase();
  if (VALID_VALUE_TYPES.has(type)) return type;
  return fallback && VALID_VALUE_TYPES.has(fallback) ? fallback : "";
}

function valueTypeDefinition(type) {
  const cleanType = normalizeValueType(type);
  if (!cleanType) return null;
  return {
    id: cleanType,
    ...cloneJson(VALUE_TYPE_DEFINITIONS[cleanType])
  };
}

function valueTypeList() {
  return [...VALID_VALUE_TYPES].map(valueTypeDefinition);
}

function fieldSchemaForType(type, overrides = {}) {
  const definition = valueTypeDefinition(type);
  if (!definition) return null;
  const constraints = isPlainObject(overrides.constraints)
    ? { ...definition.constraints, ...cloneJson(overrides.constraints) }
    : definition.constraints;
  return {
    type: definition.id,
    jsonType: definition.jsonType,
    default: cloneJson(definition.default),
    constraints
  };
}

function fieldSchemasFromTypeMap(typeMap) {
  if (!isPlainObject(typeMap)) return {};
  return Object.fromEntries(
    Object.entries(typeMap)
      .map(([path, type]) => [path, fieldSchemaForType(type)])
      .filter(([, schema]) => schema)
  );
}

function valueDepth(value, depth = 0) {
  if (value === null || typeof value !== "object") return depth;
  const children = Array.isArray(value) ? value : Object.values(value);
  if (!children.length) return depth + 1;
  return Math.max(...children.map(child => valueDepth(child, depth + 1)));
}

function validateUrlProtocol(value, constraints) {
  if (!value) return true;
  const protocols = Array.isArray(constraints.protocols) ? constraints.protocols : [];
  if (constraints.format === "image-url-or-data-uri" && /^data:image\/[a-z0-9.+-]+;base64,/i.test(value)) {
    return protocols.includes("data");
  }
  try {
    const url = new URL(value);
    return protocols.includes(url.protocol.replace(/:$/, ""));
  } catch (_) {
    return false;
  }
}

function validateStringValue(value, schema) {
  if (typeof value !== "string") return { ok: false, code: "invalid_detail_type" };
  const constraints = schema.constraints || {};
  if (Number.isFinite(constraints.minLength) && value.length < constraints.minLength) return { ok: false, code: "invalid_detail_value" };
  if (Number.isFinite(constraints.maxLength) && value.length > constraints.maxLength) return { ok: false, code: "invalid_detail_value" };
  if (constraints.format === "email" && value && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) return { ok: false, code: "invalid_detail_value" };
  if ((constraints.format === "url" || constraints.format === "image-url-or-data-uri") && value && !validateUrlProtocol(value, constraints)) {
    return { ok: false, code: "invalid_detail_value" };
  }
  return { ok: true };
}

function validateNumberValue(value, schema) {
  if (typeof value !== "number" || !Number.isFinite(value)) return { ok: false, code: "invalid_detail_type" };
  const constraints = schema.constraints || {};
  if (constraints.integer === true && !Number.isInteger(value)) return { ok: false, code: "invalid_detail_value" };
  if (Number.isFinite(constraints.min) && value < constraints.min) return { ok: false, code: "invalid_detail_value" };
  if (Number.isFinite(constraints.max) && value > constraints.max) return { ok: false, code: "invalid_detail_value" };
  return { ok: true };
}

function validateObjectValue(value, schema) {
  if (!isPlainObject(value)) return { ok: false, code: "invalid_detail_type" };
  const constraints = schema.constraints || {};
  if (Number.isFinite(constraints.maxProperties) && Object.keys(value).length > constraints.maxProperties) {
    return { ok: false, code: "invalid_detail_value" };
  }
  if (Number.isFinite(constraints.maxDepth) && valueDepth(value) > constraints.maxDepth) return { ok: false, code: "invalid_detail_value" };
  return { ok: true };
}

function validateListValue(value, schema) {
  if (!Array.isArray(value)) return { ok: false, code: "invalid_detail_type" };
  const constraints = schema.constraints || {};
  if (Number.isFinite(constraints.maxItems) && value.length > constraints.maxItems) return { ok: false, code: "invalid_detail_value" };
  if (Number.isFinite(constraints.maxDepth) && valueDepth(value) > constraints.maxDepth) return { ok: false, code: "invalid_detail_value" };
  return { ok: true };
}

function validateValueAgainstSchema(value, schema) {
  const cleanSchema = isPlainObject(schema) ? schema : fieldSchemaForType(schema);
  if (!cleanSchema) return { ok: false, code: "invalid_detail_type" };
  if (cleanSchema.type === "number") return validateNumberValue(value, cleanSchema);
  if (cleanSchema.type === "boolean") return typeof value === "boolean" ? { ok: true } : { ok: false, code: "invalid_detail_type" };
  if (cleanSchema.type === "object") return validateObjectValue(value, cleanSchema);
  if (cleanSchema.type === "list") return validateListValue(value, cleanSchema);
  return validateStringValue(value, cleanSchema);
}

module.exports = {
  VALID_VALUE_TYPES,
  VALUE_TYPE_DEFINITIONS,
  fieldSchemaForType,
  fieldSchemasFromTypeMap,
  normalizeValueType,
  validateValueAgainstSchema,
  valueTypeDefinition,
  valueTypeList
};

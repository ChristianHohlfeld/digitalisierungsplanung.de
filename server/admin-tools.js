"use strict";

const ADMIN_ROUTE_SCHEMA_VERSION = 1;

function route(config, key, fallback) {
  const value = config && config[key];
  return typeof value === "string" && value ? value : fallback;
}

function endpoint(id, method, path, label, surface, description) {
  return { id, method, path, label, surface, description };
}

function adminRouteIndex(config = {}) {
  const paths = {
    root: "/",
    admin: route(config, "adminPath", "/admin.html"),
    adminRoutes: route(config, "adminRoutesPath", "/admin/routes"),
    health: "/healthz",
    version: route(config, "versionPath", "/version"),
    productContract: route(config, "productContractPath", "/contract"),
    events: route(config, "eventsPath", "/events"),
    token: route(config, "tokenPath", "/token"),
    console: route(config, "consolePath", "/console.html"),
    eventsAdmin: route(config, "eventsAdminPath", "/events-admin.html"),
    eventsAdminCatalog: route(config, "eventsAdminCatalogPath", "/events-admin/catalog"),
    imageInline: route(config, "imageInlinePath", "/assets/inline-image"),
    stripeCheckout: route(config, "stripeCheckoutPath", "/stripe/checkout"),
    emit: route(config, "emitPath", "/emit"),
    ws: route(config, "path", "/ws")
  };

  const tools = [
    {
      id: "events",
      label: "Event Designer",
      href: paths.eventsAdmin,
      kind: "designer",
      intent: "Realtime-Ereignisse, Webhooks, Mail, SIP und Datenquellen definieren.",
      endpointIds: ["events-admin-html", "events-admin-catalog", "events"]
    },
    {
      id: "console",
      label: "Event Console",
      href: paths.console,
      kind: "test",
      intent: "Katalogisierte Events testweise in einen Raum senden.",
      endpointIds: ["console-html", "emit", "events"]
    },
    {
      id: "contract",
      label: "State Contract",
      href: paths.productContract,
      kind: "contract",
      intent: "Aktuelle Wahrheit für Editor, Trigger, Value-Types, Datasets, Connectoren und die 13 fokussierten Bausteine ansehen.",
      endpointIds: ["product-contract"]
    },
    {
      id: "system",
      label: "Systemstatus",
      href: paths.health,
      kind: "system",
      intent: "Release, Health, Raum- und Client-Zähler prüfen.",
      endpointIds: ["healthz", "version"]
    }
  ];

  const endpoints = [
    endpoint("admin-root", "GET", paths.root, "Admin Hub Root", "admin", "Zentraler Einstieg für Server-Tools."),
    endpoint("admin-html", "GET", paths.admin, "Admin Hub", "admin", "Zentraler Einstieg für Server-Tools."),
    endpoint("admin-routes", "GET", paths.adminRoutes, "Admin Route Index", "admin", "Einzige Navigationsquelle für den Hub."),
    endpoint("healthz", "GET", paths.health, "Health", "public", "Serverstatus und aktive Realtime-Zahlen."),
    endpoint("version", "GET", paths.version, "Release", "public", "Gemeinsame Frontend-/Backend-Release-ID."),
    endpoint("product-contract", "GET", paths.productContract, "State Contract", "public", "Editor-Contract für Trigger, Werte, Datasets, Connectoren und fokussierte Bausteine."),
    endpoint("events", "GET", paths.events, "Event Catalog", "public", "Aktuelle Realtime-Events und Connectoren."),
    endpoint("token", "GET", paths.token, "Room Token", "runtime", "Signiertes Browser-Token für WSS-Räume."),
    endpoint("console-html", "GET", paths.console, "Event Console", "admin", "Stateless Test-Emitter."),
    endpoint("events-admin-html", "GET", paths.eventsAdmin, "Event Designer", "admin", "Admin-Oberfläche für Event-Catalog."),
    endpoint("events-admin-catalog", "GET/POST", paths.eventsAdminCatalog, "Event Catalog Admin API", "admin", "Event-Catalog laden, validieren, committen und pushen."),
    endpoint("image-inline", "POST", paths.imageInline, "Image Inline", "runtime", "Public image URL as Data URI for self-contained exports."),
    endpoint("stripe-checkout", "GET", paths.stripeCheckout, "Stripe Checkout", "runtime", "Preis-CTA erzeugt eine Stripe Checkout Session."),
    endpoint("emit", "POST", paths.emit, "Emit", "runtime", "Authentifizierter serverseitiger Event-Eingang."),
    endpoint("ws", "WSS", paths.ws, "WebSocket", "runtime", "Realtime-Transport für Runtime-Events.")
  ];

  return {
    schemaVersion: ADMIN_ROUTE_SCHEMA_VERSION,
    title: "Realtime Admin",
    paths,
    tools,
    endpoints
  };
}

module.exports = {
  ADMIN_ROUTE_SCHEMA_VERSION,
  adminRouteIndex
};

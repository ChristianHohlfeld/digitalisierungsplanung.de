"use strict";

const valueTypes = require("./value-types");
const presetLibrary = require("./preset-library");

const DEFAULT_IMAGE_COMPONENT_URL = "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSI2NDAiIGhlaWdodD0iMzYwIiB2aWV3Qm94PSIwIDAgNjQwIDM2MCI+PGRlZnM+PGxpbmVhckdyYWRpZW50IGlkPSJnIiB4MT0iMCIgeDI9IjEiIHkxPSIwIiB5Mj0iMSI+PHN0b3Agc3RvcC1jb2xvcj0iIzBlYTVlOSIvPjxzdG9wIG9mZnNldD0iMSIgc3RvcC1jb2xvcj0iI2Y1OWUwYiIvPjwvbGluZWFyR3JhZGllbnQ+PC9kZWZzPjxyZWN0IHdpZHRoPSI2NDAiIGhlaWdodD0iMzYwIiByeD0iMzIiIGZpbGw9InVybCgjZykiLz48Y2lyY2xlIGN4PSI0NzIiIGN5PSIxMTIiIHI9IjUyIiBmaWxsPSIjZmZmZmZmIiBvcGFjaXR5PSIuMzIiLz48cGF0aCBkPSJNNzIgMjg2bDEyMi0xMjIgNzggNzggNDgtNDggMTc2IDkyeiIgZmlsbD0iI2ZmZmZmZiIgb3BhY2l0eT0iLjQ4Ii8+PHRleHQgeD0iNDgiIHk9IjcwIiBmb250LWZhbWlseT0iQXJpYWwsIHNhbnMtc2VyaWYiIGZvbnQtc2l6ZT0iMzQiIGZvbnQtd2VpZ2h0PSI3MDAiIGZpbGw9IiNmZmZmZmYiPkltYWdlIGJsb2NrPC90ZXh0Pjwvc3ZnPg==";

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeId(text) {
  return String(text || "state")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/^_+|_+$/g, "") || "state";
}

function normalizeStateDataValue(value) {
  if (Array.isArray(value)) return value.filter(item => item !== undefined).map(normalizeStateDataValue);
  if (!isPlainObject(value)) return value;
  const out = {};
  for (const [key, child] of Object.entries(value)) {
    if (child === undefined || !/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(key)) continue;
    out[key] = normalizeStateDataValue(child);
  }
  return out;
}

function normalizeStateDataObject(value) {
  return isPlainObject(value) ? normalizeStateDataValue(value) : {};
}

function stateDataScopeForId(id) {
  const clean = normalizeId(id || "state");
  return clean ? "states." + clean : "";
}

const SUBSCRIPTION_PLANS = Object.freeze([
  {
    id: "starter",
    label: "Starter",
    price: "249 EUR",
    period: "/Monat",
    description: "Für einzelne Prozesse, schnelle Prototypen und erste digitale Anwendungen.",
    includedPackageIds: ["core.process"],
    recommendedAddOnPackageIds: ["website.builder", "approval.compliance"],
    cta: "Starter anfragen",
    sort: 10
  },
  {
    id: "business",
    label: "Business",
    badge: "Beliebt",
    price: "749 EUR",
    period: "/Monat",
    description: "Für Mittelstandsteams, die Prozesse modellieren, prüfen und als Web-App nutzen.",
    includedPackageIds: ["core.process", "website.builder", "approval.compliance"],
    recommendedAddOnPackageIds: ["bi.analytics", "service.operations"],
    cta: "Business anfragen",
    highlight: true,
    sort: 20
  },
  {
    id: "scale",
    label: "Scale",
    badge: "Teams",
    price: "1.990 EUR",
    period: "/Monat",
    description: "Für mehrere Bereiche, operative Echtzeit-Prozesse und wiederholbare Rollouts.",
    includedPackageIds: ["core.process", "website.builder", "approval.compliance", "service.operations"],
    recommendedAddOnPackageIds: ["bi.analytics", "sales.crm", "integration.automation"],
    cta: "Scale anfragen",
    sort: 30
  }
]);

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function resolvedPresetLibrary(value) {
  return value ? presetLibrary.validatePresetLibrary(value) : presetLibrary.loadPresetLibraryFile();
}

function packageMapForLibrary(library) {
  return new Map(library.packages.map(item => [item.id, item]));
}

function normalizePackageIds(value, fallback = ["core.process"], packageById) {
  const out = [];
  const push = id => {
    const clean = String(id || "").trim();
    if (packageById.has(clean) && !out.includes(clean)) out.push(clean);
  };
  if (Array.isArray(value)) value.forEach(push);
  if (!out.length && Array.isArray(fallback)) fallback.forEach(push);
  if (out.length) return out;
  return Array.isArray(fallback) && fallback.length === 0 ? [] : ["core.process"];
}

function inferPackageIdsForPreset(preset, packageById) {
  const variant = String((preset.components || []).find(component => component?.type === "daisy")?.variant || "");
  const haystack = `${preset.id || ""} ${preset.title || ""} ${variant}`.toLowerCase();
  const out = [];
  const add = id => { if (packageById.has(id) && !out.includes(id)) out.push(id); };
  if (/(?:^|[\s_-])(?:chart|kpi|stat|table|progress|radial|indicator|pipeline|analyse|analytics)(?:[\s_-]|$)/.test(haystack)) add("bi.analytics");
  if (/toast|loading|timeline|countdown/.test(haystack)) add("service.operations");
  if (/accordion|faq|body_copy|info_note|content_list/.test(haystack)) add("knowledge.portal");
  if (/external_link|content_list/.test(haystack)) add("integration.automation");
  if (/navbar|hero|footer|feature|pricing|card|carousel|image|link|menu|tabs|breadcrumbs|bottom-navigation|content_list/.test(haystack)) add("website.builder");
  if (/task|checklist|file|steps/.test(haystack)) add("approval.compliance");
  if (/input|textarea|select|checkbox|toggle|radio|range|button|modal/.test(haystack)) add("core.process");
  return out.length ? out : ["core.process"];
}

function builtinStateTemplates(libraryValue) {
  const library = resolvedPresetLibrary(libraryValue);
  const packageById = packageMapForLibrary(library);
  const component = (id, type, text = "", url = "", extra = {}) => ({ id, type, text, url, ...extra });
  const daisy = (variant, title, key = variant) => component("builtin_daisy_" + normalizeId(key) + "_component", "daisy", "", "", {
    variant,
    dataPath: stateDataScopeForId(key),
    dataRole: "widget",
    dataLabel: title
  });
  const template = item => ({
    components: [],
    data: {},
    builtIn: true,
    rootStateId: item.id,
    ...item
  });
  const daisyTemplate = spec => {
    const key = normalizeId(spec.id);
    const defaults = normalizeStateDataObject(spec.data);
    const packageIds = normalizePackageIds(spec.packageIds, inferPackageIdsForPreset({
      id: spec.id,
      title: spec.title,
      components: [{ type: "daisy", variant: spec.variant || spec.id }]
    }, packageById), packageById);
    return template({
      id: spec.managed ? spec.id : "builtin_daisy_" + key,
      rootStateId: key,
      title: spec.title,
      description: spec.description || "Komponente mit geteilten Daten dieses Zustands verbunden.",
      builtIn: spec.managed !== true,
      categoryId: spec.categoryId || "websuite-builder",
      packageIds,
      components: [daisy(spec.variant || spec.id, spec.title, spec.id)],
      data: defaults,
      dataTypes: {},
      transitions: Array.isArray(spec.transitions) ? spec.transitions : []
    });
  };
  const officialHeroBody = "Eine klare Einleitung für eine echte Seite, ein Angebot oder einen Prozess mit einem eindeutigen nächsten Schritt.";
  const contentListSampleItems = [
    {
      title: "Starter-Paket",
      description: "Eine klare Angebotskarte mit Bild, Titel, Kurztext und Preis.",
      image: DEFAULT_IMAGE_COMPONENT_URL,
      price: "EUR 29",
      tag: "Beliebt"
    },
    {
      title: "Team-Workshop",
      description: "Ein zweiter Eintrag mit denselben Feldern, bereit für echte API-Daten.",
      image: DEFAULT_IMAGE_COMPONENT_URL,
      price: "EUR 149",
      tag: "Neu"
    }
  ];
  const contentListFetchPath = stateDataScopeForId("content_list") + ".fetch";
  const contentListDataPath = contentListFetchPath + ".data";
  const contentListWire = (id, itemPath, role, componentType, label) => ({
    id,
    sourcePath: contentListDataPath + "." + itemPath,
    scopePath: contentListDataPath,
    itemPath,
    role,
    componentType,
    label
  });
  const featurePresetImages = {
    screens: "https://images.unsplash.com/photo-1497366754035-f200968a6e72?auto=format&fit=crop&w=900&q=80",
    data: "https://images.unsplash.com/photo-1516321318423-f06f85e504b3?auto=format&fit=crop&w=900&q=80",
    events: "https://images.unsplash.com/photo-1518005020951-eccb494ad742?auto=format&fit=crop&w=900&q=80"
  };
  const daisySpecs = [
    { id: "accordion", title: "FAQ-Akkordeon", description: "Aufklappbare FAQ- oder Hilfebereiche aus gemeinsamen Daten.", data: { open: "Versand", items: [{ label: "Versand", body: "Bestellungen werden in der Regel innerhalb von zwei Werktagen versendet." }, { label: "Rückgabe", body: "Kunden können innerhalb von 30 Tagen eine Rückgabe anfragen." }] } },
    { id: "alert", title: "Hinweisbanner", description: "Statusmeldung für Erfolg, Warnung, Info oder Fehler.", data: { tone: "info", message: "Ein neues Software-Update ist verfügbar." } },
    { id: "avatar", title: "Benutzer-Avatar", description: "Benutzerbild, Platzhalter oder Avatar-Gruppe aus gemeinsamen Daten.", data: { name: "Mira Keller", image: "", status: "online", size: "w-16", shape: "rounded-full", ring: true, initials: "MK", avatars: [] } },
    { id: "badge", title: "Status-Badge", description: "Kompaktes Label für Status, Tags oder Zähler.", data: { label: "Neu", tone: "primary" } },
    { id: "bottom-navigation", title: "Mobile Fußnavigation", description: "Touchfreundliche mobile Navigation aus gemeinsamen Daten.", data: { selected: "Start", items: ["Start", "Suche", "Profil"] } },
    { id: "breadcrumbs", title: "Breadcrumb-Pfad", description: "Aktueller Seitenpfad aus strukturierten Einträgen.", data: { items: [{ label: "Start", transitionId: "" }, { label: "Projekte", transitionId: "" }, { label: "Aktuell", transitionId: "" }] } },
    { id: "button", title: "Aktionsbutton", description: "Primäre Schaltfläche, die Klickzustand schreibt oder echte ausgehende Übergänge feuert.", data: { label: "Weiter", clicked: false, clickedAt: 0 } },
    { id: "card", title: "Produktkarte", description: "Bildkarte mit Titel, Kurztext und Aktionsfeld.", data: { title: "Premium-Sneaker", body: "Leichte Schuhe für Alltag, Arbeit und Reisen.", image: "https://img.daisyui.com/images/stock/photo-1606107557195-0e29a4b5b4aa.webp", imageAlt: "Schuhe", actionLabel: "Jetzt kaufen" } },
    { id: "export-image-asset", variant: "card", title: "Exportierbares Bild", description: "Bild-URL im globalen State. Beim HTML-Export wird sie als Data-URI eingebettet, wenn sie erreichbar ist.", packageIds: ["website.builder"], data: { title: "Exportierbares Bild", body: "URL eintragen, Export laden, Bild bleibt in der eigenständigen HTML enthalten.", image: "https://images.unsplash.com/photo-1497366754035-f200968a6e72?auto=format&fit=crop&w=900&q=80", imageAlt: "Bild für self-contained HTML-Export", actionLabel: "" } },
    { id: "feature-grid", title: "Feature-Raster", description: "Responsive Feature-Karten, deren Aktionen echte FSM-Zustände ansteuern.", data: { eyebrow: "Vorteile", heading: "Alles für einen sauberen Ablauf", body: "Nutze diese Vorlage für Produktvorteile, App-Bereiche oder Navigationsteaser.", selected: "", items: [{ title: "Wiederverwendbare Ansichten", body: "Seiten aus Bausteinen zusammensetzen, ohne Verhalten im HTML zu verstecken.", image: featurePresetImages.screens, imageAlt: "Wiederverwendbare Bildschirmbereiche in einem Arbeitsbereich", features: ["Gescopte Zustandsdaten", "Explizite Übergangsaktion"], actionLabel: "Ansichten ansehen", transitionId: "" }, { title: "Datengebundene UI", body: "Felder und Labels lesen aus dem globalen JSON-Bus.", image: featurePresetImages.data, imageAlt: "Dashboard-Daten als Grundlage für UI-Karten", features: ["eine Wahrheit", "In Eigenschaften editierbar"], actionLabel: "Datenfluss ansehen", transitionId: "" }, { title: "FSM-sichere Ereignisse", body: "Schaltflächen feuern nur Übergänge, die wirklich existieren.", image: featurePresetImages.events, imageAlt: "Strukturierte Ereignisverbindungen", features: ["Keine lokale Navigation", "Kein Label-Raten"], actionLabel: "Ereignisse prüfen", transitionId: "" }] } },
    { id: "pricing", title: "Preiskarten", description: "Drei Abo-Karten, deren Schaltflächen auf echte Zustände verdrahtet sind.", data: { selectedPlan: "", plans: [{ title: "Starter", price: "249 EUR", period: "/Monat", body: "Für einzelne Prozesse, schnelle Prototypen und erste digitale Anwendungen.", features: ["Process Core", "1 Prozess-App", "HTML-Export"], actionLabel: "Starter anfragen", transitionId: "" }, { title: "Business", badge: "Beliebt", price: "749 EUR", period: "/Monat", body: "Für Teams, die Abläufe modellieren, prüfen und als Web-App nutzen.", features: ["Website Builder", "Freigaben", "Team-Nutzung"], highlight: true, actionLabel: "Business anfragen", transitionId: "" }, { title: "Scale", badge: "Teams", price: "1.990 EUR", period: "/Monat", body: "Für mehrere Bereiche, operative Ereignisse und wiederholbare Rollouts.", features: ["Service & Operations", "Mehrere Räume", "Add-ons zubuchbar"], actionLabel: "Scale anfragen", transitionId: "" }] } },
    { id: "bi-kpi-board", variant: "chart", title: "BI-KPI-Board", description: "KPI-Karten und Balkenvergleich für Management- und Bereichskennzahlen.", packageIds: ["bi.analytics"], data: { title: "Umsatz & Marge", subtitle: "Monatliche Sicht für Geschäftsführung und Bereichsleitung.", unit: "Tsd. EUR", metrics: [{ label: "Umsatz", value: "428 Tsd. EUR", delta: "+12%" }, { label: "Marge", value: "31%", delta: "+4%" }, { label: "Offene Chancen", value: "86", delta: "-7" }], items: [{ label: "Service", value: 128 }, { label: "Projekt", value: 96 }, { label: "Lizenz", value: 74 }, { label: "Beratung", value: 52 }] } },
    { id: "bi-bar-chart", variant: "chart", title: "Balkendiagramm", description: "Einfaches Chart für Umsatz, Mengen, SLA, Pipeline oder Prozesskennzahlen.", packageIds: ["bi.analytics"], data: { title: "Aufträge nach Status", subtitle: "Aktueller Stand aus dem globalen State.", unit: "Fälle", metrics: [{ label: "Gesamt", value: "184", delta: "+18" }, { label: "Durchlaufzeit", value: "3,2 Tage", delta: "-0,6" }], items: [{ label: "Neu", value: 42 }, { label: "Prüfung", value: 68 }, { label: "Freigabe", value: 31 }, { label: "Erledigt", value: 43 }] } },
    { id: "bi-pipeline-analysis", variant: "chart", title: "Pipeline-Analyse", description: "Sales- und Angebotsübersicht mit Kennzahlen und Fortschrittsbalken.", packageIds: ["bi.analytics", "sales.crm"], data: { title: "Pipeline", subtitle: "Chancen nach Phase und nächstem Schritt.", unit: "Tsd. EUR", metrics: [{ label: "Pipeline", value: "1,28 Mio. EUR", delta: "+9%" }, { label: "Abschlussquote", value: "27%", delta: "+3%" }, { label: "Nächste Aktionen", value: "14", delta: "heute" }], items: [{ label: "Lead", value: 220 }, { label: "Qualifiziert", value: 180 }, { label: "Angebot", value: 310 }, { label: "Verhandlung", value: 145 }] } },
    { id: "carousel", title: "Bildkarussell", description: "Bildindex und Bilder liegen in gemeinsamen Daten.", data: { index: 0, images: ["https://picsum.photos/seed/state-1/640/360", "https://picsum.photos/seed/state-2/640/360", "https://picsum.photos/seed/state-3/640/360"] } },
    { id: "checkbox", title: "Checkbox-Feld", description: "Checkbox-Auswahlen werden gespeichert und können Übergänge steuern.", data: { legend: "Einstellungen", items: [{ label: "Angemeldet bleiben", checked: false }], checked: false } },
    { id: "countdown", title: "Countdown-Timer", description: "Timerwerte laufen in gemeinsamen Daten herunter und können den nächsten Zustand auslösen.", data: { duration: 20, value: 20, label: "Sekunden übrig", running: true, finished: false, startedAt: 0, endsAt: 0 } },
    { id: "drawer", title: "Seitenmenü", description: "Offen- und Auswahlwerte sind gemeinsame Felder.", data: { open: false, title: "Menü", selected: "Posteingang", items: ["Posteingang", "Einstellungen", "Hilfe"] } },
    { id: "dropdown", title: "Auswahlmenü", description: "Die Auswahl wird in gemeinsame Daten geschrieben.", data: { selected: "Option A", options: ["Option A", "Option B", "Option C"], open: false } },
    { id: "file-input", title: "Datei-Upload", description: "Der ausgewählte Dateiname wird in gemeinsame Daten geschrieben.", data: { label: "Datei hochladen", filename: "" } },
    { id: "footer", title: "Fußzeile", description: "Fußzeilen-Spalten, deren Einträge auf echte Zustände verdrahtet werden können.", data: { brand: "Zustand GmbH", note: "Wiederverwendbare Fußzeile aus gescopten Zustandsdaten.", columns: [{ title: "Produkt", items: [{ label: "Vorteile", transitionId: "" }, { label: "Angebot", transitionId: "" }] }, { title: "Unternehmen", items: [{ label: "Kontakt", transitionId: "" }] }] } },
    { id: "hero", title: "Titelbereich", description: "Zentrierter Titelbereich aus Zustandsdaten.", data: { layout: "centered", title: "Mach dein Angebot sichtbar", body: officialHeroBody, actionLabel: "Loslegen" } },
    { id: "hero-figure", variant: "hero", title: "Titelbereich mit Bild", description: "Titelbereich mit Text und Bild.", data: { layout: "figure", title: "Produkt-Update", body: officialHeroBody, actionLabel: "Mehr erfahren", image: "https://img.daisyui.com/images/stock/photo-1635805737707-575885ab0820.webp" } },
    { id: "hero-figure-reverse", variant: "hero", title: "Titelbereich mit Bild rechts", description: "Titelbereich mit Bild und Text in umgekehrter offizieller Zeilenanordnung.", data: { layout: "figure-reverse", title: "Kampagnenstart", body: officialHeroBody, actionLabel: "Plan prüfen", image: "https://img.daisyui.com/images/stock/photo-1635805737707-575885ab0820.webp" } },
    { id: "hero-form", variant: "hero", title: "Titelbereich mit Anmeldeformular", description: "Titelbereich mit E-Mail- und Passwortfeldern aus gemeinsamen Daten.", data: { layout: "form", title: "Im Arbeitsbereich anmelden", body: "E-Mail und Passwort eingeben, um zum Konto zu wechseln.", actionLabel: "Anmelden", emailLabel: "E-Mail", passwordLabel: "Passwort", forgotLabel: "Passwort vergessen?", email: "", password: "" } },
    { id: "hero-overlay", variant: "hero", title: "Titelbereich mit Bildüberlagerung", description: "Inhalt liegt über einem Bild.", data: { layout: "overlay", title: "Plane deine nächste Kampagne", body: officialHeroBody, actionLabel: "Planung starten", image: "https://img.daisyui.com/images/stock/photo-1507358522600-9f71e620c44e.webp" } },
    { id: "indicator", title: "Benachrichtigungs-Badge", description: "Zähler und Label kommen aus gemeinsamen Daten.", data: { label: "Posteingang", count: 3 } },
    { id: "input", title: "Textfeld", description: "Textfeld schreibt den Wert in gemeinsame Daten.", data: { label: "Name", value: "" } },
    { id: "loading", title: "Ladezustand", description: "Ladeanzeige, die über einen echten FSM-Timer-Übergang weiterläuft.", data: { label: "Lädt...", active: true, durationMs: 2000, nextLabel: "Weiter" } },
    { id: "mask", title: "Bildmaske", description: "Bild wird über gemeinsame Daten in eine wiederverwendbare Form geschnitten.", data: { image: "https://img.daisyui.com/images/stock/photo-1635805737707-575885ab0820.webp", alt: "Maskiertes Bild", shape: "squircle" } },
    { id: "menu", title: "Navigationsmenü", description: "Menüauswahl wird in gemeinsamen Daten gespeichert.", data: { selected: "Dashboard", items: ["Dashboard", "Aufgaben", "Einstellungen"] } },
    { id: "modal", title: "Bestätigungsdialog", description: "Öffnungszustand und Bestätigung sind gemeinsame Felder.", data: { open: false, confirmed: false, openLabel: "Dialog öffnen", title: "Aktion bestätigen", body: "Prüfe die Details, bevor du fortfährst.", actionLabel: "Bestätigen", closeLabel: "Schließen" } },
    { id: "navbar-title", variant: "navbar", title: "Kopfleiste einfach", description: "Einfache Marken-Navigationsleiste.", data: { layout: "title-only", brand: "Zustand GmbH" } },
    { id: "navbar-menu-submenu", variant: "navbar", title: "Kopfleiste mit Menü", description: "Navigationsleiste mit Seitenlinks und optionalem Untermenü.", data: { layout: "menu-submenu", brand: "Zustand GmbH", selected: "Dashboard", items: ["Dashboard", "Projekte", "Einstellungen"], parent: "Mehr", submenu: [], submenuOpen: true } },
    { id: "navbar-search-dropdown", variant: "navbar", title: "Kopfleiste Suche/Profil", description: "Navigationsleiste mit Sucheingabe und Profilmenü.", data: { layout: "search-dropdown", brand: "Zustand GmbH", search: "", profileOpen: false, avatar: "https://img.daisyui.com/images/stock/photo-1534528741775-53994a69daeb.webp", menuItems: ["Profil", "Einstellungen", "Abmelden"], badge: "Neu" } },
    { id: "navbar-cart-profile", variant: "navbar", title: "Kopfleiste Shop/Warenkorb", description: "Shop-Navigation mit Warenkorb-Badge und Profilmenü.", data: { layout: "cart-profile", brand: "Zustand Shop", cartOpen: false, profileOpen: false, cartCount: 8, cartLabel: "Artikel", subtotal: "248 EUR", actionLabel: "Warenkorb ansehen", avatar: "https://img.daisyui.com/images/stock/photo-1534528741775-53994a69daeb.webp", menuItems: ["Profil", "Einstellungen", "Abmelden"], badge: "Neu" } },
    { id: "progress", title: "Fortschrittsbalken", description: "Linearer Fortschritt aus Wert- und Max-Feldern.", data: { value: 45, max: 100, label: "Fortschritt" } },
    { id: "radial-progress", title: "Fortschrittsring", description: "Kreisförmiger Fortschritt aus Wert- und Max-Feldern.", data: { value: 66, max: 100, label: "Abgeschlossen" } },
    { id: "radio", title: "Radio-Gruppe", description: "Radio-Auswahl wird in gemeinsamen Daten gespeichert.", data: { label: "Tarif", value: "Team", options: ["Gratis", "Team", "Enterprise"] } },
    { id: "range", title: "Schieberegler", description: "Numerischer Sliderwert wird in gemeinsame Daten geschrieben.", data: { label: "Priorität", value: 40, min: 0, max: 100 } },
    { id: "rating", title: "Sternebewertung", description: "Bewertungswert wird in gemeinsame Daten geschrieben.", data: { label: "Bewertung", value: 3, max: 5 } },
    { id: "select", title: "Auswahlfeld", description: "Auswahlwert wird in gemeinsame Daten geschrieben.", data: { label: "Status", value: "Offen", options: ["Offen", "In Bearbeitung", "Erledigt"] } },
    { id: "stat", title: "Kennzahl", description: "Kennzahl-Titel, Wert und Beschreibung aus gemeinsamen Daten.", data: { title: "Umsatz", value: "12,4 Tsd. EUR", description: "+8% diese Woche" } },
    { id: "steps", title: "Prozessschritte", description: "Prozessleiste mit optionalen echten FSM-Übergängen pro Schritt.", data: { current: "Bauen", items: [{ label: "Planen", description: "Ansicht und Datenvertrag definieren." }, { label: "Bauen", description: "Komponenten mit echten Übergängen verdrahten." }, { label: "Veröffentlichen", description: "Vorschau prüfen, testen und exportieren." }] } },
    { id: "table", title: "Datentabelle", description: "Spalten und Zeilen werden aus gemeinsamen Datenarrays gerendert.", data: { columns: ["Auftrag", "Status"], rows: [["Auftrag #1024", "Bezahlt"], ["Auftrag #1025", "Ausstehend"]] } },
    { id: "tabs", title: "Inhalts-Tabs", description: "Aktiver Tab wird in gemeinsamen Daten gespeichert.", data: { selected: "Übersicht", items: ["Übersicht", "Details", "Aktivität"] } },
    { id: "textarea", title: "Textbereich", description: "Textbereich schreibt den Wert in gemeinsame Daten.", data: { label: "Notizen", value: "" } },
    { id: "timeline", title: "Zeitachse", description: "Timeline-Einträge werden aus gemeinsamen Daten gerendert.", data: { current: "Prüfung", items: [{ title: "Entwurf", body: "Erstellt" }, { title: "Prüfung", body: "In Bearbeitung" }, { title: "Livegang", body: "Ausstehend" }] } },
    { id: "toast", title: "Toast-Meldung", description: "Toast-Sichtbarkeit und Nachricht sind gemeinsame Felder; Ausblenden ist ein echter Timer-Übergang.", data: { visible: true, tone: "info", message: "Neue Nachricht eingetroffen." }, transitions: [{ id: "toast_dismiss", from: "toast", to: "toast", label: "Toast ausblenden", condition: "states.toast.visible == true", triggerType: "timer", timerMs: 3000, set: { "states.toast.visible": false } }] },
    { id: "toggle", title: "Schalter", description: "Schalterwert wird in gemeinsame Daten geschrieben.", data: { legend: "Einstellungen", label: "Angemeldet bleiben", checked: true } }
  ];
  const coreTemplates = [
    template({
      id: "builtin_page_heading",
      title: "Seitenüberschrift",
      description: "Klare Überschrift für Seiten, Dashboards und Formulare.",
      components: [component("builtin_page_heading_component", "heading", "Seitentitel")]
    }),
    template({
      id: "builtin_body_copy",
      title: "Textblock",
      description: "Normaler Text für Hinweise, Erklärungen oder Zusammenfassungen.",
      components: [component("builtin_body_copy_component", "text", "Schreibe hier die hilfreiche Erklärung.")]
    }),
    template({
      id: "builtin_media_image",
      title: "Bildblock",
      description: "Bildbereich für Produkte, Diagramme, Avatare oder Cover.",
      components: [component("builtin_media_image_component", "image", "Bildbeschreibung", DEFAULT_IMAGE_COMPONENT_URL)]
    }),
    template({
      id: "builtin_task_checklist",
      title: "Aufgaben-Checkliste",
      description: "Wiederverwendbare Checkliste für Aufgaben, Onboarding oder Qualitätssicherung.",
      components: [component("builtin_task_checklist_component", "list", "Verantwortung klären\nFrist prüfen\nNachweis anhängen\nErledigt markieren")]
    }),
    template({
      id: "builtin_external_link",
      title: "Externer Link",
      description: "Einzelner Link zu Dokumentation, Support, Kalender oder Download.",
      components: [component("builtin_external_link_component", "link", "Dokumentation öffnen", "https://example.com/docs")]
    }),
    template({
      id: "builtin_info_note",
      title: "Infobox",
      description: "Hervorgehobener Hinweis für Warnungen, Tipps oder nächste Schritte.",
      components: [component("builtin_info_note_component", "note", "Wichtiger Kontext steht hier.")]
    }),
    template({
      id: "builtin_section_divider",
      title: "Abschnittstrenner",
      description: "Visuelle Trennung zwischen dichten Inhaltsgruppen.",
      components: [component("builtin_section_divider_component", "divider")]
    }),
    template({
      id: "builtin_content_list",
      rootStateId: "content_list",
      title: "Inhaltsliste",
      description: "Kartenliste aus Beispieldaten oder aus einem JSON-Endpunkt.",
      components: [],
      data: {
        fetch: {
          status: "sample",
          loading: false,
          done: true,
          ok: true,
          data: contentListSampleItems,
          error: "",
          statusCode: 0,
          count: contentListSampleItems.length,
          url: ""
        }
      },
      dataTypes: { fetch: "object" },
      dataWires: [
        contentListWire("builtin_content_list_image", "image", "image", "image", "Bild"),
        contentListWire("builtin_content_list_title", "title", "title", "heading", "Titel"),
        contentListWire("builtin_content_list_description", "description", "description", "text", "Beschreibung"),
        contentListWire("builtin_content_list_price", "price", "price", "text", "Preis")
      ],
      dataSource: {
        url: "",
        target: contentListFetchPath,
        select: "",
        timeoutMs: 8000,
        retries: 2
      },
      repeat: { path: contentListDataPath, as: "item", index: "i", manual: true }
    })
  ];
  const builtins = [...daisySpecs.map(daisyTemplate), ...coreTemplates];
  builtins.forEach(preset => {
    preset.categoryId = "websuite-builder";
    preset.packageIds = normalizePackageIds(preset.packageIds, inferPackageIdsForPreset(preset, packageById), packageById);
  });
  const managed = library.presets.map(spec => daisyTemplate({ ...spec, managed: true }));
  return [...builtins, ...managed];
}


function normalizeDataTypePath(path) {
  const text = String(path || "").trim();
  return /^[a-zA-Z_][a-zA-Z0-9_]*(?:\.[a-zA-Z_][a-zA-Z0-9_]*)*$/.test(text) ? text : "";
}

function valueAtPath(data, path) {
  const parts = String(path || "").split(".").filter(Boolean);
  let cursor = data;
  for (const part of parts) {
    if (!cursor || typeof cursor !== "object" || !Object.hasOwn(cursor, part)) return undefined;
    cursor = cursor[part];
  }
  return cursor;
}

function inferValueType(path, value) {
  const key = String(path || "").toLowerCase();
  if (typeof value === "boolean") return "boolean";
  if (typeof value === "number") return "number";
  if (Array.isArray(value)) return "list";
  if (isPlainObject(value)) return "object";
  if (/email/.test(key)) return "email";
  if (/(?:^|\.)(?:url|link|href|endpoint)$/.test(key)) return "url";
  if (/(?:^|\.)(?:image|avatar)$/.test(key)) return "image";
  return "text";
}

function collectLocalFieldTypes(data, explicitTypes = {}) {
  const cleanData = normalizeStateDataObject(data);
  const out = {};
  const explicit = isPlainObject(explicitTypes) ? explicitTypes : {};
  function visit(value, path) {
    if (!path) {
      if (isPlainObject(value)) {
        for (const [key, child] of Object.entries(value)) visit(child, key);
      }
      return;
    }
    const explicitType = valueTypes.normalizeValueType(explicit[path]);
    out[path] = explicitType || inferValueType(path, value);
    if (isPlainObject(value)) {
      for (const [key, child] of Object.entries(value)) visit(child, path + "." + key);
    }
  }
  visit(cleanData, "");
  for (const [rawPath, rawType] of Object.entries(explicit)) {
    const path = normalizeDataTypePath(rawPath);
    const type = valueTypes.normalizeValueType(rawType);
    if (path && type && valueAtPath(cleanData, path) !== undefined) out[path] = type;
  }
  return out;
}

function absoluteFieldTypes(rootStateId, localFieldTypes, hasData) {
  const root = stateDataScopeForId(rootStateId);
  const out = hasData ? { [root]: "object" } : {};
  for (const [path, type] of Object.entries(localFieldTypes || {})) out[root + "." + path] = type;
  return out;
}

function normalizePreset(preset, library) {
  const packageById = packageMapForLibrary(library);
  const rootStateId = normalizeId(preset.rootStateId || preset.id || "preset");
  const data = normalizeStateDataObject(preset.data);
  const dataTypes = collectLocalFieldTypes(data, preset.dataTypes);
  const hasData = Object.keys(data).length > 0;
  const fieldTypes = absoluteFieldTypes(rootStateId, dataTypes, hasData);
  const fields = Object.keys(fieldTypes);
  const packageIds = normalizePackageIds(preset.packageIds, inferPackageIdsForPreset(preset, packageById), packageById);
  const primaryPackageId = packageIds[0] || "core.process";
  return {
    builtIn: true,
    ...preset,
    rootStateId,
    data,
    dataTypes,
    categoryId: preset.categoryId,
    packageIds,
    primaryPackageId,
    commercial: {
      packageIds,
      primaryPackageId,
      packageLabels: packageIds.map(id => packageById.get(id)?.label || id),
      addOn: packageIds.some(id => packageById.get(id)?.upsell === true)
    },
    stateContribution: {
      id: String(preset.id || rootStateId),
      source: "preset",
      root: stateDataScopeForId(rootStateId),
      fields,
      fieldTypes,
      fieldSchemas: valueTypes.fieldSchemasFromTypeMap(fieldTypes)
    }
  };
}

function presetCatalogResponse(libraryValue) {
  const library = resolvedPresetLibrary(libraryValue);
  return builtinStateTemplates(library).map(preset => normalizePreset(preset, library));
}

function presetCategoriesResponse(libraryValue) {
  return resolvedPresetLibrary(libraryValue).categories.map(cloneJson);
}

function presetPackagesResponse(libraryValue) {
  const library = resolvedPresetLibrary(libraryValue);
  const packageById = packageMapForLibrary(library);
  const presets = presetCatalogResponse(library);
  return library.packages
    .map(item => {
      const presetIds = presets
        .filter(preset => Array.isArray(preset.packageIds) && preset.packageIds.includes(item.id))
        .map(preset => preset.id);
      const includedInPlanIds = SUBSCRIPTION_PLANS
        .filter(plan => normalizePackageIds(plan.includedPackageIds, [], packageById).includes(item.id))
        .map(plan => plan.id);
      return {
        ...cloneJson(item),
        includedInPlanIds,
        presetIds,
        presetCount: presetIds.length
      };
    })
    .sort((a, b) => a.sort - b.sort);
}

function subscriptionPlansResponse(libraryValue) {
  const library = resolvedPresetLibrary(libraryValue);
  const packageById = packageMapForLibrary(library);
  return SUBSCRIPTION_PLANS
    .map(plan => {
      const includedPackageIds = normalizePackageIds(plan.includedPackageIds, [], packageById);
      const recommendedAddOnPackageIds = normalizePackageIds(plan.recommendedAddOnPackageIds, [], packageById);
      return {
        ...cloneJson(plan),
        includedPackageIds,
        recommendedAddOnPackageIds,
        includedPackages: includedPackageIds.map(id => cloneJson(packageById.get(id))).filter(Boolean),
        recommendedAddOns: recommendedAddOnPackageIds.map(id => cloneJson(packageById.get(id))).filter(Boolean)
      };
    })
    .sort((a, b) => a.sort - b.sort);
}

module.exports = {
  builtinStateTemplates,
  collectLocalFieldTypes,
  presetCatalogResponse,
  presetCategoriesResponse,
  presetPackagesResponse,
  subscriptionPlansResponse
};

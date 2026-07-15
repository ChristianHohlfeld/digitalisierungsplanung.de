"use strict";

const appDir = process.env.APP_DIR || "/var/www/digitalisierungsplanung.de";
const envFile = process.env.ENV_FILE || "/etc/digitalisierungsplanung-realtime.env";
const appName = process.env.PM2_APP || "digitalisierungsplanung-realtime";

module.exports = {
  apps: [
    {
      name: appName,
      script: "server/run.sh",
      interpreter: "bash",
      cwd: appDir,
      instances: 1,
      exec_mode: "fork",
      watch: false,
      max_memory_restart: "256M",
      env: {
        NODE_ENV: "production",
        REALTIME_HOST: "127.0.0.1",
        REALTIME_PORT: "8788",
        REALTIME_PATH: "/ws",
        REALTIME_ADMIN_PATH: "/admin.html",
        REALTIME_ADMIN_ROUTES_PATH: "/admin/routes",
        REALTIME_ENV_FILE: envFile,
        REALTIME_ALLOWED_ORIGINS: "https://digitalisierungsplanung.de",
        REALTIME_EVENT_CATALOG_PATH: process.env.REALTIME_EVENT_CATALOG_PATH || `${appDir}/server/event-catalog.json`,
        REALTIME_PRESET_LIBRARY_PATH: process.env.REALTIME_PRESET_LIBRARY_PATH || `${appDir}/server/preset-library.json`,
        REALTIME_PRESETS_ADMIN_IMPORT_PATH: "/presets-admin/import",
        REALTIME_REPO_DIR: process.env.REALTIME_REPO_DIR || appDir,
        REALTIME_MAX_PAYLOAD_BYTES: "65536",
        REALTIME_RATE_LIMIT: "360",
        REALTIME_RATE_WINDOW_MS: "10000",
        REALTIME_HEARTBEAT_MS: "30000",
        PILOT_ENABLED: "true",
        PILOT_DATA_DIR: process.env.PILOT_DATA_DIR || "/var/lib/digitalisierungsplanung-pilot",
        PILOT_BACKUP_DIR: process.env.PILOT_BACKUP_DIR || "/mnt/digitalisierungsplanung-pilot-backups",
        PILOT_REQUIRE_EXTERNAL_BACKUP: process.env.PILOT_REQUIRE_EXTERNAL_BACKUP || "true",
        PILOT_BACKUP_SIGNING_KEY: process.env.PILOT_BACKUP_SIGNING_KEY || "",
        PILOT_MAX_PROJECTS_PER_ORGANIZATION: process.env.PILOT_MAX_PROJECTS_PER_ORGANIZATION || "100",
        PILOT_MAX_VERSIONS_PER_PROJECT: process.env.PILOT_MAX_VERSIONS_PER_PROJECT || "200",
        PILOT_MAX_TENANT_BYTES: process.env.PILOT_MAX_TENANT_BYTES || "104857600",
        PILOT_ADMIN_PATH: "/pilot-admin.html",
        PILOT_STUDIO_PATH: "/studio.html",
        ZUSTAND_RELEASE_FILE: process.env.ZUSTAND_RELEASE_FILE || `${appDir}/release-version.js`,
        ZUSTAND_RELEASE_ID: process.env.ZUSTAND_RELEASE_ID || "",
        ZUSTAND_RELEASE_SEQUENCE: process.env.ZUSTAND_RELEASE_SEQUENCE || "0",
        ZUSTAND_RELEASE_BUILT_AT: process.env.ZUSTAND_RELEASE_BUILT_AT || "",
        ZUSTAND_RELEASE_SOURCE: process.env.ZUSTAND_RELEASE_SOURCE || "",
        ZUSTAND_DEPLOY_COMMIT: process.env.ZUSTAND_DEPLOY_COMMIT || ""
      }
    }
  ]
};

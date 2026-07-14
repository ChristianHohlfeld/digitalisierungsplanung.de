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
        REALTIME_REPO_DIR: process.env.REALTIME_REPO_DIR || appDir,
        REALTIME_MAX_PAYLOAD_BYTES: "65536",
        REALTIME_RATE_LIMIT: "360",
        REALTIME_RATE_WINDOW_MS: "10000",
        REALTIME_HEARTBEAT_MS: "30000",
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

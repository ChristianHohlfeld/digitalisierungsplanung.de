"use strict";

const appDir = process.env.APP_DIR || "/var/www/digitalisierungsplanung.de";
const appName = process.env.PM2_APP || "digitalisierungsplanung-flow-runtime";
const stateDir = process.env.STATE_BLUEPRINT_STATE_DIR || "/var/lib/digitalisierungsplanung";
const envFile = process.env.ENV_FILE || process.env.REALTIME_ENV_FILE || "/etc/digitalisierungsplanung-realtime.env";

module.exports = {
  apps: [{
    name: appName,
    script: "server/run.sh",
    interpreter: "bash",
    cwd: appDir,
    instances: 1,
    exec_mode: "fork",
    watch: false,
    max_memory_restart: "1024M",
    env: {
      NODE_ENV: "production",
      APP_HOST: "127.0.0.1",
      APP_PORT: "8788",
      REALTIME_ENV_FILE: envFile,
      ALLOWED_ORIGINS: "https://digitalisierungsplanung.de,https://www.digitalisierungsplanung.de",
      PLAYWRIGHT_BROWSERS_PATH: process.env.PLAYWRIGHT_BROWSERS_PATH || `${stateDir}/playwright`,
      RECORDER_SESSION_TTL_MS: process.env.RECORDER_SESSION_TTL_MS || "900000",
      RECORDER_MAX_SESSIONS: process.env.RECORDER_MAX_SESSIONS || "4",
      RECORDER_MAX_SESSIONS_PER_CLIENT: process.env.RECORDER_MAX_SESSIONS_PER_CLIENT || "1",
      ZUSTAND_RELEASE_FILE: process.env.ZUSTAND_RELEASE_FILE || `${appDir}/release-version.js`,
      ZUSTAND_RELEASE_ID: process.env.ZUSTAND_RELEASE_ID || "",
      ZUSTAND_RELEASE_SEQUENCE: process.env.ZUSTAND_RELEASE_SEQUENCE || "0",
      ZUSTAND_RELEASE_BUILT_AT: process.env.ZUSTAND_RELEASE_BUILT_AT || "",
      ZUSTAND_RELEASE_SOURCE: process.env.ZUSTAND_RELEASE_SOURCE || "",
      ZUSTAND_DEPLOY_COMMIT: process.env.ZUSTAND_DEPLOY_COMMIT || ""
    }
  }]
};

"use strict";

module.exports = {
  apps: [
    {
      name: "digitalisierungsplanung-realtime",
      script: "server/server.js",
      cwd: "/var/www/digitalisierungsplanung.de",
      instances: 1,
      exec_mode: "fork",
      watch: false,
      max_memory_restart: "256M",
      env: {
        NODE_ENV: "production",
        REALTIME_HOST: "127.0.0.1",
        REALTIME_PORT: "8788",
        REALTIME_PATH: "/ws",
        REALTIME_ALLOWED_ORIGINS: "https://digitalisierungsplanung.de",
        REALTIME_MAX_PAYLOAD_BYTES: "65536",
        REALTIME_RATE_LIMIT: "360",
        REALTIME_RATE_WINDOW_MS: "10000",
        REALTIME_HEARTBEAT_MS: "30000"
      }
    }
  ]
};

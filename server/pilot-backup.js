"use strict";

const path = require("node:path");
const { PilotStore } = require("./pilot-store");

async function main() {
  const configuredDataDir = String(process.env.PILOT_DATA_DIR || "").trim();
  const configuredBackupDir = String(process.env.PILOT_BACKUP_DIR || "").trim();
  const backupSigningKey = String(process.env.PILOT_BACKUP_SIGNING_KEY || "");
  if (!configuredDataDir) throw new Error("PILOT_DATA_DIR is required; refusing to use an implicit data directory");
  if (!configuredBackupDir) throw new Error("PILOT_BACKUP_DIR is required and must point to a separate backup volume");
  if (Buffer.byteLength(backupSigningKey) < 32) throw new Error("PILOT_BACKUP_SIGNING_KEY must contain at least 32 bytes");
  const store = new PilotStore({
    dataDir: path.resolve(configuredDataDir),
    backupDir: path.resolve(configuredBackupDir),
    requireExternalBackup: true,
    backupSigningKey
  });
  await store.ready();
  if (!store.backupStorageSeparated || !store.backupStorageDeviceSeparated) {
    throw new Error("PILOT_BACKUP_DIR must be an available external filesystem outside PILOT_DATA_DIR");
  }
  const action = String(process.env.PILOT_BACKUP_ACTION || "backup").trim().toLowerCase();
  const requestedOrganizationId = String(process.env.PILOT_ORGANIZATION_ID || "").trim();
  const organizations = (await store.listOrganizations())
    .filter(organization => !requestedOrganizationId || organization.id === requestedOrganizationId);
  if (requestedOrganizationId && !organizations.length) throw new Error("PILOT_ORGANIZATION_ID was not found");
  if (action === "inspect" || action === "restore") {
    if (organizations.length !== 1) throw new Error(`${action} requires exactly one PILOT_ORGANIZATION_ID`);
    const backupId = String(process.env.PILOT_BACKUP_ID || "").trim();
    if (!backupId) throw new Error("PILOT_BACKUP_ID is required");
    const organizationId = organizations[0].id;
    if (action === "inspect") {
      const result = await store.inspectOrganizationBackup(organizationId, backupId);
      process.stdout.write(`${JSON.stringify({ ok: true, action, organizationId, backup: result }, null, 2)}\n`);
      return;
    }
    if (process.env.PILOT_RESTORE_CONFIRM !== `RESTORE ${backupId}`) {
      throw new Error(`PILOT_RESTORE_CONFIRM must equal RESTORE ${backupId}`);
    }
    const ready = await store.ready();
    const result = await store.restoreOrganizationBackup(organizationId, null, backupId, {
      expectedDatabaseRevision: ready.revision,
      dryRun: String(process.env.PILOT_RESTORE_DRY_RUN || "").toLowerCase() === "true"
    });
    process.stdout.write(`${JSON.stringify({ ok: true, action, organizationId, ...result }, null, 2)}\n`);
    return;
  }
  if (action !== "backup") throw new Error("PILOT_BACKUP_ACTION must be backup, inspect or restore");
  const backups = [];
  for (const organization of organizations) {
    backups.push({
      organizationId: organization.id,
      organizationName: organization.name,
      ...await store.createOrganizationBackup(organization.id, null, { recordAudit: false })
    });
  }
  process.stdout.write(`${JSON.stringify({ ok: true, backups }, null, 2)}\n`);
}

if (require.main === module) {
  main().catch(error => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}

module.exports = { main };

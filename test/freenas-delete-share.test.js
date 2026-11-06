// deleteShare must fail, not skip, when TrueNAS answers the lookup with an
// error such as 401: the zvol gets destroyed next and the share would leak
const assert = require("node:assert");
const { test } = require("node:test");
const { FreeNASSshDriver } = require("../src/driver/freenas/ssh");
const { Registry } = require("../src/utils/registry");

function driverWith(getStatus) {
  const deletes = [];
  const props = {
    "democratic-csi:freenas_iscsi_target_id": { value: "7" },
    "democratic-csi:freenas_iscsi_extent_id": { value: "9" },
    "democratic-csi:freenas_iscsi_targettoextent_id": { value: "11" },
    "democratic-csi:freenas_iscsi_assets_name": { value: "csi-pvc-1" },
  };
  class TestDriver extends FreeNASSshDriver {
    getDriverShareType() {
      return "iscsi";
    }
    async getHttpClient() {
      return {
        getApiVersion: () => 2,
        get: async (endpoint) => {
          const statusCode = getStatus(endpoint);
          return { statusCode, body: statusCode == 200 ? { id: 7, name: "csi-pvc-1" } : { message: "denied" } };
        },
        delete: async (endpoint) => {
          deletes.push(endpoint);
          return { statusCode: 200, body: true };
        },
      };
    }
    async getTrueNASHttpApiClient() {
      return { getSystemVersionSemver: async () => "13.3.0", getIsScale: async () => false };
    }
    async getZetabyte() {
      return {
        zfs: { get: async (name) => ({ [name]: props }), inherit: async () => {} },
        helpers: { isPropertyValueSet: (v) => v !== undefined && v !== null && v !== "" && v !== "-" },
      };
    }
  }
  const noop = () => {};
  const logger = { error: noop, warn: noop, info: noop, verbose: noop, debug: noop, silly: noop };
  const driver = new TestDriver(
    { logger, args: { csiMode: ["controller"] }, registry: new Registry() },
    { driver: "freenas-iscsi", zfs: { datasetParentName: "tank/k8s/v" }, iscsi: {} }
  );
  return { driver, deletes };
}

test("401 on the target lookup fails the delete", async () => {
  const { driver, deletes } = driverWith(() => 401);
  await assert.rejects(driver.deleteShare({ request: {} }, "tank/k8s/v/pvc-1"), (err) => /code: 401/.test(err.message));
  assert.deepEqual(deletes, []);
});

test("404 means already gone", async () => {
  const { driver, deletes } = driverWith(() => 404);
  await driver.deleteShare({ request: {} }, "tank/k8s/v/pvc-1");
  assert.deepEqual(deletes, []);
});

test("200 with a matching name deletes", async () => {
  const { driver, deletes } = driverWith(() => 200);
  await driver.deleteShare({ request: {} }, "tank/k8s/v/pvc-1");
  assert.ok(deletes.includes("/iscsi/target/id/7"), JSON.stringify(deletes));
});

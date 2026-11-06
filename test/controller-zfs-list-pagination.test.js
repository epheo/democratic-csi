// continuation pages of ListVolumes/ListSnapshots come from the cached first
// listing; a page must carry a token exactly when entries remain after it
const assert = require("node:assert");
const { test } = require("node:test");
const { ControllerZfsBaseDriver } = require("../src/driver/controller-zfs");
const { Registry } = require("../src/utils/registry");

function driverWithCached(n) {
  const entries = Array.from({ length: n }, (_, i) => ({ id: i }));
  class TestDriver extends ControllerZfsBaseDriver {
    getDriverZfsResourceType() {
      return "volume";
    }
    async getZetabyte() {
      return {};
    }
  }
  const noop = () => {};
  const logger = { error: noop, warn: noop, info: noop, verbose: noop, debug: noop, silly: noop };
  return new TestDriver(
    { logger, args: { csiMode: ["controller"] }, registry: new Registry(), cache: { get: () => entries } },
    { driver: "test", zfs: { datasetParentName: "tank/k8s/v", detachedSnapshotsDatasetParentName: "tank/k8s/s" } }
  );
}

async function walk(driver, method, total, max) {
  const ids = [];
  let token = `u:${max}`;
  ids.push(...Array.from({ length: max }, (_, i) => i)); // first page, served by the uncached path
  for (let pages = 0; token && pages < total; pages++) {
    const r = await driver[method]({ request: { max_entries: max, starting_token: token } });
    ids.push(...r.entries.map((e) => e.id));
    token = r.next_token;
  }
  return { ids, token };
}

for (const method of ["ListVolumes", "ListSnapshots"]) {
  for (const [total, max] of [
    [25, 10],
    [15, 10],
    [20, 10],
  ]) {
    test(`${method}: ${total} entries, ${max} per page, all returned once`, async () => {
      const { ids, token } = await walk(driverWithCached(total), method, total, max);
      assert.deepEqual(ids, Array.from({ length: total }, (_, i) => i));
      assert.equal(token, null);
    });
  }
}

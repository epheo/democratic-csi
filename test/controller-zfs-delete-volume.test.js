const assert = require("node:assert");
const { EventEmitter } = require("node:events");
const { test } = require("node:test");
const { ControllerZfsBaseDriver } = require("../src/driver/controller-zfs");
const { Zetabyte } = require("../src/utils/zfs");
const { Registry } = require("../src/utils/registry");

const MANAGED = "democratic-csi:managed_resource";
const CSI_NAME = "democratic-csi:csi_snapshot_name";
const VOLUME = "tank/k8s/v/pvc-1";

// what zfs reports for snapshots of VOLUME
const PERIODIC = {
  name: "hourly-2026-11-06_10-00",
  managed: "true",
  source: `inherited from ${VOLUME}`,
  csiName: "-",
};
const CSI = {
  name: "snapshot-1",
  managed: "true",
  source: "local",
  csiName: "snapshot-1",
};

// answers zfs get/list like the cli would; destroy just succeeds
function fakeExecutor(snapshots, calls) {
  return {
    spawn(command, args) {
      calls.push(args.join(" "));
      const child = new EventEmitter();
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();
      child.kill = () => {};
      const ds = args[args.length - 1];
      let rows = [];
      if (args[0] == "get" && args.includes("snapshot")) {
        rows = snapshots.map((s) => [`${ds}@${s.name}`, MANAGED, s.managed, "-", s.source]);
      } else if (args[0] == "get") {
        rows = args[args.length - 2]
          .split(",")
          .map((p) => [ds, p, "-", "-", "-"]);
      } else if (args[0] == "list") {
        const cols = args[args.indexOf("-o") + 1].split(",");
        const value = { name: (s) => `${ds}@${s.name}`, [MANAGED]: (s) => s.managed, [CSI_NAME]: (s) => s.csiName };
        rows = snapshots.map((s) => cols.map((c) => (value[c] ? value[c](s) : "-")));
      }
      setImmediate(() => {
        if (rows.length) child.stdout.emit("data", rows.map((r) => r.join("\t")).join("\n") + "\n");
        child.emit("close", 0);
      });
      return child;
    },
  };
}

async function deleteVolume(snapshots) {
  const calls = [];
  const zb = new Zetabyte({ executor: fakeExecutor(snapshots, calls), idempotent: true });
  class TestDriver extends ControllerZfsBaseDriver {
    getDriverZfsResourceType() {
      return "filesystem";
    }
    async getZetabyte() {
      return zb;
    }
    async deleteShare() {}
  }
  const noop = () => {};
  const logger = { error: noop, warn: noop, info: noop, verbose: noop, debug: noop, silly: noop };
  const driver = new TestDriver(
    { logger, args: { csiMode: ["controller"] }, registry: new Registry() },
    { driver: "test", zfs: { datasetParentName: "tank/k8s/v", detachedSnapshotsDatasetParentName: "tank/k8s/s" } }
  );
  let error;
  try {
    await driver.DeleteVolume({ request: { volume_id: "pvc-1" } });
  } catch (err) {
    error = err;
  }
  return { error, destroyed: calls.some((c) => c.startsWith("destroy")) };
}

test("only periodic snapshots: delete proceeds", async () => {
  const r = await deleteVolume([PERIODIC, { ...PERIODIC, name: "daily-2026-11-06_00-00" }]);
  assert.strictEqual(r.error, undefined);
  assert.ok(r.destroyed);
});

test("a VolumeSnapshot: delete refused", async () => {
  const r = await deleteVolume([CSI]);
  assert.match(String(r.error && r.error.message), /dependent snapshots/);
  assert.ok(!r.destroyed);
});

test("periodic and VolumeSnapshot: delete refused", async () => {
  const r = await deleteVolume([PERIODIC, CSI]);
  assert.match(String(r.error && r.error.message), /dependent snapshots/);
  assert.ok(!r.destroyed);
});

// only an explicitly inherited value is skipped; anything else must keep blocking
test("managed snapshot with a non-inherited source: delete refused", async () => {
  const r = await deleteVolume([{ ...PERIODIC, name: "replicated-1", source: "received" }]);
  assert.match(String(r.error && r.error.message), /dependent snapshots/);
  assert.ok(!r.destroyed);
});

// pins the @kubernetes/client-node call shapes: major versions changed
// positional args to objects and dropped the .body wrapper
const assert = require("node:assert");
const http = require("node:http");
const { test } = require("node:test");
const k8s = require("@kubernetes/client-node");
const { CsiBaseDriver } = require("../src/driver");
const { Registry } = require("../src/utils/registry");

const pv = (name, csi) => ({ metadata: { name }, spec: csi ? { csi } : { nfs: { server: "nas", path: "/x" } } });
const pages = {
  "": { items: [pv("in-tree"), pv("other", { driver: "other.csi", volumeHandle: "pvc-1" })], metadata: { continue: "page2" } },
  page2: { items: [pv("ours", { driver: "org.test.csi", volumeHandle: "pvc-1", volumeAttributes: { node_attach_driver: "iscsi" } })], metadata: {} },
};

async function withApiServer(fn) {
  const requests = [];
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, "http://x");
    requests.push(url.pathname + url.search);
    let body;
    if (url.pathname == "/api/v1/persistentvolumes") {
      body = { kind: "PersistentVolumeList", apiVersion: "v1", ...pages[url.searchParams.get("continue") || ""] };
    } else if (url.pathname == "/api/v1/namespaces/ns1/persistentvolumeclaims/claim1") {
      body = { kind: "PersistentVolumeClaim", apiVersion: "v1", metadata: { name: "claim1", annotations: { "democratic-csi.org/config": "zfs: {}" } } };
    }
    res.writeHead(body ? 200 : 404, { "content-type": "application/json" });
    res.end(JSON.stringify(body || { kind: "Status", code: 404 }));
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const kc = new k8s.KubeConfig();
  kc.loadFromOptions({
    clusters: [{ name: "c", server: `http://127.0.0.1:${server.address().port}`, skipTLSVerify: true }],
    users: [{ name: "u" }],
    contexts: [{ name: "x", cluster: "c", user: "u" }],
    currentContext: "x",
  });
  const noop = () => {};
  const driver = new CsiBaseDriver(
    { logger: { error: noop, warn: noop, info: noop, verbose: noop, debug: noop, silly: noop }, args: { csiName: "org.test.csi" }, registry: new Registry() },
    { _private: { csi: { volume: { volumeContext: { driver: "kubernetes" } } } } }
  );
  driver.getDefaultKubernetsConfigInstance = () => kc;
  try {
    await fn(driver, requests);
  } finally {
    server.close();
  }
}

test("PVC read returns the object", () =>
  withApiServer(async (driver) => {
    const pvc = await driver.getPersistentVolumeClaim("claim1", "ns1");
    assert.equal(pvc.metadata.annotations["democratic-csi.org/config"], "zfs: {}");
  }));

test("PV lookup pages with continue and skips non-csi PVs", () =>
  withApiServer(async (driver, requests) => {
    const ctx = await driver.getDerivedVolumeContext({ request: { volume_id: "pvc-1" } });
    assert.deepEqual(ctx, { node_attach_driver: "iscsi" });
    assert.deepEqual(requests, ["/api/v1/persistentvolumes", "/api/v1/persistentvolumes?continue=page2"]);
  }));

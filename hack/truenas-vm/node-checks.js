// usage: node node-checks.js <port forwarded to the plugin>; run by node-checks.sh
// NodeUnstage on a staged xfs iSCSI volume must never log out under a mounted fs
const path = require("path");
const { execFileSync } = require("child_process");
const grpc = require("@grpc/grpc-js");
const protoLoader = require("@grpc/proto-loader");

const [port] = process.argv.slice(2);
const def = protoLoader.loadSync(path.join(__dirname, "../../csi_proto/csi-v1.9.0.proto"), {
  keepCase: true, longs: String, enums: String, defaults: true, oneofs: true,
});
const v1 = grpc.loadPackageDefinition(def).csi.v1;
const ctrl = new v1.Controller(`127.0.0.1:${port}`, grpc.credentials.createInsecure());
const node = new v1.Node(`127.0.0.1:${port}`, grpc.credentials.createInsecure());
const call = (c, m, req, ms = 120000) => new Promise((res) =>
  c[m](req, { deadline: new Date(Date.now() + ms) }, (err, r) => res(err ? { err: `${grpc.status[err.code]}: ${err.details}`.slice(0, 120) } : r)));
const sh = (cmd) => {
  try {
    return execFileSync(path.join(__dirname, "node-ssh.sh"), [cmd], { encoding: "utf8" }).trim();
  } catch (e) {
    return `ERR ${String(e.stderr || e.message).trim().slice(0, 120)}`;
  }
};
const cap = { access_mode: { mode: "SINGLE_NODE_WRITER" }, mount: { fs_type: "xfs" }, access_type: "mount" };
const out = (k, v) => console.log(`${k}: ${v}`);
const sessions = () => sh("iscsiadm -m session 2>/dev/null | wc -l");
const shutdowns = () => Number(sh("dmesg | grep -cE 'Filesystem has been shut down|shut ?down requested|lost sync page write' || true"));
const unstage = (t, ms) => call(node, "NodeUnstageVolume", { volume_id: t.id, staging_target_path: `${t.d}/stage` }, ms);

async function staged(name) {
  const d = `/var/lib/csi-sanity/checks-${name}`;
  sh(`mkdir -p ${d}/stage ${d}/target`);
  const v = await call(ctrl, "CreateVolume", { name: `node-checks-${name}`, volume_capabilities: [cap], capacity_range: { required_bytes: 1073741824 } });
  if (v.err) throw new Error(`create: ${v.err}`);
  const id = v.volume.volume_id;
  const base = { volume_id: id, staging_target_path: `${d}/stage`, volume_capability: cap, volume_context: v.volume.volume_context, publish_context: {} };
  for (const [m, req] of [["NodeStageVolume", base], ["NodePublishVolume", { ...base, target_path: `${d}/target` }]]) {
    const r = await call(node, m, req);
    if (r.err) throw new Error(`${m}: ${r.err}`);
  }
  sh(`dd if=/dev/urandom of=${d}/target/data bs=1M count=20 status=none`);
  const u = await call(node, "NodeUnpublishVolume", { volume_id: id, target_path: `${d}/target` });
  if (u.err) throw new Error(`unpublish: ${u.err}`);
  return { id, d };
}

async function cleanup(t) {
  await unstage(t);
  sh(`findmnt -rn -o TARGET | grep '^${t.d}' | sort -r | xargs -r -n1 umount -l; rm -rf ${t.d}`);
  await call(ctrl, "DeleteVolume", { volume_id: t.id });
}

(async () => {
  // a leftover publish or a manual mount still uses the device
  let t = await staged("a");
  let before = shutdowns();
  sh(`mkdir -p ${t.d}/extra && mount --bind ${t.d}/stage ${t.d}/extra`);
  out("leftover mount: NodeUnstage (want FAILED_PRECONDITION)", (await unstage(t)).err || "ok");
  out("leftover mount: iscsi sessions (want 1)", sessions());
  out("leftover mount: other mount readable (want yes)", sh(`ls ${t.d}/extra/data >/dev/null 2>&1 && echo yes || echo no`));
  out("leftover mount: fs shutdown kernel lines (want 0)", shutdowns() - before);
  sh(`umount ${t.d}/extra`);
  out("leftover mount: NodeUnstage once released (want ok)", (await unstage(t)).err || "ok");
  out("leftover mount: iscsi sessions after (want 0)", sessions());
  await cleanup(t);

  // a host process keeps the staging mount busy
  t = await staged("b");
  before = shutdowns();
  sh(`nohup sh -c 'cd ${t.d}/stage && exec sleep 300' >/dev/null 2>&1 & echo $! > /tmp/node-checks-holder`);
  out("busy staging: NodeUnstage (want target is busy)", (await unstage(t)).err || "ok");
  out("busy staging: iscsi sessions (want 1)", sessions());
  out("busy staging: fs shutdown kernel lines (want 0)", shutdowns() - before);
  sh("kill $(cat /tmp/node-checks-holder) 2>/dev/null; rm -f /tmp/node-checks-holder");
  out("busy staging: NodeUnstage once released (want ok)", (await unstage(t)).err || "ok");
  out("busy staging: iscsi sessions after (want 0)", sessions());
  await cleanup(t);

  // the iscsi session went away underneath: device gone, mount stale
  t = await staged("c");
  sh("iscsiadm -m node -U all >/dev/null 2>&1");
  out("device gone: NodeUnstage (want ok)", (await unstage(t, 60000)).err || "ok");
  out("device gone: staging still mounted (want no)", sh(`findmnt -rn ${t.d}/stage >/dev/null && echo yes || echo no`));
  await cleanup(t);
  process.exit(0);
})().catch((e) => {
  console.log("aborted:", e.message);
  process.exit(1);
});

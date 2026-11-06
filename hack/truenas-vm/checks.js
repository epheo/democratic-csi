// usage: node checks.js <port> <datasetParentName>; run by checks.sh
// config must set zfs.zvolCompression: gzip-9
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");
const grpc = require("@grpc/grpc-js");
const protoLoader = require("@grpc/proto-loader");

const [port, parent] = process.argv.slice(2);
const def = protoLoader.loadSync(path.join(__dirname, "../../csi_proto/csi-v1.9.0.proto"), {
  keepCase: true, longs: String, enums: String, defaults: true, oneofs: true,
});
const ctrl = new (grpc.loadPackageDefinition(def).csi.v1.Controller)(
  `127.0.0.1:${port}`, grpc.credentials.createInsecure());
const call = (m, req) =>
  new Promise((res) => ctrl[m](req, (err, r) => res(err ? { err: `${grpc.status[err.code]}: ${err.details}` } : r)));
const nas = (cmd, input) => {
  try {
    return execFileSync(path.join(__dirname, "ssh.sh"), [cmd], { encoding: "utf8", input }).trim();
  } catch (e) {
    return `ERR ${String(e.stderr || e.message).trim()}`;
  }
};
const cap = [{ access_mode: { mode: "SINGLE_NODE_WRITER" }, mount: {}, access_type: "mount" }];
const create = (name, parameters = {}, extra = {}) =>
  call("CreateVolume", { name, volume_capabilities: cap, capacity_range: { required_bytes: 1073741824 }, parameters, ...extra });
const vol = async (name) => {
  const r = await create(name);
  return r.volume && r.volume.volume_id;
};
const out = (k, v) => console.log(`${k}: ${v}`);
const left = (id) => nas(`zfs list -H -o name ${parent}/${id} 2>/dev/null | wc -l`);

(async () => {
  // a per-volume override must not stick to the next volume
  const a = await create("leak-a", { config: "zfs:\n  zvolBlocksize: 64K\n" });
  const b = await create("leak-b");
  const ida = a.volume && a.volume.volume_id, idb = b.volume && b.volume.volume_id;
  out("override leak: volblocksize of override vol, next vol (want 65536 16384)",
    nas(`zfs get -Hp -o value volblocksize ${parent}/${ida} ${parent}/${idb} | tr '\\n' ' '`) || JSON.stringify([a.err, b.err]));
  out("zvolCompression: value,source (want gzip-9,local)",
    nas(`zfs get -H -o value,source compression ${parent}/${idb} | tr '\\t' ','`));
  for (const id of [ida, idb]) if (id) await call("DeleteVolume", { volume_id: id });

  // a redirect works in zsh, unlike ${IFS} tricks
  const marker = `/tmp/csi-pwned-${process.pid}`;
  out("id injection: DeleteVolume (want INVALID_ARGUMENT)", (await call("DeleteVolume", { volume_id: `x;id>${marker}-v` })).err || "ok");
  out("id injection: DeleteSnapshot (want INVALID_ARGUMENT)", (await call("DeleteSnapshot", { snapshot_id: `x@y;id>${marker}-s` })).err || "ok");
  out("id injection: files written on the NAS (want none)",
    nas(`for f in ${marker}-v ${marker}-s; do [ -f $f ] && echo "$f: $(cat $f)"; done; true`) || "none");
  nas(`rm -f ${marker}-v ${marker}-s`);

  // snapshots from a real TrueNAS periodic task inherit managed_resource; CSI snapshots set it locally
  const idP = await vol("periodic");
  const idB = await vol("both");
  const idC = await vol("csionly");
  const snb = await call("CreateSnapshot", { source_volume_id: idB, name: "csi-snap-both" });
  const snc = await call("CreateSnapshot", { source_volume_id: idC, name: "csi-snap-only" });
  const task = JSON.parse(nas(`midclt call pool.snapshottask.create '${JSON.stringify({
    dataset: parent, recursive: true, lifetime_value: 1, lifetime_unit: "DAY",
    naming_schema: "hourly-%Y-%m-%d_%H-%M-%S", schedule: { minute: "0", hour: "0", dom: "1", month: "1", dow: "*" },
  })}'`));
  nas(`midclt call pool.snapshottask.run ${task.id}`);
  const periodic = () => Number(nas(`zfs list -H -t snapshot -o name -r ${parent} | grep -c @hourly-`));
  // recursive: the parent and its 3 volumes
  for (let i = 0; i < 30 && periodic() < 4; i++) await new Promise((r) => setTimeout(r, 1000));
  out("snapshot guard: periodic snapshots taken (want 4)", periodic());

  // clone sources (volume-source-for-volume-*) are the other kind democratic-csi takes
  const idS = await vol("clonesrc");
  const cl = await create("clonedst", {}, { volume_content_source: { type: "volume", volume: { volume_id: idS } } });
  out("snapshot guard: snapshots where the two guard rules disagree (want none)",
    nas(`sh -s ${parent}`, fs.readFileSync(path.join(__dirname, "disagree.sh"))) || "none");
  if (cl.volume) await call("DeleteVolume", { volume_id: cl.volume.volume_id });
  await call("DeleteVolume", { volume_id: idS });

  const dp = await call("DeleteVolume", { volume_id: idP });
  out("snapshot guard: periodic only (want ok, 0 left)", `${dp.err || "ok"}, ${left(idP)} left`);
  const db = await call("DeleteVolume", { volume_id: idB });
  out("snapshot guard: periodic + CSI (want FAILED_PRECONDITION, 1 left)", `${db.err || "ok"}, ${left(idB)} left`);
  const dc = await call("DeleteVolume", { volume_id: idC });
  out("snapshot guard: CSI only (want FAILED_PRECONDITION, 1 left)", `${dc.err || "ok"}, ${left(idC)} left`);
  if (snb.snapshot) await call("DeleteSnapshot", { snapshot_id: snb.snapshot.snapshot_id });
  const db2 = await call("DeleteVolume", { volume_id: idB });
  out("snapshot guard: periodic + CSI after DeleteSnapshot (want ok, 0 left)", `${db2.err || "ok"}, ${left(idB)} left`);

  if (snc.snapshot) await call("DeleteSnapshot", { snapshot_id: snc.snapshot.snapshot_id });
  await call("DeleteVolume", { volume_id: idC });
  nas(`midclt call pool.snapshottask.delete ${task.id}`);
  for (const id of [idP, idB]) nas(`zfs destroy -r ${parent}/${id} 2>/dev/null`);
  process.exit(0);
})();

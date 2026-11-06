// usage: node probe-race.js <port> <n>; n concurrent Probes, prints status counts
// sidecars probe concurrently at startup, which raced the shared ssh connection
const path = require("path");
const grpc = require("@grpc/grpc-js");
const protoLoader = require("@grpc/proto-loader");

const [port, n] = process.argv.slice(2);
const def = protoLoader.loadSync(path.join(__dirname, "../../csi_proto/csi-v1.9.0.proto"), {
  keepCase: true, longs: String, enums: String, defaults: true, oneofs: true,
});
const identity = new (grpc.loadPackageDefinition(def).csi.v1.Identity)(
  `127.0.0.1:${port}`, grpc.credentials.createInsecure());
const probe = () => new Promise((res) =>
  identity.Probe({}, { deadline: new Date(Date.now() + 30000) }, (err) => res(err ? grpc.status[err.code] : "OK")));

Promise.all(Array.from({ length: Number(n) }, probe)).then((r) => {
  const counts = r.reduce((a, s) => ((a[s] = (a[s] || 0) + 1), a), {});
  console.log(JSON.stringify(counts));
  process.exit(0);
});

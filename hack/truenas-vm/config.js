// usage: node config.js <ci/configs template> <out> <build key> [yaml overrides]
// ssh with a key like production; the http api keeps root password auth
const fs = require("fs");
const path = require("path");
const _ = require("lodash");
const yaml = require("js-yaml");

const [tpl, out, key, extra] = process.argv.slice(2);
const state = process.env.STATE;
const vars = {
  TRUENAS_HOST: process.env.TRUENAS_HOST,
  TRUENAS_USERNAME: "root",
  TRUENAS_PASSWORD: fs.readFileSync(path.join(state, "root-password"), "utf8").trim(),
  CI_BUILD_KEY: key,
};
const text = fs.readFileSync(tpl, "utf8").replace(/\$\{(\w+)\}/g, (m, k) => vars[k] ?? m);
const cfg = yaml.load(text);
delete cfg.sshConnection.password;
cfg.sshConnection.privateKey = fs.readFileSync(path.join(state, "id_ed25519"), "utf8");
_.merge(cfg, yaml.load(extra || "{}"));
fs.writeFileSync(out, yaml.dump(cfg), { mode: 0o600 });

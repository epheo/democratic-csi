// preload for running bin/democratic-csi from source as a non-root user:
// it creates /etc/nvme at startup, which only the node plugin uses
const fs = require("fs");
const exists = fs.existsSync;
fs.existsSync = (p) => String(p).startsWith("/etc/nvme") || exists(p);

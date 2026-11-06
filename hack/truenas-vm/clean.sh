#!/bin/bash
# usage: clean.sh; removes what failed runs left: csi-ci-* iscsi targets/extents, nfs shares
# under /mnt/tank/ci, and every dataset under tank/ci
exec "$(dirname "$0")/ssh.sh" 'python3 - <<EOF
import json, subprocess
def mid(*a):
    out = subprocess.check_output(["midclt", "call", *map(str, a)]).strip()
    try:
        return json.loads(out)
    except ValueError:
        return out
for t in mid("iscsi.target.query"):
    if t["name"].startswith("csi-ci-"): mid("iscsi.target.delete", t["id"], "true")
for e in mid("iscsi.extent.query"):
    if e["name"].startswith("csi-ci-"): mid("iscsi.extent.delete", e["id"], "false", "true")
for s in mid("sharing.nfs.query"):
    if all(p.startswith("/mnt/tank/ci/") for p in s["paths"]): mid("sharing.nfs.delete", s["id"])
print("targets", len(mid("iscsi.target.query")), "extents", len(mid("iscsi.extent.query")),
      "nfs shares", len(mid("sharing.nfs.query")))
EOF
for d in $(zfs list -H -o name -d 1 tank/ci | grep "^tank/ci/"); do zfs destroy -R $d; done
zfs list -H -o name -r tank/ci'

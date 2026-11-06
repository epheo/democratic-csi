#!/bin/sh
# usage: ssh root@nas sh -s <dataset> < disagree.sh
# read-only; lists snapshots under <dataset> where the DeleteVolume guard (managed_resource set
# locally) and a csi_snapshot_name guard would decide differently; empty output: they agree
zfs get -H -r -t snapshot -o name,property,value,source \
  democratic-csi:managed_resource,democratic-csi:csi_snapshot_name "$1" |
awk -F'\t' '
  $2 == "democratic-csi:managed_resource" { m[$1] = $3; s[$1] = $4 }
  $2 == "democratic-csi:csi_snapshot_name" { n[$1] = $3 }
  END {
    for (k in m) {
      a = (m[k] == "true" && s[k] !~ /^inherited/)
      b = (m[k] == "true" && n[k] != "-")
      if (a != b) print k, "source_rule_blocks=" a, "csi_name_rule_blocks=" b, "managed_source=" s[k], "csi_name=" n[k]
    }
  }'

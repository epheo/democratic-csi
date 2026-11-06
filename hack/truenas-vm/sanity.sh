#!/bin/bash
# usage: sanity.sh <src dir | image> <iscsi | nfs> [yaml overrides]
# csi-sanity controller specs against the VM
. "$(dirname "$0")/lib.sh"
vm_host || exit 1
src=$1; proto=$2; extra=${3:-}
key=$proto$RANDOM
out=$STATE/runs/$key; mkdir -p "$out"
node "$HACK/config.js" "$REPO/ci/configs/truenas/core/13.0/core-$proto.yaml" "$out/config.yaml" "$key" "$extra" || exit 1
port=$((40000 + RANDOM % 20000))
h=$("$HACK/server.sh" "$src" "$out/config.yaml" $port "$out/server.log") || exit 1

# upstream CI skips the last two on CORE; Node Service needs root and an initiator
skip="Node Service"
skip+="|should fail when requesting to create a snapshot with already existing name and different source volume ID"
skip+="|should fail when requesting to create a volume with already existing name and different capacity"
"${CSI_SANITY:-csi-sanity}" --csi.endpoint "127.0.0.1:$port" \
  --csi.mountdir "$out/mnt" --csi.stagingdir "$out/stage" \
  --csi.testvolumeexpandsize 2147483648 --csi.testvolumesize 1073741824 \
  -ginkgo.skip "$skip" >"$out/sanity.log" 2>&1
rc=$?
"$HACK/stop.sh" "$h"
echo "$proto: rc=$rc $(sed 's/\x1b\[[0-9;]*m//g' "$out/sanity.log" | grep -E '^(Ran|FAIL!|SUCCESS!)' | tr '\n' ' ')logs=$out"
exit $rc

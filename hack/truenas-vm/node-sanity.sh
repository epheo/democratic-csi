#!/bin/bash
# usage: [ACCESS_TYPE=block] [SEED=n] node-sanity.sh <image> <iscsi | nfs> [yaml overrides]
# csi-sanity controller and node specs, run in the node VM against the TrueNAS VM
. "$(dirname "$0")/lib.sh"
vm_host || exit 1
image=$1; proto=$2; extra=${3:-}
key=n$proto$RANDOM
out=$STATE/runs/$key; mkdir -p "$out"
node "$HACK/config.js" "$REPO/ci/configs/truenas/core/13.0/core-$proto.yaml" "$out/config.yaml" "$key" "$extra" || exit 1
port=$((40000 + RANDOM % 20000))
name=$("$HACK/node-server.sh" "$image" "$out/config.yaml" $port "$out/server.log") || exit 1

# upstream CI skips the first two on CORE; the driver does not refuse a second
# publish of a single-writer volume (kubelet enforces ReadWriteOncePod), and the
# mount that spec leaves behind would fail every later spec
skip="should fail when requesting to create a snapshot with already existing name and different source volume ID"
skip+="|should fail when requesting to create a volume with already existing name and different capacity"
skip+="|should fail when volume with single node single writer access mode is already mounted at a different target path"
d=/var/lib/csi-sanity/$key
"$HACK/node-ssh.sh" "mkdir -p $d && csi-sanity --csi.endpoint 127.0.0.1:$port --csi.mountdir $d/mnt --csi.stagingdir $d/stage \
  --csi.testvolumeexpandsize 2147483648 --csi.testvolumesize 1073741824 \
  --csi.testvolumeaccesstype ${ACCESS_TYPE:-mount} ${SEED:+-ginkgo.seed $SEED} -ginkgo.skip '$skip'" >"$out/sanity.log" 2>&1
rc=$?
"$HACK/node-ssh.sh" "podman stop -t 15 $name >/dev/null; rm -f /etc/democratic-csi/$port.yaml; rmdir $d 2>/dev/null; true"
echo "node $proto ${ACCESS_TYPE:-mount}: rc=$rc $(sed 's/\x1b\[[0-9;]*m//g' "$out/sanity.log" | grep -E '^(Ran|FAIL!|SUCCESS!)' | tr '\n' ' ')logs=$out"
exit $rc

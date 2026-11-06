#!/bin/bash
# usage: node-checks.sh <image>
# NodeUnstage regression checks in the node VM (freenas-iscsi, xfs); each line says what to expect
. "$(dirname "$0")/lib.sh"
vm_host || exit 1
node_host || exit 1
image=$1
key=nchecks$RANDOM
out=$STATE/runs/$key; mkdir -p "$out"
node "$HACK/config.js" "$REPO/ci/configs/truenas/core/13.0/core-iscsi.yaml" "$out/config.yaml" "$key" || exit 1
port=$((40000 + RANDOM % 20000)); lport=$((30000 + RANDOM % 9000))
name=$("$HACK/node-server.sh" "$image" "$out/config.yaml" $port "$out/server.log") || exit 1
# the plugin listens on the node VM's loopback
ssh -q -N -i "$STATE/id_ed25519" -o BatchMode=yes -o UserKnownHostsFile="$STATE/node_known_hosts" \
  -L $lport:127.0.0.1:$port "root@$NODE_HOST" &
tunnel=$!
for _ in $(seq 20); do (exec 3<>/dev/tcp/127.0.0.1/$lport) 2>/dev/null && break; sleep 0.5; done
node "$HACK/node-checks.js" $lport
kill $tunnel
"$HACK/node-ssh.sh" "podman stop -t 15 $name >/dev/null"
echo "logs: $out"

#!/bin/bash
# usage: node-ssh.sh [command]; root shell on the node VM
. "$(dirname "$0")/lib.sh"
node_host || exit 1
exec ssh -q -i "$STATE/id_ed25519" -o BatchMode=yes \
  -o StrictHostKeyChecking=accept-new -o UserKnownHostsFile="$STATE/node_known_hosts" \
  "root@$NODE_HOST" "$@"

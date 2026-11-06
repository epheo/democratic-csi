#!/bin/bash
# usage: ssh.sh [command]
# root shell on CORE is zsh: ${IFS} does not split words there
. "$(dirname "$0")/lib.sh"
vm_host || exit 1
exec ssh -q -i "$STATE/id_ed25519" -o BatchMode=yes \
  -o StrictHostKeyChecking=accept-new -o UserKnownHostsFile="$STATE/known_hosts" \
  "root@$TRUENAS_HOST" "$@"

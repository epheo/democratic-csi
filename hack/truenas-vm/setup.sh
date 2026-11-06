#!/bin/bash
# usage: setup.sh; run once after the install
set -euo pipefail
. "$(dirname "$0")/lib.sh"
timeout 600 bash -c "until virsh domifaddr '$VM' --source lease 2>/dev/null | grep -q ipv4; do sleep 5; done"
vm_host
[ -f "$STATE/id_ed25519" ] || ssh-keygen -q -t ed25519 -N "" -C democratic-csi-test -f "$STATE/id_ed25519"
python3 "$HACK/setup.py" "$TRUENAS_HOST" "$STATE/root-password" "$STATE/id_ed25519.pub"
"$HACK/ssh.sh" 'zfs list -H -o name tank/ci'

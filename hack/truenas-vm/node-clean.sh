#!/bin/bash
# usage: node-clean.sh; removes what failed node runs left in the node VM:
# mounts under /var/lib/csi-sanity, iSCSI sessions and node records, containers
exec "$(dirname "$0")/node-ssh.sh" '
podman ps -q --filter name=dcsi-node- | xargs -r podman stop -t 5 >/dev/null
findmnt -rn -o TARGET | grep "^/var/lib/csi-sanity/" | sort -r | xargs -r -n1 umount -l
iscsiadm -m node -U all >/dev/null 2>&1; iscsiadm -m node -o delete >/dev/null 2>&1
rm -rf /var/lib/csi-sanity/* /etc/democratic-csi/*
echo "mounts $(findmnt -rn -o TARGET | grep -c "^/var/lib/csi-sanity/") sessions $(iscsiadm -m session 2>/dev/null | wc -l)"'

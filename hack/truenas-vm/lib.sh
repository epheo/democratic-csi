# sourced by the other scripts
VM=${TRUENAS_VM:-truenas-csi-test}
# credentials, ISO and run logs (configs hold the ssh key): never inside the repo
STATE=${TRUENAS_VM_STATE:-${XDG_STATE_HOME:-$HOME/.local/state}/democratic-csi-truenas-vm}
HACK=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
REPO=$(cd "$HACK/../.." && pwd)
export LIBVIRT_DEFAULT_URI=${LIBVIRT_DEFAULT_URI:-qemu:///system}
export NODE_PATH=${NODE_PATH:-$REPO/node_modules}
export STATE
mkdir -p "$STATE" && chmod 700 "$STATE"

vm_host() {
  [ -n "${TRUENAS_HOST:-}" ] || TRUENAS_HOST=$(virsh domifaddr "$VM" --source lease 2>/dev/null |
    awk '/ipv4/ { sub("/.*", "", $4); print $4; exit }')
  [ -n "$TRUENAS_HOST" ] || { echo "no ip for $VM, is it running?" >&2; return 1; }
  export TRUENAS_HOST
}

# a CentOS Stream 10 VM standing in for a Kubernetes node (node-create.sh)
NODE_VM=${TRUENAS_NODE_VM:-csi-node-test}
node_host() {
  [ -n "${NODE_HOST:-}" ] || NODE_HOST=$(virsh domifaddr "$NODE_VM" --source lease 2>/dev/null |
    awk '/ipv4/ { sub("/.*", "", $4); print $4; exit }')
  [ -n "$NODE_HOST" ] || { echo "no ip for $NODE_VM, is it running?" >&2; return 1; }
  export NODE_HOST
}

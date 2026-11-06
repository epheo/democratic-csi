#!/bin/bash
# usage: node-create.sh; creates the node VM: CentOS Stream 10 (the el10 userspace and
# kernel of SCOS 10 nodes) with iscsid, nfs-utils and podman, root ssh with the VM key
set -euo pipefail
. "$(dirname "$0")/lib.sh"
POOL=${LIBVIRT_POOL:-default}
URL=https://cloud.centos.org/centos/10-stream/x86_64/images/CentOS-Stream-GenericCloud-10-latest.x86_64.qcow2
[ -f "$STATE/id_ed25519.pub" ] || { echo "no $STATE/id_ed25519.pub: run setup.sh first" >&2; exit 1; }

cd "$STATE"
if ! virsh vol-info --pool "$POOL" "$NODE_VM.qcow2" >/dev/null 2>&1; then
  if [ ! -f cs10.qcow2 ]; then
    curl -fsSL -o cs10.qcow2.SHA256SUM "$URL.SHA256SUM"
    curl -fL -o cs10.qcow2.part "$URL" && mv cs10.qcow2.part cs10.qcow2
  fi
  [ "$(grep -oE '[0-9a-f]{64}' cs10.qcow2.SHA256SUM | head -1)" = "$(sha256sum < cs10.qcow2 | cut -d' ' -f1)" ] ||
    { echo "checksum mismatch: $STATE/cs10.qcow2" >&2; exit 1; }
  virsh vol-create-as "$POOL" "$NODE_VM.qcow2" "$(stat -c %s cs10.qcow2)" --format qcow2
  virsh vol-upload --pool "$POOL" "$NODE_VM.qcow2" cs10.qcow2
  virsh vol-resize --pool "$POOL" "$NODE_VM.qcow2" 20G
fi

ci=$STATE/node-cloud-init
mkdir -p "$ci"
cat > "$ci/user-data" <<EOF
#cloud-config
hostname: $NODE_VM
disable_root: false
ssh_authorized_keys:
  - $(cat "$STATE/id_ed25519.pub")
packages: [iscsi-initiator-utils, nfs-utils, podman]
runcmd:
  - [systemctl, enable, --now, iscsid]
EOF
printf 'instance-id: %s\nlocal-hostname: %s\n' "$NODE_VM" "$NODE_VM" > "$ci/meta-data"

virt-install --name "$NODE_VM" --memory 3072 --vcpus 2 --cpu host-passthrough --osinfo centos-stream10 \
  --disk vol="$POOL/$NODE_VM.qcow2",bus=virtio --import \
  --network network=default,model=virtio --graphics none --noautoconsole \
  --cloud-init user-data="$ci/user-data",meta-data="$ci/meta-data"

timeout 900 bash -c "until '$HACK/node-ssh.sh' 'cloud-init status --wait >/dev/null; rpm -q iscsi-initiator-utils podman >/dev/null' 2>/dev/null; do sleep 10; done"
"$HACK/node-ssh.sh" '. /etc/os-release; echo "$PRETTY_NAME $(uname -r) iscsid=$(systemctl is-active iscsid)"'

#!/bin/bash
# usage: create.sh; creates the VM and boots the TrueNAS CORE installer
set -euo pipefail
. "$(dirname "$0")/lib.sh"
VERSION=${TRUENAS_VERSION:-13.3-U1.2}
POOL=${LIBVIRT_POOL:-default}
ISO=TrueNAS-$VERSION.iso
URL=https://download-core.sys.truenas.net/${VERSION%%-*}/STABLE/${VERSION#*-}/x64/$ISO

# libvirtd may not see this filesystem, so disks and ISO go through the pool
for v in "$VM-boot.qcow2 16G" "$VM-data.qcow2 40G"; do
  set -- $v
  virsh vol-info --pool "$POOL" "$1" >/dev/null 2>&1 || virsh vol-create-as "$POOL" "$1" "$2" --format qcow2
done
if ! virsh vol-info --pool "$POOL" "$ISO" >/dev/null 2>&1; then
  cd "$STATE"
  [ -f "$ISO" ] || { curl -fL -o "$ISO.part" "$URL" && mv "$ISO.part" "$ISO"; }
  curl -fsSL -o "$ISO.sha256" "$URL.sha256"
  [ "$(awk '{ print $NF }' "$ISO.sha256")" = "$(sha256sum < "$ISO" | cut -d' ' -f1)" ] ||
    { echo "checksum mismatch: $STATE/$ISO" >&2; exit 1; }
  virsh vol-create-as "$POOL" "$ISO" "$(stat -c %s "$ISO")" --format raw
  virsh vol-upload --pool "$POOL" "$ISO" "$ISO"
fi

# typed on the installer console, so keep it to plain keys
[ -f "$STATE/root-password" ] || (umask 077; python3 -c 'import secrets, string
print("".join(secrets.choice(string.ascii_lowercase + string.digits) for _ in range(16)))' > "$STATE/root-password")

virt-install --name "$VM" --memory 8192 --vcpus 4 --cpu host-passthrough --osinfo freebsd13.3 \
  --disk vol="$POOL/$VM-boot.qcow2",bus=virtio \
  --disk vol="$POOL/$VM-data.qcow2",bus=virtio,serial=csidata0 \
  --cdrom "$(virsh vol-path --pool "$POOL" "$ISO")" \
  --network network=default,model=virtio \
  --graphics vnc,listen=127.0.0.1 --video vga \
  --boot hd,cdrom --noautoconsole

cat <<EOF
Finish the installer on the console (virt-manager or virt-viewer $VM):
- 1 Install/Upgrade
- select vtbd0 (16 GiB) with space, OK, confirm the erase
- root password: $STATE/root-password
- Boot via BIOS
- on success, Reboot: the VM powers off, that is virt-install's install phase
Then:
  virsh change-media $VM hda --eject --config
  virsh start $VM
  $HACK/setup.sh
EOF

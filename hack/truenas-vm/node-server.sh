#!/bin/bash
# usage: node-server.sh <image> <config> <port> <log>
# runs controller + node in the node VM, privileged with the host mounts the
# node DaemonSet uses; prints the container name once it listens on 127.0.0.1:<port>
. "$(dirname "$0")/lib.sh"
image=$1; cfg=$2; port=$3; log=$4; name=dcsi-node-$port
n() { "$HACK/node-ssh.sh" "$@"; }

# local builds are not in any registry the VM can reach
if [[ "$image" == localhost/* ]]; then
  n "podman image exists $image" || podman save "$image" | n podman load -q >/dev/null || exit 1
fi
n "mkdir -p /etc/democratic-csi /var/lib/csi-sanity && cat > /etc/democratic-csi/$port.yaml" < "$cfg" || exit 1
# iscsiadm and multipath run on the host through chroot /host; mounts made under
# /var/lib/csi-sanity must propagate back to the host, like /var/lib/kubelet
n podman run -d --rm --name "$name" --privileged --network host --pid host --ipc host --uts host \
  -v /:/host:rslave -v /dev:/dev -v /sys:/sys -v /run/udev:/run/udev \
  -v /var/lib/csi-sanity:/var/lib/csi-sanity:rshared \
  -v "/etc/democratic-csi/$port.yaml:/config/driver.yaml:ro" \
  "$image" --driver-config-file /config/driver.yaml --log-level debug --csi-version 1.9.0 \
  --csi-name driver-test --csi-mode controller node --server-address 127.0.0.1 --server-port "$port" >/dev/null || exit 1
nohup "$HACK/node-ssh.sh" podman logs -f "$name" >"$log" 2>&1 &
for _ in $(seq 120); do
  n "exec 3<>/dev/tcp/127.0.0.1/$port" 2>/dev/null && { echo "$name"; exit 0; }
  n "podman container exists $name" || { echo "server died, see $log" >&2; exit 1; }
  sleep 1
done
echo "server not listening, see $log" >&2
exit 1

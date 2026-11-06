#!/bin/bash
# usage: server.sh <src dir | image> <config> <port> <log>
# starts a controller on 127.0.0.1:<port>, prints a handle for stop.sh once it listens
. "$(dirname "$0")/lib.sh"
src=$1; cfg=$2; port=$3; log=$4
# node mode too: csi-sanity cleanup calls NodeGetCapabilities
args=(--log-level debug --csi-version 1.9.0 --csi-name driver-test --csi-mode controller node
  --server-address 127.0.0.1 --server-port "$port")

if [ -d "$src" ]; then
  nohup node --no-deprecation -r "$HACK/nonroot.js" "$src/bin/democratic-csi" \
    --driver-config-file "$cfg" "${args[@]}" >"$log" 2>&1 &
  handle=$!
  alive() { kill -0 "$handle" 2>/dev/null; }
else
  handle=dcsi-test-$port
  podman run -d --rm --name "$handle" --network host -v "$cfg:/config/driver.yaml:ro,z" "$src" \
    --driver-config-file /config/driver.yaml "${args[@]}" >/dev/null || exit 1
  nohup podman logs -f "$handle" >"$log" 2>&1 &
  alive() { podman container exists "$handle"; }
fi

for _ in $(seq 60); do
  (exec 3<>"/dev/tcp/127.0.0.1/$port") 2>/dev/null && { echo "$handle"; exit 0; }
  alive || { echo "server died, see $log" >&2; exit 1; }
  sleep 1
done
echo "server not listening, see $log" >&2
exit 1

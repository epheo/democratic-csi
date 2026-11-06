#!/bin/bash
# usage: checks.sh <src dir | image>
# regression checks for the fork fixes against the VM, freenas-iscsi; each line says what to expect
. "$(dirname "$0")/lib.sh"
vm_host || exit 1
src=$1
key=checks$RANDOM
out=$STATE/runs/$key; mkdir -p "$out"
node "$HACK/config.js" "$REPO/ci/configs/truenas/core/13.0/core-iscsi.yaml" "$out/config.yaml" "$key" \
  '{"zfs": {"zvolCompression": "gzip-9"}}' || exit 1
badbanners() { "$HACK/ssh.sh" "grep -c 'banner exchange.*invalid format' /var/log/auth.log"; }

# 8 Probes on a fresh server, then again after killing the driver's ssh sessions (not ours)
for i in 1 2 3; do
  before=$(badbanners); port=$((40000 + RANDOM % 20000))
  h=$("$HACK/server.sh" "$src" "$out/config.yaml" $port "$out/race$i.log") || exit 1
  r=$(node "$HACK/probe-race.js" $port 8)
  "$HACK/ssh.sh" 'for p in $(pgrep -f "sshd: root@notty"); do [ $p != $PPID ] && kill $p; done'
  r2=$(node "$HACK/probe-race.js" $port 8)
  "$HACK/stop.sh" "$h"
  echo "ssh race run $i (want 8 OK twice, 0 lines): startup $r, after drop $r2, new 'invalid format' lines $(( $(badbanners) - before ))"
done

port=$((40000 + RANDOM % 20000))
h=$("$HACK/server.sh" "$src" "$out/config.yaml" $port "$out/server.log") || exit 1
node "$HACK/checks.js" $port "tank/ci/$key/v"
"$HACK/stop.sh" "$h"
echo "logs: $out"

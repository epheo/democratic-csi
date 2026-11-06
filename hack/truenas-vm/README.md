# TrueNAS CORE test VM

Tests the freenas-iscsi and freenas-nfs drivers against a real TrueNAS CORE 13.3, over ssh like production.
Runs the controller from a source tree or an image, on this host; no Kubernetes needed.

## Needs

- libvirt with `qemu:///system`, its `default` network and pool, `virt-install`
- 6 GiB of RAM free for the TrueNAS VM, 3 GiB more for the node VM
- python3, node and `npm ci` in the repo root
- `csi-sanity` in PATH or `CSI_SANITY`:
  `go install github.com/kubernetes-csi/csi-test/v5/cmd/csi-sanity@latest`
- podman, to test an image

## State

Root password, ssh key, ISO and run logs live in `~/.local/state/democratic-csi-truenas-vm`.
Override with `TRUENAS_VM_STATE`; keep it out of the repo, run configs hold the ssh key.
`TRUENAS_VM` names the VM (default `truenas-csi-test`); `TRUENAS_HOST` skips the IP lookup.

## Create

```sh
hack/truenas-vm/create.sh   # then follow its installer steps on the console
hack/truenas-vm/setup.sh    # pool tank, dataset tank/ci, ssh/nfs/iscsi, root ssh key
```

## Use

```sh
virsh start truenas-csi-test
hack/truenas-vm/sanity.sh . iscsi                               # source tree
hack/truenas-vm/sanity.sh ghcr.io/epheo/democratic-csi@sha256:... nfs  # image
hack/truenas-vm/checks.sh .     # fork fixes; each line says what to expect
hack/truenas-vm/clean.sh        # after a failed run
virsh shutdown truenas-csi-test
```

To test another ref without a checkout: `git archive <ref> | tar -x -C <dir>`, then pass `<dir>`.
Expect csi-sanity: 42 passed, node specs skipped.

## Node VM

csi-sanity's node specs (stage, publish, expand, unstage) need root, iscsid and real mounts.
`node-create.sh` builds `csi-node-test`: CentOS Stream 10 cloud image (el10 kernel, like SCOS 10 nodes), iscsid, nfs-utils, podman, 3 GiB.
The node plugin runs there privileged, with the host mounts of the node DaemonSet; csi-sanity runs there too.

```sh
hack/truenas-vm/node-create.sh                    # once; needs setup.sh's ssh key
virsh start truenas-csi-test; virsh start csi-node-test
hack/truenas-vm/node-sanity.sh ghcr.io/epheo/democratic-csi:master iscsi
hack/truenas-vm/node-sanity.sh localhost/dcsi:test nfs   # local images are copied over
hack/truenas-vm/node-clean.sh                     # leftover mounts and sessions
```

Expect 65 (iscsi) and 61 (nfs) passed.
Skipped: the two specs upstream skips on CORE, and a second publish of a single-writer volume, which the driver does not refuse.

## Gotchas

- The root shell on CORE is zsh: `${IFS}` does not split words, so injection tests use a redirect.
- `disagree.sh` is read-only and safe on production pools:
  `ssh root@nas sh -s <pool> < hack/truenas-vm/disagree.sh`

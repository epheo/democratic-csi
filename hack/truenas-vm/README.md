# TrueNAS CORE test VM

Tests the freenas-iscsi and freenas-nfs drivers against a real TrueNAS CORE 13.3, over ssh like production.
Runs the controller from a source tree or an image, on this host; no Kubernetes needed.

## Needs

- libvirt with `qemu:///system`, its `default` network and pool, `virt-install`
- 8 GiB of RAM free for the VM
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

## Gotchas

- The root shell on CORE is zsh: `${IFS}` does not split words, so injection tests use a redirect.
- `disagree.sh` is read-only and safe on production pools:
  `ssh root@nas sh -s <pool> < hack/truenas-vm/disagree.sh`

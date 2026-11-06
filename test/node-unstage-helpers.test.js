// NodeUnstage only logs out of iscsi when these say the filesystem is gone:
// a busy umount must fail, and isBlockDevice must answer for real
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");
const { Mount } = require("../src/utils/mount");
const { Filesystem } = require("../src/utils/filesystem");

function mountExiting(code, stderr) {
  const mount = new Mount();
  mount.exec = async () => {
    throw { code, stderr, stdout: "" };
  };
  return mount;
}

test("umount: target is busy fails", async () => {
  const mount = mountExiting(32, "umount: /x: target is busy.\n");
  await assert.rejects(mount.umount("/x"), (err) => err.code == 32);
});

test("umount: not mounted, or no such mount point, is done", async () => {
  assert.equal(await mountExiting(32, "umount: /x: not mounted.\n").umount("/x"), true);
  assert.equal(await mountExiting(32, "umount: /x: no mount point specified.\n").umount("/x"), true);
});

test("isBlockDevice: only block device nodes", async () => {
  const filesystem = new Filesystem();
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "isblock-")), "f");
  fs.writeFileSync(file, "");
  assert.equal(await filesystem.isBlockDevice(file), false);
  assert.equal(await filesystem.isBlockDevice("/dev/null"), false); // character device
  assert.equal(await filesystem.isBlockDevice("/dev/does-not-exist"), false);
  assert.equal(await filesystem.isBlockDevice(`${file}/block_device`), false); // ENOTDIR
  assert.equal(await filesystem.isBlockDevice("nas:/mnt/tank/x"), false);
  const block = fs.readdirSync("/dev").map((d) => `/dev/${d}`).find((p) => {
    try {
      return fs.statSync(p).isBlockDevice();
    } catch {
      return false;
    }
  });
  if (block) {
    assert.equal(await filesystem.isBlockDevice(block), true);
  }
});

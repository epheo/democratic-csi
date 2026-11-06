// Zetabyte.exec must report success only for exit status 0: over ssh a dropped
// connection closes the command with an undefined code and partial output
const assert = require("node:assert");
const { EventEmitter } = require("node:events");
const { test } = require("node:test");
const { Zetabyte } = require("../src/utils/zfs");

function executor(closeArgs, { stdout = "", stderr = "", onKill } = {}) {
  return {
    spawn() {
      const child = new EventEmitter();
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();
      child.kill = () => onKill && onKill(child);
      if (closeArgs) {
        setImmediate(() => {
          if (stdout) child.stdout.emit("data", stdout);
          if (stderr) child.stderr.emit("data", stderr);
          child.emit("close", ...closeArgs);
        });
      }
      return child;
    },
  };
}

function run(exec, options = {}) {
  const zb = new Zetabyte({ executor: exec });
  return new Promise((resolve) => {
    let calls = 0;
    zb.exec("zfs", ["list"], options, (error, stdout) => {
      calls++;
      // let a second callback, if any, show up before resolving
      setImmediate(() => resolve({ error, stdout, calls }));
    });
  });
}

test("exit 0 succeeds", async () => {
  const r = await run(executor([0], { stdout: "tank\n" }));
  assert.equal(r.error, null);
  assert.equal(r.stdout, "tank\n");
  assert.equal(r.calls, 1);
});

test("non-zero exit fails with stderr as the message", async () => {
  const r = await run(executor([1], { stderr: "dataset does not exist" }));
  assert.equal(r.error.message, "dataset does not exist");
  assert.equal(r.calls, 1);
});

test("connection lost (undefined code) fails despite partial output", async () => {
  const r = await run(executor([undefined], { stdout: "tank/a\n" }));
  assert.match(r.error.message, /without exit status/);
});

test("killed by a signal (null code) fails", async () => {
  const r = await run(executor([null, "SIGKILL"]));
  assert.match(r.error.message, /SIGKILL/);
});

test("timeout fails as a timeout", async () => {
  const exec = executor(null, { onKill: (child) => setImmediate(() => child.emit("close", 143)) });
  const r = await run(exec, { timeout: 5 });
  assert.equal(r.error.message, "Process killed due to timeout.");
});

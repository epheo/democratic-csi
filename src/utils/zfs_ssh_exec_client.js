const Client = require("ssh2").Client;

class SshClient {
  constructor(options = {}) {
    this.options = options;
    this.options.connection = this.options.connection || {};
    if (this.options.logger) {
      this.logger = this.options.logger;
    } else {
      this.logger = console;
      console.silly = console.debug;
    }

    if (!this.options.connection.hasOwnProperty("keepaliveInterval")) {
      this.options.connection.keepaliveInterval = 10000;
    }

    if (this.options.connection.debug === true) {
      this.options.connection.debug = (msg) => {
        this.debug(msg);
      };
    }

    // promise of the shared ready ssh2 Client, null when none is usable
    this.conn = null;
  }

  /**
   * Build a command line from the name and given args
   * TODO: escape the arguments
   *
   * @param {*} name
   * @param {*} args
   */
  buildCommand(name, args = []) {
    args.unshift(name);
    return args.join(" ");
  }

  debug() {
    this.logger.silly(...arguments);
  }

  /**
   * Opens a new connection; resolves to the ssh2 Client once ready.
   *
   * Never reuse an ssh2 Client: its connect() on a live socket sends
   * DISCONNECT before the ident (sshd logs "banner exchange: invalid format"),
   * and a reused Client re-emits close events of its previous socket.
   *
   * @param {*} onGone called when the connection errors or closes
   */
  _open(onGone = () => {}) {
    return new Promise((resolve, reject) => {
      const client = new Client();
      const gone = (err) => {
        reject(err);
        onGone();
      };
      client
        .on("ready", () => {
          this.debug("Client :: ready");
          resolve(client);
        })
        .on("error", (err) => {
          this.debug("Client :: error");
          gone(err);
        })
        .on("end", () => {
          this.debug("Client :: end");
        })
        .on("close", () => {
          this.debug("Client :: close");
          gone(new Error("ssh connection closed"));
        });
      client.connect(this.options.connection);
    });
  }

  /**
   * Concurrent callers share one connection attempt.
   */
  connect() {
    if (!this.conn) {
      const drop = () => {
        if (this.conn === conn) {
          this.conn = null;
        }
      };
      const conn = this._open(drop);
      // ssh2 throws synchronously on bad config, before onGone can be wired
      conn.catch(drop);
      this.conn = conn;
    }
    return this.conn;
  }

  async exec(command, options = {}, stream_proxy = null) {
    // default is to reuse
    if (process.env.SSH_REUSE_CONNECTION == "0") {
      const conn = await this._open();
      try {
        return await this._run(conn, command, options, stream_proxy);
      } finally {
        conn.end();
      }
    }

    for (let attempt = 0; ; attempt++) {
      const pending = this.connect();
      const conn = await pending;
      try {
        return await this._run(conn, command, options, stream_proxy);
      } catch (err) {
        if (attempt > 0 || !String(err.message).includes("Not connected")) {
          throw err;
        }
        // socket ended before its close event dropped the cached connection
        if (this.conn === pending) {
          this.conn = null;
        }
      }
    }
  }

  _run(conn, command, options, stream_proxy) {
    const client = this;
    return new Promise((resolve, reject) => {
      conn.exec(command, options, function (err, stream) {
        if (err) {
          reject(err);
          return;
        }
        let stderr;
        let stdout;

        if (stream_proxy) {
          stream_proxy.on("kill", (signal) => {
            stream.destroy();
          });
        }

        stream
          .on("close", function (code, signal) {
            client.debug(
              "Stream :: close :: code: " + code + ", signal: " + signal
            );
            if (stream_proxy) {
              stream_proxy.emit("close", ...arguments);
            }
            resolve({ stderr, stdout, code, signal });
          })
          .on("data", function (data) {
            client.debug("STDOUT: " + data);
            if (stream_proxy) {
              stream_proxy.stdout.emit("data", ...arguments);
            }
            if (stdout == undefined) {
              stdout = "";
            }
            stdout = stdout.concat(data);
          })
          .stderr.on("data", function (data) {
            client.debug("STDERR: " + data);
            if (stream_proxy) {
              stream_proxy.stderr.emit("data", ...arguments);
            }
            if (stderr == undefined) {
              stderr = "";
            }
            stderr = stderr.concat(data);
          });
      });
    });
  }
}

module.exports.SshClient = SshClient;

# usage: python3 setup.py <host> <root password file> <ssh public key file>
# idempotent: pool tank on the data disk, dataset tank/ci, ssh/nfs/iscsi, root ssh key
import base64, json, sys, time, urllib.error, urllib.request

host, pw_file, pubkey_file = sys.argv[1:4]
pw = open(pw_file).read().strip()
auth = base64.b64encode(f"root:{pw}".encode()).decode()


def api(method, path, body=None):
    req = urllib.request.Request(
        f"http://{host}/api/v2.0/{path}",
        method=method,
        data=None if body is None else json.dumps(body).encode(),
        headers={"Authorization": f"Basic {auth}", "Content-Type": "application/json"},
    )
    try:
        with urllib.request.urlopen(req, timeout=120) as r:
            return json.loads(r.read() or "null")
    except urllib.error.HTTPError as e:
        raise SystemExit(f"{method} {path}: {e.code} {e.read().decode()[:300]}")


def wait_ready():
    for _ in range(120):
        try:
            if api("GET", "system/state") == "READY":
                return
        except (OSError, SystemExit):
            pass
        time.sleep(5)
    raise SystemExit("middleware not READY after 10 minutes")


def wait_job(job_id):
    while True:
        job = api("GET", f"core/get_jobs?id={job_id}")[0]
        if job["state"] in ("SUCCESS", "FAILED", "ABORTED"):
            if job["state"] != "SUCCESS":
                raise SystemExit(f"job {job_id}: {job['state']} {job.get('error')}")
            return job
        time.sleep(2)


def service(name):
    svc = api("GET", f"service?service={name}")[0]
    api("PUT", f"service/id/{svc['id']}", {"enable": True})
    api("POST", "service/start", {"service": name})
    print("service", name, api("GET", f"service?service={name}")[0]["state"])


wait_ready()
print(api("GET", "system/version"))

# vtbd1 is the data disk: create.sh gives it serial csidata0
if not api("GET", "pool?name=tank"):
    wait_job(api("POST", "pool", {
        "name": "tank",
        "encryption": False,
        "topology": {"data": [{"type": "STRIPE", "disks": ["vtbd1"]}]},
    }))
print("pool", api("GET", "pool?name=tank")[0]["status"])

if not api("GET", "pool/dataset?id=tank/ci"):
    api("POST", "pool/dataset", {"name": "tank/ci"})
print("dataset tank/ci ok")

root = api("GET", "user?username=root")[0]
api("PUT", f"user/id/{root['id']}", {"sshpubkey": open(pubkey_file).read().strip()})
api("PUT", "ssh", {"rootlogin": True, "passwordauth": True})
service("ssh")
service("nfs")

# the ci/configs templates use portal group 1 and initiator group 1
if not api("GET", "iscsi/portal"):
    api("POST", "iscsi/portal", {"listen": [{"ip": "0.0.0.0", "port": 3260}], "comment": "csi"})
if not api("GET", "iscsi/initiator"):
    api("POST", "iscsi/initiator", {"comment": "csi", "initiators": []})
print("iscsi portal ids", [p["id"] for p in api("GET", "iscsi/portal")],
      "initiator ids", [i["id"] for i in api("GET", "iscsi/initiator")])
service("iscsitarget")

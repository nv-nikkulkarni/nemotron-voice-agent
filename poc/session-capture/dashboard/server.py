# SPDX-FileCopyrightText: Copyright (c) 2024-2026, NVIDIA CORPORATION & AFFILIATES. All rights reserved.
# SPDX-License-Identifier: BSD-2-Clause
"""Self-contained session-capture dashboard backend (pure stdlib, runs anywhere).

Given a session id it downloads `<org>/session-captures:<sid>` straight from NGC over
the REST API (auth with the NGC API key -> bearer token -> follow the signed 302),
extracts the tarball, and serves its session.log / transcript.txt / audio to the SPA.

NO cluster, NO ngc CLI, NO shared PVC, NO logkeeper — just this container + an API key.

Env:
  NGC_API_KEY  (or NGC_CLI_API_KEY)   REQUIRED — org/personal key that can read the resource
  NGC_ORG      default 0491162300748285
  NGC_RESOURCE default session-captures
  PORT         default 8090
  CACHE_DIR    default /tmp/dashboard-cache
"""
import base64
import glob
import io
import json
import os
import re
import shutil
import tarfile
import threading
import time
import zipfile
import urllib.error
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

KEY = os.environ.get("NGC_API_KEY") or os.environ.get("NGC_CLI_API_KEY") or ""
ORG = os.environ.get("NGC_ORG", "0491162300748285")
RES = os.environ.get("NGC_RESOURCE", "session-captures")
PORT = int(os.environ.get("PORT", "8090"))
CACHE = os.environ.get("CACHE_DIR", "/tmp/dashboard-cache")
AUTHN = "https://authn.nvidia.com/token?service=ngc&scope=group/ngc:{org}"
API = "https://api.ngc.nvidia.com/v2/org/{org}/resources/{res}/versions/{sid}/files/{fname}"
HERE = os.path.dirname(os.path.abspath(__file__))
_HEX = re.compile(r"[^0-9a-fA-F]")
os.makedirs(CACHE, exist_ok=True)

_locks = {}
_guard = threading.Lock()
_tok = {"jwt": None, "ts": 0}
_tok_lock = threading.Lock()


def _sid_lock(sid):
    with _guard:
        return _locks.setdefault(sid, threading.Lock())


def ngc_token():
    """Exchange the API key for a bearer token (cached ~4 min)."""
    with _tok_lock:
        if _tok["jwt"] and (time.time() - _tok["ts"]) < 240:
            return _tok["jwt"]
        req = urllib.request.Request(AUTHN.format(org=ORG))
        req.add_header("Authorization", "Basic " + base64.b64encode(f"$oauthtoken:{KEY}".encode()).decode())
        with urllib.request.urlopen(req, timeout=30) as r:
            _tok["jwt"] = json.load(r)["token"]
            _tok["ts"] = time.time()
            return _tok["jwt"]


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *a, **k):  # don't auto-follow; we fetch the signed URL cleanly
        return None


_opener = urllib.request.build_opener(_NoRedirect)


def ngc_download(sid, dest):
    """Download <sid>.tar.gz: authed request -> 302 signed URL -> fetch the file."""
    token = ngc_token()
    url = API.format(org=ORG, res=RES, sid=sid, fname=f"{sid}.tar.gz")
    req = urllib.request.Request(url)
    req.add_header("Authorization", "Bearer " + token)
    try:
        resp = _opener.open(req, timeout=60)  # a 2xx here would be the file directly
        with open(dest, "wb") as f:
            shutil.copyfileobj(resp, f)
        return None
    except urllib.error.HTTPError as e:
        if e.code in (301, 302, 303, 307, 308):
            loc = e.headers.get("Location")
            if not loc:
                return "redirect without a location"
            with urllib.request.urlopen(loc, timeout=180) as r, open(dest, "wb") as f:  # signed URL, no auth
                shutil.copyfileobj(r, f)
            return None
        if e.code in (401, 403):
            return "not authorized for this resource (check the API key / org)"
        if e.code == 404:
            return "session not found in NGC"
        return f"NGC HTTP {e.code}"
    except Exception as e:  # noqa: BLE001
        return f"NGC download error: {e}"


def prepare(sid):
    """Download + extract (idempotent, cached). Returns (content_dir, error)."""
    base = os.path.join(CACHE, sid)
    content = os.path.join(base, "content")
    ready = os.path.join(base, ".ready")
    with _sid_lock(sid):
        if os.path.exists(ready):
            return content, None
        os.makedirs(content, exist_ok=True)
        tar = os.path.join(base, f"{sid}.tar.gz")
        err = ngc_download(sid, tar)
        if err:
            return None, err
        try:
            with tarfile.open(tar) as t:
                t.extractall(content)
        except Exception as e:  # noqa: BLE001
            return None, f"extract failed: {e}"
        open(ready, "w").close()
        return content, None


def scan(content):
    log_p = tr_p = sess_p = None
    audios = []
    for root, _dirs, files in os.walk(content):
        for f in files:
            p = os.path.join(root, f)
            if f == "session.log":
                log_p = p
            elif f == "transcript.txt":
                tr_p = p
            elif re.match(r"^session\.(wav|webm|ogg|mp3|m4a)$", f):
                sess_p = p  # a true full-session recording, if the capture includes one
            elif f.endswith(".wav") and (f.startswith("asr_") or f.startswith("tts_")):
                m = re.search(r"_(\d+)\.wav$", f)
                audios.append({"name": f, "kind": "asr" if f.startswith("asr_") else "tts",
                               "idx": int(m.group(1)) if m else 0, "path": p,
                               "bytes": os.path.getsize(p)})
    audios.sort(key=lambda a: (a["idx"], a["kind"]))
    return log_p, tr_p, sess_p, audios


def read_text(p, cap=4_000_000):
    if not p or not os.path.exists(p):
        return ""
    with open(p, "r", errors="replace") as f:
        return f.read(cap)


def _find_by_name(content, name):
    for root, _dirs, files in os.walk(content):
        if name in files:
            return os.path.join(root, name)
    return None


class Handler(BaseHTTPRequestHandler):
    def _send(self, code, ctype, body, extra=None):
        if isinstance(body, str):
            body = body.encode()
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        for k, v in (extra or {}).items():
            self.send_header(k, v)
        self.end_headers()
        try:
            self.wfile.write(body)
        except Exception:  # noqa: BLE001
            pass

    def _json(self, code, obj):
        self._send(code, "application/json", json.dumps(obj))

    def _audio_ctype(self, name):
        ext = name.rsplit(".", 1)[-1].lower()
        return {"wav": "audio/wav", "webm": "audio/webm", "ogg": "audio/ogg",
                "mp3": "audio/mpeg", "m4a": "audio/mp4"}.get(ext, "application/octet-stream")

    def do_GET(self):
        path = self.path.split("?", 1)[0]
        if path in ("/", "/index.html"):
            return self._send(200, "text/html; charset=utf-8", read_text(os.path.join(HERE, "index.html")))
        if path == "/healthz":
            return self._json(200, {"ok": True, "org": ORG, "resource": RES})

        m = re.match(r"^/api/session/([0-9a-fA-F]+)/audio/([A-Za-z0-9_.\-]+)$", path)
        if m:
            sid = _HEX.sub("", m.group(1))[:32]
            name = os.path.basename(m.group(2))
            content, err = prepare(sid)
            if err:
                return self._json(404, {"error": err})
            p = _find_by_name(content, name)
            if not p:
                return self._json(404, {"error": "audio not found"})
            with open(p, "rb") as f:
                return self._send(200, self._audio_ctype(name), f.read(), {"Cache-Control": "no-cache"})

        # per-tab downloads: transcript.txt, session.log, and audio (zip of clips,
        # or the full recording if the capture has one).
        m = re.match(r"^/api/session/([0-9a-fA-F]+)/download/(transcript|log|audio)$", path)
        if m:
            sid = _HEX.sub("", m.group(1))[:32]
            what = m.group(2)
            content, err = prepare(sid)
            if err:
                return self._json(404, {"error": err})
            log_p, tr_p, sess_p, audios = scan(content)
            if what == "transcript":
                if not tr_p:
                    return self._json(404, {"error": "no transcript in this capture"})
                with open(tr_p, "rb") as f:
                    return self._send(200, "text/plain; charset=utf-8", f.read(),
                                      {"Content-Disposition": f'attachment; filename="{sid}_transcript.txt"'})
            if what == "log":
                if not log_p:
                    return self._json(404, {"error": "no log in this capture"})
                with open(log_p, "rb") as f:
                    return self._send(200, "text/plain; charset=utf-8", f.read(),
                                      {"Content-Disposition": f'attachment; filename="{sid}_session.log"'})
            # audio: prefer a real full-session recording, else zip the per-turn clips
            if sess_p:
                fn = os.path.basename(sess_p)
                with open(sess_p, "rb") as f:
                    return self._send(200, self._audio_ctype(fn), f.read(),
                                      {"Content-Disposition": f'attachment; filename="{sid}_{fn}"'})
            if not audios:
                return self._json(404, {"error": "no audio in this capture"})
            buf = io.BytesIO()
            with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
                for a in audios:
                    z.write(a["path"], arcname=a["name"])
            return self._send(200, "application/zip", buf.getvalue(),
                              {"Content-Disposition": f'attachment; filename="{sid}_audio.zip"'})

        m = re.match(r"^/api/session/([0-9a-fA-F]+)$", path)
        if m:
            sid = _HEX.sub("", m.group(1))[:32]
            if not sid:
                return self._json(400, {"error": "invalid session id"})
            content, err = prepare(sid)
            if err:
                return self._json(404, {"error": err, "sid": sid})
            log_p, tr_p, sess_p, audios = scan(content)
            return self._json(200, {
                "sid": sid,
                "transcript": read_text(tr_p),
                "log": read_text(log_p),
                "sessionAudio": (f"/api/session/{sid}/audio/{os.path.basename(sess_p)}" if sess_p else None),
                "audios": [{"name": a["name"], "kind": a["kind"], "idx": a["idx"], "bytes": a["bytes"],
                            "url": f"/api/session/{sid}/audio/{a['name']}"} for a in audios],
            })

        return self._send(404, "text/plain", "not found")

    def log_message(self, *a):
        return


if __name__ == "__main__":
    if not KEY:
        raise SystemExit("ERROR: NGC_API_KEY (or NGC_CLI_API_KEY) must be set before starting.")
    print(f"session-dashboard: listening on :{PORT}  (NGC {ORG}/{RES}, cache {CACHE})", flush=True)
    ThreadingHTTPServer(("0.0.0.0", PORT), Handler).serve_forever()

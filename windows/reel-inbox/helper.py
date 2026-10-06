"""Outbound-only Reel Inbox worker. No browser cookies, inbound server or publishing."""
from __future__ import annotations
import argparse
import base64
import csv
import hashlib
import html
import io
import ipaddress
import json
import os
from pathlib import Path
import re
import socket
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid

ROOT = Path(r"C:\Users\Pumkn\OneDrive\Desktop\kiiikiiii\01 - Workflow\01 Vorlagen SFW\Videos")
GALLERY = Path(r"C:\Users\Pumkn\OneDrive\Desktop\kiiikiiii\00 - Medienuebersicht 2026-10-06")
ORIGIN = "https://instascanner.app"
STAGES = ("Neu", "In Arbeit", "Verwendet")
MAX_BYTES = 512 * 1024 * 1024

class InboxError(Exception):
    def __init__(self, code):
        super().__init__(code)
        self.code = code

def safe_path(path: Path, root: Path):
    path, root = Path(os.path.abspath(path)), Path(os.path.abspath(root))
    if not path.is_relative_to(root):
        raise InboxError("path_blocked")
    for node in (path, *path.parents):
        if node.is_symlink() or (hasattr(node, "is_junction") and node.is_junction()):
            raise InboxError("path_blocked")
    return path

def reel_url(raw):
    u = urllib.parse.urlsplit(raw)
    match = re.fullmatch(r"/(reel|reels|p)/([A-Za-z0-9_-]{5,64})/?", u.path)
    if u.scheme != "https" or u.hostname not in ("www.instagram.com", "instagram.com", "m.instagram.com") or u.username or u.password or u.port or not match:
        raise InboxError("unsupported")
    return f"https://www.instagram.com/{'p' if match[1]=='p' else 'reel'}/{match[2]}/", match[2]

def digest(path):
    h = hashlib.sha256()
    with path.open("rb") as source:
        for block in iter(lambda: source.read(1024 * 1024), b""):
            h.update(block)
    return h.hexdigest()

def write_new(path, content):
    with path.open("x", encoding="utf-8") as f:
        f.write(content)
        f.flush()
        os.fsync(f.fileno())

def tree_hash(folder, root):
    result = {}
    for path in folder.rglob("*"):
        safe_path(path, root)
        if path.is_file():
            result[str(path.relative_to(folder))] = digest(path)
    return result

def media_url(url):
    u = urllib.parse.urlsplit(url)
    if u.scheme != "https" or u.username or u.password or u.port not in (None, 443) or not u.hostname:
        raise InboxError("unsupported")
    if not any(u.hostname.endswith("." + host) or u.hostname == host for host in ("cdninstagram.com", "fbcdn.net")):
        raise InboxError("unsupported")
    try:
        addresses = socket.getaddrinfo(u.hostname, 443, type=socket.SOCK_STREAM)
    except OSError:
        raise InboxError("interrupted")
    if not addresses or any(not ipaddress.ip_address(a[4][0]).is_global for a in addresses):
        raise InboxError("unsupported")
    return url

class MediaRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        media_url(newurl)
        return super().redirect_request(req, fp, code, msg, headers, newurl)

def download_public(url, target):
    media_url(url)
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), MediaRedirect())
    try:
        with opener.open(urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"}), timeout=25) as response, target.open("xb") as out:
            expected = int(response.headers.get("Content-Length", 0))
            if expected > MAX_BYTES:
                raise InboxError("validation")
            size = 0
            deadline = time.monotonic() + 150
            while True:
                if time.monotonic() > deadline:
                    raise InboxError("interrupted")
                block = response.read(256 * 1024)
                if not block:
                    break
                size += len(block)
                if size > MAX_BYTES:
                    raise InboxError("validation")
                out.write(block)
            out.flush()
            os.fsync(out.fileno())
            if not size or (expected and expected != size):
                raise InboxError("interrupted")
    except urllib.error.HTTPError as e:
        raise InboxError("unavailable" if e.code in (401,403,404,410,429) else "interrupted") from None
    except (urllib.error.URLError, TimeoutError, ConnectionError):
        raise InboxError("interrupted") from None

def run_tool(args, timeout=90):
    try:
        result = subprocess.run(args, capture_output=True, timeout=timeout, creationflags=getattr(subprocess,"CREATE_NO_WINDOW",0))
    except FileNotFoundError:
        raise InboxError("setup") from None
    except subprocess.TimeoutExpired:
        raise InboxError("interrupted") from None
    if result.returncode:
        # Never log extractor output: it may contain signed CDN URLs.
        raise InboxError("validation")
    return result.stdout

def extract(raw):
    url, _ = reel_url(raw)
    try:
        data = json.loads(run_tool([sys.executable, "-m", "yt_dlp", "--ignore-config", "--no-playlist", "--skip-download", "--dump-single-json", "--socket-timeout", "20", "--retries", "1", "--extractor-retries", "1", "--", url], 75))
    except (InboxError, ValueError) as e:
        if isinstance(e, InboxError) and e.code in ("setup", "interrupted"):
            raise
        raise InboxError("unavailable") from None
    if data.get("_type") in ("playlist", "multi_video"):
        raise InboxError("unsupported")
    all_formats = data.get("formats", [data])
    separate_audio = any(f.get("vcodec") == "none" and f.get("acodec") != "none" for f in all_formats)
    # Truly silent Reels are valid. Never silently discard a separate audio track.
    formats = [f for f in all_formats if f.get("ext") == "mp4" and f.get("vcodec") != "none" and (f.get("acodec") != "none" or not separate_audio) and str(f.get("url", "")).startswith("https://") and f.get("protocol", "https") in ("http", "https")]
    if not formats:
        raise InboxError("unsupported")
    selected = max(formats, key=lambda f: (f.get("height") or 0, f.get("width") or 0, f.get("tbr") or 0))
    media_url(selected["url"])
    return selected["url"], {"title": str(data.get("title") or "Instagram Reel")[:500], "creator": str(data.get("uploader") or data.get("channel") or "")[:200]}

def validate_video(path, ffprobe, ffmpeg):
    if not 0 < path.stat().st_size <= MAX_BYTES:
        raise InboxError("validation")
    try:
        probe = json.loads(run_tool([ffprobe,"-v","error","-show_format","-show_streams","-of","json",str(path)]))
        videos = [s for s in probe["streams"] if s.get("codec_type") == "video" and not s.get("disposition",{}).get("attached_pic")]
        duration = float(probe["format"]["duration"])
        if not videos or not 0 < duration <= 3600 or "mp4" not in probe["format"]["format_name"]:
            raise InboxError("validation")
        run_tool([ffmpeg,"-nostdin","-v","error","-xerror","-i",str(path),"-f","null","-"], 120)
        v = videos[0]
        return {"bytes":path.stat().st_size,"sha256":digest(path),"duration":duration,"width":int(v["width"]),"height":int(v["height"])}
    except (ValueError, KeyError, IndexError):
        raise InboxError("validation") from None

class Library:
    def __init__(self, root=ROOT, gallery=GALLERY):
        self.root, self.gallery = Path(root), Path(gallery)
        safe_path(self.root, self.root)
        self.root.mkdir(parents=True, exist_ok=True)
        for stage in (*STAGES, ".staging"):
            safe_path(self.root / stage, self.root).mkdir(exist_ok=True)

    def name(self, job):
        _, code = reel_url(job["canonical_url"])
        if code != job["shortcode"] or str(uuid.UUID(job["id"])) != job["id"] or job["desired_stage"] not in STAGES:
            raise InboxError("path_blocked")
        return f"{code}_{job['id']}"

    def locate(self, job):
        name = self.name(job)
        found = [safe_path(self.root / s / name, self.root) for s in STAGES if (self.root / s / name).exists()]
        if len(found) > 1:
            raise InboxError("conflict")
        if not found:
            return None
        folder = found[0]
        try:
            manifest = json.loads(safe_path(folder / "reel.json", self.root).read_text(encoding="utf-8"))
            video = safe_path(folder / "video.mp4", self.root)
            if manifest["id"] != job["id"] or manifest["shortcode"] != job["shortcode"] or digest(video) != manifest["sha256"]:
                raise InboxError("conflict")
        except (OSError, ValueError, KeyError):
            raise InboxError("conflict") from None
        return folder

    def process(self, job, ffprobe, ffmpeg, extractor=extract, downloader=download_public, validator=validate_video, checkpoint=lambda: None):
        name = self.name(job)
        folder = self.locate(job)
        if folder is None:
            if job.get("confirmed_stage"):
                raise InboxError("conflict")  # Never silently recreate a missing confirmed original.
            attempt = safe_path(self.root / ".staging" / str(uuid.uuid4()), self.root)
            attempt.mkdir()
            write_new(attempt / "job.json", json.dumps({"id":job["id"], "is_test":job.get("is_test",False)}))
            url, metadata = extractor(job["canonical_url"])
            checkpoint()
            partial = attempt / "video.part"
            downloader(url, partial)
            checkpoint()
            verified = validator(partial, ffprobe, ffmpeg)
            checkpoint()
            partial.rename(attempt / "video.mp4")
            # Content dedupe across different Instagram shortcodes; keep candidate staged.
            inventory = self.gallery / "Inventar.json"
            if inventory.is_file():
                if any(entry.get("sha256") == verified["sha256"] for entry in json.loads(inventory.read_text(encoding="utf-8-sig"))):
                    raise InboxError("conflict")
            for stage in STAGES:
                for existing in (self.root / stage).glob("*/reel.json"):
                    safe_path(existing, self.root)
                    if json.loads(existing.read_text(encoding="utf-8")).get("sha256") == verified["sha256"]:
                        raise InboxError("conflict")
            try:
                run_tool([ffmpeg,"-nostdin","-v","error","-i",str(attempt / "video.mp4"),"-frames:v","1","-vf","scale=320:-2","-q:v","6",str(attempt / "preview.jpg")])
            except InboxError:
                pass  # A preview failure never invalidates a fully validated original.
            manifest = {**metadata,**verified,"id":job["id"],"shortcode":job["shortcode"],"source":reel_url(job["canonical_url"])[0],"is_test":job.get("is_test",False),"downloaded_at":time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())}
            write_new(attempt / "reel.json", json.dumps(manifest,ensure_ascii=False,indent=2))
            write_new(attempt / "QUELLE.txt", ("TESTMATERIAL\n" if manifest["is_test"] else "") + manifest["source"] + "\n")
            folder = safe_path(self.root / "Neu" / name, self.root)
            checkpoint()
            if folder.exists():
                raise InboxError("conflict")
            # Same-volume directory rename commits the complete package at once.
            attempt.rename(folder)
        destination = safe_path(self.root / job["desired_stage"] / name, self.root)
        if destination != folder:
            checkpoint()
            before = tree_hash(folder, self.root)
            if destination.exists():
                raise InboxError("conflict")
            folder.rename(destination)  # No cross-volume copy/delete fallback.
            if tree_hash(destination, self.root) != before:
                raise InboxError("conflict")
            folder = destination
        manifest = json.loads((folder / "reel.json").read_text(encoding="utf-8"))
        receipt = {k:manifest[k] for k in ("title","creator","sha256","bytes","duration","width","height")}
        receipt.update(stage=folder.parent.name, folder=f"{folder.parent.name}/{name}", gallery=False)
        preview = safe_path(folder / "preview.jpg", self.root)
        if preview.exists() and preview.stat().st_size <= 130000:
            receipt["thumbnail"] = "data:image/jpeg;base64," + base64.b64encode(preview.read_bytes()).decode()
        try:
            self.rebuild_gallery()
            receipt["gallery"] = True
        except (OSError, ValueError, InboxError):
            pass
        return receipt

    def rebuild_gallery(self):
        # Companion view merges the original inventory with references, without touching it.
        target = safe_path(self.root / "Reel Inbox Galerie", self.root)
        target.mkdir(exist_ok=True)
        items = []
        original = self.gallery / "Inventar.json"
        if original.is_file():
            for entry in json.loads(original.read_text(encoding="utf-8-sig")):
                # Keep private material out of this SFW companion view.
                if entry.get("private") or "NSFW" in entry.get("category", "").upper():
                    continue
                file = (self.gallery / entry["file"]).resolve()
                items.append({"title":entry.get("label",file.name),"file":os.path.relpath(file,target).replace("\\","/"),"stage":entry.get("category","Bestand"),"video":bool(entry.get("is_video")),"test":False,"sha256":entry.get("sha256","")})
        for stage in STAGES:
            for m in sorted((self.root / stage).glob("*/reel.json")):
                safe_path(m,self.root)
                data = json.loads(m.read_text(encoding="utf-8"))
                items.append({"title":data["title"],"file":os.path.relpath(m.parent / "video.mp4",target).replace("\\","/"),"stage":stage,"video":True,"test":data["is_test"],"sha256":data["sha256"]})
        body = json.dumps(items,ensure_ascii=False).replace("<","\\u003c")
        page = '''<!doctype html><html lang="de"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Kiikii · Reel Inbox</title><style>body{font:16px system-ui;background:#101214;color:#eee;margin:24px}a{color:#b6e68a}input,select{padding:12px;margin:8px;background:#232923;color:white}main{display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:20px}article{padding:15px;background:#1b201c;border-radius:12px}video,img{width:100%;max-height:350px}h2{font-size:16px;overflow-wrap:anywhere}</style><h1>Kiikii · Reel Inbox</h1><p>Vorlagen und vorhandene Galerie. Medien werden direkt am Speicherort geöffnet.</p><p><a href="ORIGINAL">Bisherige Galerie öffnen</a> · <a href="Inventar.csv">Inventar</a></p><input id="q" aria-label="Suchen" placeholder="Suchen"><select id="stage" aria-label="Status"><option>Alle</option></select><main></main><script>const items=DATA;const q=document.querySelector('#q'),s=document.querySelector('#stage');for(const stage of [...new Set(items.map(i=>i.stage))]){const o=document.createElement('option');o.textContent=stage;s.append(o)}function render(){const grid=document.querySelector('main');grid.replaceChildren();for(const i of items.filter(i=>(s.value==='Alle'||i.stage===s.value)&&i.title.toLowerCase().includes(q.value.toLowerCase()))){const a=document.createElement('article'),h=document.createElement('h2'),v=document.createElement(i.video?'video':'img'),p=document.createElement('p');h.textContent=(i.test?'TEST · ':'')+i.title;p.textContent=i.stage;v.src=i.file.split('/').map(encodeURIComponent).join('/');if(i.video){v.controls=true;v.preload='none'}else{v.loading='lazy';v.alt=i.title}a.append(v,h,p);grid.append(a)}}q.oninput=s.onchange=render;render();</script></html>'''.replace("DATA",body).replace("ORIGINAL",html.escape(os.path.relpath(self.gallery / "START.html",target).replace("\\","/"),quote=True))
        stream=io.StringIO(); writer=csv.DictWriter(stream,fieldnames=["title","file","stage","video","test","sha256"]);writer.writeheader();writer.writerows(items)
        for name, content in (("START.html",page),("Inventar.json",json.dumps(items,ensure_ascii=False,indent=2)),("Inventar.csv",stream.getvalue())):
            destination = safe_path(target / name,self.root)
            temp = safe_path(target / (name + "." + uuid.uuid4().hex + ".tmp"),self.root)
            write_new(temp,content)
            os.replace(temp,destination)  # Only this worker's generated views, never originals.

class Cloud:
    def __init__(self, token, origin=ORIGIN):
        if origin != ORIGIN or not re.fullmatch(r"[a-f0-9]{64}",token):
            raise InboxError("setup")
        self.token=token
    def call(self,payload):
        req=urllib.request.Request(ORIGIN+"/api/reel-inbox/worker",data=json.dumps(payload).encode(),headers={"Authorization":"Bearer "+self.token,"Content-Type":"application/json"},method="POST")
        class NoRedirect(urllib.request.HTTPRedirectHandler):
            def redirect_request(self,*args,**kwargs): return None
        with urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect()).open(req,timeout=30) as response:
            return json.load(response)

def cycle(cloud, library, instance, ffprobe, ffmpeg):
    job=cloud.call({"action":"claim","instance":instance})
    if not job: return False
    def checkpoint():
        if os.environ.get("REEL_INBOX_STOP") and Path(os.environ["REEL_INBOX_STOP"]).exists():
            raise InboxError("interrupted")
        cloud.call({"action":"renew","id":job["id"],"lease":job["lease_id"]})
    try:
        receipt=library.process(job,ffprobe,ffmpeg,checkpoint=checkpoint)
    except InboxError as error:
        cloud.call({"action":"fail","id":job["id"],"lease":job["lease_id"],"code":error.code})
        return True
    except OSError:
        cloud.call({"action":"fail","id":job["id"],"lease":job["lease_id"],"code":"disk_error"})
        return True
    cloud.call({"action":"ack","id":job["id"],"lease":job["lease_id"],"receipt":receipt})
    return True

def main():
    parser=argparse.ArgumentParser();parser.add_argument("--once",action="store_true");args=parser.parse_args()
    if os.name != "nt": raise InboxError("setup")
    state=Path(os.environ["USERPROFILE"]) / ".local" / "share" / "InstaScanner" / "ReelInbox"
    safe_path(state,state);state.mkdir(parents=True,exist_ok=True)
    # OS-released lock, so a crash does not leave a permanent lock file.
    import msvcrt
    with (state / "worker.lock").open("a+b") as lock:
        lock.seek(0);lock.write(b"0");lock.flush();lock.seek(0)
        try: msvcrt.locking(lock.fileno(),msvcrt.LK_NBLCK,1)
        except OSError: return
        config=json.loads((state / "config.json").read_text(encoding="utf-8-sig"))
        for name in ("ffmpeg","ffprobe"):
            if not Path(config[name]).is_file(): raise InboxError("setup")
        token=os.environ.pop("REEL_INBOX_TOKEN","")
        cloud=Cloud(token);library=Library()
        if (state / "STOP").exists(): return
        failures=0
        while not (state / "STOP").exists():
            try:
                worked=cycle(cloud,library,config["instance"],config["ffprobe"],config["ffmpeg"])
                failures=0; status="online"
            except Exception:
                failures+=1;worked=False;status="offline_or_pairing_required"
            stamp={"status":status,"checked_at":time.strftime("%Y-%m-%dT%H:%M:%SZ",time.gmtime()),"failures":failures}
            (state / "status.json").write_text(json.dumps(stamp),encoding="utf-8")
            if args.once: break
            for _ in range(1 if worked else min(120,30 * max(1,failures))):
                if (state / "STOP").exists(): break
                time.sleep(1)

if __name__ == "__main__":
    try: main()
    except Exception: print("Reel Inbox: Einrichtung prüfen. Keine Zugangsdaten werden protokolliert.",file=sys.stderr);sys.exit(1)

"""Outbound draft worker; optional operator-provided IG session, no publishing permission."""
import hashlib
import json
import math
import os
from pathlib import Path
import re
import shutil
import time
import urllib.request
import urllib.parse
import urllib.error
import uuid
import inbox_helper as media
from source_upload import download_upload

ROOT = Path(os.environ.get("WORK_DIR", "/data"))
REFS = Path(os.environ.get("REFERENCE_DIR", "/references"))
ORIGIN = "https://instascanner.app"
WAVE = "https://api.wavespeed.ai/api/v3"

class StopJob(Exception):
    pass

def generation_prompt(config, job):
    prompt_id = job.get("prompt_id")
    if prompt_id is None:
        base = config["prompt"]  # Compatibility for jobs created before prompt selection.
    else:
        if prompt_id not in ("prompt_1", "prompt_2"):
            raise StopJob("setup")
        base = config.get("prompts", {}).get(prompt_id)
        if not isinstance(base, str) or not base.strip():
            raise StopJob("setup")
    feedback = job.get("revision_notes", "").strip()
    if not feedback:
        return base
    return (base + "\n\nREVISION REQUEST: Recreate from the ORIGINAL source video. "
        "Apply the following reviewer corrections; preserve everything not mentioned. "
        "Maintain temporal consistency across every frame.\n" + feedback +
        "\nFor clothing consistency corrections, preserve the exact original source outfit, "
        "colors, coverage, cut and accessories throughout. Do not import clothing from identity reference images.")

def prepare_source(source):
    info=media.validate_video(source,"ffprobe","ffmpeg")
    duration=info["duration"]
    if not 2<=duration<=17:
        raise StopJob("duration")
    if duration<=15:
        return info
    original=source.with_name("source.original.mp4")
    if not original.exists():
        shutil.copyfile(source,original)
    trimmed=source.with_name("source.trim.part.mp4")
    media.run_tool(["ffmpeg","-nostdin","-v","error","-y","-i",str(source),
        "-t","15","-map","0:v:0","-map","0:a:0?","-c:v","libx264",
        "-preset","fast","-crf","18","-c:a","aac","-b:a","192k",
        "-movflags","+faststart",str(trimmed)],180)
    checked=media.validate_video(trimmed,"ffprobe","ffmpeg")
    if not 14.8<=checked["duration"]<=15:
        raise StopJob("validation")
    os.replace(trimmed,source)
    source.with_name("trim.json").write_text(json.dumps({"original_duration":duration,
        "start":0,"end":15,"reason":"User approved shortening sources up to 17 seconds inclusive"}))
    return checked

class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        raise StopJob("validation")

def request(url, data=None, method="POST", headers=None, timeout=90):
    # Never log URLs or raw provider exceptions: these can contain credentials.
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())
    try:
        with opener.open(urllib.request.Request(url, data=data, headers={"User-Agent":"InstaScanner-ModelWorker/1.0", **(headers or {})}, method=method), timeout=timeout) as r:
            return json.loads(r.read(2 * 1024 * 1024))
    except (OSError, ValueError, urllib.error.URLError):
        raise StopJob("unconfirmed") from None

def api(action, job=None, **payload):
    body = {"action": action, **payload}
    if job:
        body.update(id=job["id"], lease=job["lease"])
    return request(ORIGIN + "/api/model-pipeline/worker", json.dumps(body).encode(), headers={
        "Authorization": "Bearer " + os.environ["PIPELINE_WORKER_TOKEN"], "Content-Type": "application/json"})

def wave(path, data=None):
    return request(WAVE + path, json.dumps(data).encode() if data is not None else None,
        "POST" if data is not None else "GET", {"Authorization":"Bearer " + os.environ["WAVESPEED_API_KEY"],"Content-Type":"application/json"})

def upload(path, content_type):
    r = request(WAVE + "/media/upload/binary", path.read_bytes(), headers={
        "Authorization":"Bearer " + os.environ["WAVESPEED_API_KEY"],"Content-Type":content_type,"file":path.name})
    url = r.get("data", {}).get("download_url", "")
    if r.get("code") != 200 or urllib.parse.urlsplit(url).scheme != "https":
        raise StopJob("setup")
    return url

def checkpoint(state):
    ROOT.mkdir(parents=True, exist_ok=True)
    temp = ROOT / "current.tmp"
    with temp.open("w", encoding="utf8") as f:
        json.dump(state, f); f.flush(); os.fsync(f.fileno())
    os.replace(temp, ROOT / "current.json")

def archive(state):
    checkpoint(state)
    os.replace(ROOT / "current.json", ROOT / (state["job"]["id"] + ".json"))

def profile(model):
    profiles = json.loads((REFS / "models.json").read_text(encoding="utf-8-sig"))
    result = profiles[model]
    files = []
    for entry in result["references"]:
        path = (REFS / entry["file"]).resolve()
        if not path.is_relative_to(REFS.resolve()) or path.is_symlink() or media.digest(path) != entry["sha256"]:
            raise StopJob("setup")
        files.append(path)
    if len(files) != 3 or not result["prompt"].strip():
        raise StopJob("setup")
    return result, files

def job_profile(job):
    # Older jobs without the new column retain their existing model profile.
    key = job.get("reference_profile", job["model"])
    if key != job["model"] or key not in ("kiikii", "tuuva"):
        raise StopJob("setup")
    return profile(key)

def generation_request(config, job, source, refs, info):
    return {"prompt": generation_prompt(config, job),
        "video": upload(source, "video/mp4"),
        "reference_images": [upload(p, "image/png" if p.suffix == ".png" else "image/jpeg") for p in refs],
        "resolution": "720p", "duration": math.ceil(info["duration"]),
        "generate_audio": False, "enable_prompt_expansion": False}

def wave_download(url, path):
    u = urllib.parse.urlsplit(url)
    # Verified provider output host; fail closed if provider changes its CDN.
    if u.scheme != "https" or u.hostname != "d2h7xmz5gqybh9.cloudfront.net" or u.username or u.password or u.port:
        raise StopJob("validation")
    opener=urllib.request.build_opener(urllib.request.ProxyHandler({}),NoRedirect())
    try:
        with opener.open(url,timeout=60) as r, path.open("wb") as out:
            size=0
            while True:
                chunk=r.read(1024*1024)
                if not chunk:break
                size+=len(chunk)
                if size>100*1024*1024:raise StopJob("validation")
                out.write(chunk)
    except (OSError,urllib.error.URLError):raise StopJob("unconfirmed") from None

def deliver(state, folder, config):
    job=state["job"]
    result=wave("/predictions/"+state["provider_id"]+"/result").get("data",{})
    if result.get("status")=="failed":raise StopJob("provider_failed")
    if result.get("status")!="completed":return
    final=folder/"final.mp4"
    if not final.exists():
        outputs=result.get("outputs",[])
        if len(outputs)!=1:raise StopJob("validation")
        generated=folder/"generated.mp4"
        wave_download(outputs[0],generated)
        original=media.validate_video(folder/"source.mp4","ffprobe","ffmpeg")
        verified=media.validate_video(generated,"ffprobe","ffmpeg")
        if abs(verified["duration"]-original["duration"])>1.1 or min(verified["width"],verified["height"])<700:
            raise StopJob("validation")
        # Restore the exact source audio and preserve its original duration.
        media.run_tool(["ffmpeg","-nostdin","-v","error","-y","-i",str(generated),"-i",str(folder/"source.mp4"),"-map","0:v:0","-map","1:a:0?","-c:v","copy","-c:a","aac","-b:a","192k","-t",str(original["duration"]),"-movflags","+faststart",str(folder/"final.part.mp4")],180)
        checked=media.validate_video(folder/"final.part.mp4","ffprobe","ffmpeg")
        if checked["bytes"]>40*1024*1024:raise StopJob("validation")
        os.replace(folder/"final.part.mp4",final)
    upload_info=api("review",job,caption=job.get("revision_caption") if job.get("revision_caption") is not None else config["caption"])
    if not upload_info.get("uploaded"):
        target=urllib.parse.urlsplit(upload_info["upload_url"])
        if target.scheme!="https" or target.hostname!="vkudzmoaqskmglfajzkz.supabase.co" or not target.path.startswith("/storage/v1/object/upload/sign/content-review/"):
            raise StopJob("validation")
        try:
            request(upload_info["upload_url"],final.read_bytes(),"PUT",{"Content-Type":"video/mp4","x-upsert":"false"})
        except StopJob:
            # Lost upload response is resolved by server-side hash validation, never overwrite.
            pass
    receipt=api("finish",job)
    if not receipt.get("finished"):raise StopJob("unconfirmed")
    state["finished"]=True;archive(state)
    print("Review delivered",job["id"],flush=True)

def tick():
    current=ROOT/"current.json"
    if current.exists():state=json.loads(current.read_text())
    else:
        job=api("claim")
        if not job:return
        state={"job":job};checkpoint(state)
    job=state["job"]
    if str(uuid.UUID(job["id"]))!=job["id"]:raise StopJob("validation")
    folder=ROOT/job["id"];folder.mkdir(exist_ok=True)
    try:
        config,refs=job_profile(job)
        remote=api("get",job)
        if remote["state"] in ("blocked","budget_wait"):
            state["remote_state"]=remote["state"];archive(state);return
        if remote["state"]=="review":
            api("finish",job);state["finished"]=True;archive(state);return
        if "provider_id" in state:
            api("submitted",job,provider_id=state["provider_id"])
            deliver(state,folder,config);return
        if state.get("submit_intent") or remote["state"]=="reserved":
            # Crash or timeout after submission: manual reconciliation; never charge twice.
            raise StopJob("provider_uncertain")
        source=folder/"source.mp4"
        if not source.exists() and job.get("parent_job_id"):
            parent_id=str(uuid.UUID(job["parent_job_id"]))
            original=ROOT/parent_id/"source.mp4"
            if original.is_file():
                shutil.copyfile(original,folder/"source.part")
                media.validate_video(folder/"source.part","ffprobe","ffmpeg")
                os.replace(folder/"source.part",source)
        if not source.exists():
            try:
                partial=folder/"source.part"
                if partial.exists():partial.unlink()
                if job.get("source_upload_id"):
                    try:
                        download_upload(ORIGIN, os.environ["PIPELINE_WORKER_TOKEN"], job, partial)
                    except Exception:
                        raise media.InboxError("source_unavailable") from None
                    metadata={"source":"private-upload"}
                else:
                    url,metadata=media.extract(job["source_url"], cookie_file=os.environ.get("INSTAGRAM_COOKIE_FILE"))
                    media.download_public(url,partial)
                media.validate_video(partial,"ffprobe","ffmpeg")
                os.replace(partial,source)
                (folder/"source.json").write_text(json.dumps(metadata),encoding="utf8")
            except media.InboxError:raise StopJob("source_unavailable") from None
        info=prepare_source(source)
        if not 0.5<=info["width"]/info["height"]<=0.65:raise StopJob("validation")
        # Uploads precede reservation so expensive side effects happen immediately afterwards.
        request_body=generation_request(config,job,source,refs,info)
        reservation=api("reserve",job,seconds=info["duration"])
        if reservation.get("budget_wait"):
            state["budget_wait"]=True;archive(state);return
        if reservation.get("state")!="reserved":raise StopJob("unconfirmed")
        state["submit_intent"]=True;checkpoint(state)
        try:r=wave("/alibaba/wan-3.0/video-edit",request_body)
        except StopJob:raise StopJob("provider_uncertain") from None
        prediction=r.get("data",{}).get("id","")
        if r.get("code")!=200 or not re.fullmatch("[a-f0-9]{32}",prediction):raise StopJob("provider_uncertain")
        state["provider_id"]=prediction;checkpoint(state)
        api("submitted",job,provider_id=prediction)
        print("Generation submitted",job["id"],flush=True)
    except StopJob as e:
        if str(e)=="unconfirmed":raise
        api("block",job,issue=str(e));state["issue"]=str(e);archive(state)
        print("Needs attention",job["id"],str(e),flush=True)
    except media.InboxError:
        api("block",job,issue="validation");state["issue"]="validation";archive(state)

if __name__=="__main__":
    import fcntl
    ROOT.mkdir(parents=True,exist_ok=True)
    lock=(ROOT/"worker.lock").open("w")
    fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
    for key in ["PIPELINE_WORKER_TOKEN","WAVESPEED_API_KEY"]:
        if not os.environ.get(key):raise SystemExit("Worker credentials not configured")
    while True:
        try:tick()
        except Exception:print("Worker waiting: request or configuration not confirmed",flush=True)
        time.sleep(30)

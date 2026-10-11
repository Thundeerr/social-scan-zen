"""Operator-enabled Firefox session bridge. Export Instagram cookies only, never log values."""
import os
from pathlib import Path
import sqlite3
import time
import shutil
import tempfile

HOSTS={"instagram.com", ".instagram.com", "www.instagram.com", "i.instagram.com"}
def render(rows, now):
    valid=[]
    for host,path,secure,expiry,name,value,http_only in rows:
        if host not in HOSTS or any(c in str(s) for s in (host,path,name,value) for c in "\t\r\n"):
            continue
        if expiry and expiry <= now:continue
        valid.append((host,path,secure,expiry,name,value,http_only))
    authenticated=any(row[4]=='sessionid' and row[5] for row in valid)
    lines=['# Netscape HTTP Cookie File']
    if authenticated:
        for host,path,secure,expiry,name,value,http_only in valid:
            domain=('#HttpOnly_' if http_only else '')+host
            lines.append('\t'.join((domain,'TRUE' if host.startswith('.') else 'FALSE',path,'TRUE' if secure else 'FALSE',str(expiry),name,value)))
    return '\n'.join(lines)+'\n',authenticated

def export(source,target):
    rows=[]
    if source.exists():
        # Firefox may hold an exclusive lock. Read a private, stable snapshot,
        # including the WAL, without touching its running profile.
        with tempfile.TemporaryDirectory(prefix='ig-session-') as scratch:
            snapshot=Path(scratch)/'cookies.sqlite'
            originals=[source,Path(str(source)+'-wal')]
            def stamps():
                return [(p.stat().st_size,p.stat().st_mtime_ns) if p.exists() else None for p in originals]
            for attempt in range(3):
                before=stamps()
                for p in originals:
                    dest=Path(scratch)/p.name
                    if p.exists():shutil.copyfile(p,dest);dest.chmod(0o600)
                    elif dest.exists():dest.unlink()
                if stamps()==before:break
            else:raise RuntimeError('Browser session is busy; retry on next timer tick')
            with sqlite3.connect(snapshot) as db:
                rows=db.execute('select host,path,isSecure,expiry,name,value,isHttpOnly from moz_cookies').fetchall()
    content,authenticated=render(rows,int(time.time()))
    target.parent.mkdir(parents=True,exist_ok=True,mode=0o710)
    os.chown(target.parent,0,10001)
    temp=target.with_suffix('.tmp')
    fd=os.open(temp,os.O_WRONLY|os.O_CREAT|os.O_TRUNC,0o600)
    with os.fdopen(fd,'w') as f:
        f.write(content);f.flush();os.fsync(f.fileno())
    os.chown(temp,10001,10001)
    os.chmod(temp,0o600)
    os.replace(temp,target)
    print('Instagram session ready' if authenticated else 'Waiting for Instagram login')

if __name__=='__main__':
    export(Path('/home/ig-browser/profile/cookies.sqlite'),Path('/var/lib/kiikii-instagram-session/instagram.txt'))

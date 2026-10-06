"""Explicitly invoked, labeled test of the user's supplied Instagram link."""
import json
import os
from pathlib import Path
import helper

job={'id':'7d446e78-6dab-4770-9693-a5e51b6267f1','shortcode':'DdQN9krAjJn','canonical_url':'https://www.instagram.com/p/DdQN9krAjJn/','desired_stage':'Neu','confirmed_stage':None,'is_test':True}
report={'test_material':True,'source':job['canonical_url'],'cookies_used':False}
try:
    library=helper.Library()
    receipt=library.process(job,os.environ['TEST_FFPROBE'],os.environ['TEST_FFMPEG'])
    report.update(status='downloaded_and_validated',receipt={k:v for k,v in receipt.items() if k!='thumbnail'})
except helper.InboxError as error:
    report.update(status='not_downloaded',error_code=error.code)
Path('.reel-inbox-test').mkdir(exist_ok=True)
Path('.reel-inbox-test/live-test.json').write_text(json.dumps(report,indent=2),encoding='utf-8')
print(json.dumps(report,indent=2))

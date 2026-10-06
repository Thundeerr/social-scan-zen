import json
import os
from pathlib import Path
import tempfile
import unittest
import uuid
from unittest.mock import patch
import helper

class LibraryTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory(); self.base=Path(self.tmp.name)
        self.gallery=self.base/'existing';self.gallery.mkdir()
        (self.gallery/'Inventar.json').write_text('[]')
        (self.gallery/'START.html').write_text('original')
        self.library=helper.Library(self.base/'Videos',self.gallery)
        self.job={'id':str(uuid.uuid4()),'shortcode':'DdQN9krAjJn','canonical_url':'https://www.instagram.com/p/DdQN9krAjJn/?stkn=tracking','desired_stage':'Neu','confirmed_stage':None,'is_test':True}
    def tearDown(self): self.tmp.cleanup()
    def process(self, downloader=None, **kwargs):
        def download(url,path): path.write_bytes(b'test-only-video')
        def validate(path,*_): return {'sha256':helper.digest(path),'bytes':path.stat().st_size,'duration':2.0,'width':640,'height':360}
        with patch.object(helper,'run_tool',side_effect=helper.InboxError('setup')):
            return self.library.process(self.job,'ffprobe','ffmpeg',extractor=lambda _:('https://example.test',{'title':'<script>test</script>','creator':'test'}),downloader=downloader or download,validator=validate,**kwargs)
    def test_atomic_download_duplicate_and_gallery(self):
        result=self.process();folder=self.library.locate(self.job)
        self.assertTrue(result['gallery']);self.assertTrue((folder/'video.mp4').exists())
        before=helper.tree_hash(folder,self.library.root)
        self.process(downloader=lambda *_:self.fail('must not download twice'))
        self.assertEqual(before,helper.tree_hash(folder,self.library.root))
        self.assertEqual((self.gallery/'START.html').read_text(),'original')
        page=(self.library.root/'Reel Inbox Galerie'/'START.html').read_text(encoding='utf-8')
        self.assertNotIn('<script>test</script>',page)
    def test_lossless_moves_and_lost_ack_recovery(self):
        self.process(); initial=helper.tree_hash(self.library.locate(self.job),self.library.root)
        for stage in ('In Arbeit','Verwendet','Neu'):
            self.job.update(desired_stage=stage,confirmed_stage='Neu')
            result=self.process(downloader=lambda *_:self.fail('move must not download'))
            self.assertEqual(result['stage'],stage)
            self.assertEqual(initial,helper.tree_hash(self.library.locate(self.job),self.library.root))
            self.assertEqual(self.process()['sha256'],result['sha256'])
    def test_interruption_never_commits_partial_and_can_retry(self):
        def interrupted(_,path): path.write_bytes(b'partial');raise helper.InboxError('interrupted')
        with self.assertRaises(helper.InboxError): self.process(interrupted)
        self.assertIsNone(self.library.locate(self.job))
        self.assertEqual(len(list((self.library.root/'.staging').glob('*/video.part'))),1)
        self.assertEqual(self.process()['stage'],'Neu')
    def test_validation_failure_never_commits(self):
        with self.assertRaises(helper.InboxError):
            self.library.process(self.job,'x','y',extractor=lambda _:('unused',{}),downloader=lambda _,p:p.write_bytes(b'html'),validator=lambda *_:(_ for _ in ()).throw(helper.InboxError('validation')))
        self.assertIsNone(self.library.locate(self.job))
    def test_missing_or_tampered_original_is_not_replaced(self):
        self.process();folder=self.library.locate(self.job);(folder/'video.mp4').write_bytes(b'changed')
        with self.assertRaises(helper.InboxError): self.process()
        self.assertEqual((folder/'video.mp4').read_bytes(),b'changed')
    def test_existing_destination_preserved(self):
        self.process();folder=self.library.locate(self.job)
        destination=self.library.root/'In Arbeit'/folder.name;destination.mkdir();(destination/'original.txt').write_text('preserve')
        self.job['desired_stage']='In Arbeit'
        with self.assertRaises(helper.InboxError): self.process()
        self.assertTrue(folder.exists());self.assertEqual((destination/'original.txt').read_text(),'preserve')
    def test_content_duplicate_is_not_committed(self):
        self.process();self.job.update(id=str(uuid.uuid4()),shortcode='AnotherReel',canonical_url='https://www.instagram.com/reel/AnotherReel/')
        with self.assertRaises(helper.InboxError): self.process()
        self.assertIsNone(self.library.locate(self.job))
    def test_path_and_url_rejections(self):
        for raw in ('https://instagram.com.evil.test/reel/ABCDE/','file:///C:/secret','https://instagram.com/../../secret'):
            with self.assertRaises(helper.InboxError): helper.reel_url(raw)
        with self.assertRaises(helper.InboxError): helper.safe_path(self.base/'outside',self.library.root)
        self.job['desired_stage']='../outside'
        with self.assertRaises(helper.InboxError):self.process()
    def test_stop_or_lost_lease_prevents_commit(self):
        with self.assertRaises(helper.InboxError): self.process(checkpoint=lambda:(_ for _ in ()).throw(helper.InboxError('interrupted')))
        self.assertIsNone(self.library.locate(self.job))
    def test_worker_retries_ack_after_network_returns(self):
        class Cloud:
            offline=True
            def call(inner,payload):
                if payload['action']=='claim': return {**self.job,'lease_id':str(uuid.uuid4())}
                if payload['action']=='ack' and inner.offline: raise ConnectionError('offline')
                return {'ok':True}
        cloud=Cloud()
        with patch.object(self.library,'process',side_effect=lambda *a,**k:self.process()):
            # Use a different library handle to avoid recursive patching.
            pass
        receipt=self.process()
        with patch.object(self.library,'process',return_value=receipt):
            with self.assertRaises(ConnectionError):helper.cycle(cloud,self.library,str(uuid.uuid4()),'x','y')
            cloud.offline=False
            self.assertTrue(helper.cycle(cloud,self.library,str(uuid.uuid4()),'x','y'))

if __name__=='__main__':unittest.main()

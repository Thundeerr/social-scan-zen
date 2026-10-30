import json
import os
from pathlib import Path
import tempfile
import unittest
import uuid
from unittest.mock import Mock, patch
import helper

class LibraryTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory(); self.base=Path(self.tmp.name)
        self.gallery=self.base/'existing';self.gallery.mkdir()
        (self.gallery/'Inventar.json').write_text('[]')
        (self.gallery/'START.html').write_text('original')
        self.library=helper.Library(self.base/'Videos',self.gallery)
        self.job={'id':str(uuid.uuid4()),'shortcode':'DdQN9krAjJn','canonical_url':'https://www.instagram.com/p/DdQN9krAjJn/?stkn=tracking','desired_stage':'Neu','confirmed_stage':None,'is_test':True}
        self.dns=patch.object(helper.socket,'getaddrinfo',return_value=[(2,1,6,'',('8.8.8.8',443))])
        self.dns.start();self.addCleanup(self.dns.stop)
    def tearDown(self): self.tmp.cleanup()
    def process(self, downloader=None, **kwargs):
        def download(url,path): path.write_bytes(b'test-only-video')
        def validate(path,*_): return {'sha256':helper.digest(path),'bytes':path.stat().st_size,'duration':2.0,'width':640,'height':360}
        with patch.object(helper,'run_tool',side_effect=helper.InboxError('setup')):
            return self.library.process(self.job,'ffprobe','ffmpeg',extractor=kwargs.pop('extractor',lambda _:('https://example.test',{'title':'<script>test</script>','creator':'test'})),downloader=downloader or download,validator=kwargs.pop('validator',validate),**kwargs)
    def resolved_media(self):
        return ('https://video.cdninstagram.com/reel.mp4?signature=private',{'title':'API reel','creator':'creator'})
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
    def test_fallback_after_extraction_failure(self):
        for code in ('unavailable','interrupted','unsupported'):
            with self.subTest(code=code):
                self.job['id']=str(uuid.uuid4())
                resolver=Mock(return_value=self.resolved_media())
                result=self.process(extractor=Mock(side_effect=helper.InboxError(code)),fallback=resolver,downloader=lambda _,p:p.write_bytes(self.job['id'].encode()))
                resolver.assert_called_once_with()
                self.assertEqual(result['title'],'API reel')
                self.assertEqual(result['stage'],'Neu')
    def test_public_http403_uses_fallback(self):
        direct='https://video.cdninstagram.com/public.mp4'
        resolver=Mock(return_value=self.resolved_media())
        opener=Mock();opener.open.side_effect=helper.urllib.error.HTTPError(direct,403,'Forbidden',{},None)
        def download(url,path):
            if url==direct: helper.download_public(url,path)
            else: path.write_bytes(b'api-original')
        with patch.object(helper.urllib.request,'build_opener',return_value=opener):
            result=self.process(extractor=lambda _:(direct,{}),downloader=download,fallback=resolver)
        resolver.assert_called_once_with()
        self.assertEqual(result['title'],'API reel')
        self.assertEqual((self.library.locate(self.job)/'video.mp4').read_bytes(),b'api-original')
    def test_fallback_preserves_failed_public_partial(self):
        candidates=[]
        def download(url,path):
            candidates.append(path)
            if len(candidates)==1:
                path.write_bytes(b'keep-incomplete')
                raise helper.InboxError('interrupted')
            path.write_bytes(b'complete-api-video')
        self.process(downloader=download,fallback=self.resolved_media)
        self.assertNotEqual(candidates[0].parent,candidates[1].parent)
        self.assertEqual(candidates[0].read_bytes(),b'keep-incomplete')
        folder=self.library.locate(self.job)
        self.assertEqual((folder/'video.mp4').read_bytes(),b'complete-api-video')
        self.assertFalse((folder/'video.part').exists())
    def test_fallback_never_runs_for_valid_public_or_local_original(self):
        resolver=Mock(side_effect=AssertionError('must not resolve'))
        self.process(fallback=resolver)
        self.process(fallback=resolver,extractor=Mock(side_effect=AssertionError('must not extract')))
        resolver.assert_not_called()
    def test_fallback_does_not_retry_validation_or_setup_errors(self):
        for code in ('validation','setup','path_blocked','conflict'):
            for phase in ('extractor','downloader','validator'):
                with self.subTest(code=code,phase=phase):
                    resolver=Mock(return_value=self.resolved_media())
                    with self.assertRaises(helper.InboxError) as raised:
                        self.process(**{phase:Mock(side_effect=helper.InboxError(code))},fallback=resolver)
                    self.assertEqual(raised.exception.code,code)
                    resolver.assert_not_called()
        resolver=Mock(return_value=self.resolved_media())
        with self.assertRaises(helper.InboxError):
            self.process(validator=Mock(side_effect=helper.InboxError('interrupted')),fallback=resolver)
        resolver.assert_not_called()
    def test_fallback_video_must_pass_validation(self):
        resolver=Mock(return_value=self.resolved_media())
        with self.assertRaises(helper.InboxError) as raised:
            self.process(extractor=Mock(side_effect=helper.InboxError('unavailable')),fallback=resolver,validator=Mock(side_effect=helper.InboxError('validation')))
        self.assertEqual(raised.exception.code,'validation')
        self.assertIsNone(self.library.locate(self.job))
        self.assertEqual(len(list((self.library.root/'.staging').glob('*/video.part'))),1)
    def test_fallback_rejects_arbitrary_or_private_hosts(self):
        for url in ('https://evil.example/video.mp4','https://cdninstagram.com.evil.test/video.mp4','https://video.cdninstagram.com:bad/video.mp4'):
            with self.subTest(url=url):
                download=Mock()
                with self.assertRaises(helper.InboxError) as raised:
                    self.process(extractor=Mock(side_effect=helper.InboxError('unavailable')),fallback=lambda:(url,{}),downloader=download)
                self.assertEqual(raised.exception.code,'unsupported');download.assert_not_called()
        with patch.object(helper.socket,'getaddrinfo',return_value=[(2,1,6,'',('127.0.0.1',443))]):
            with self.assertRaises(helper.InboxError) as raised:
                self.process(extractor=Mock(side_effect=helper.InboxError('unavailable')),fallback=self.resolved_media)
            self.assertEqual(raised.exception.code,'unsupported')
    def test_fallback_resolves_only_once_if_alternative_fails(self):
        for phase in ('resolver','download'):
            with self.subTest(phase=phase):
                resolver=Mock(return_value=self.resolved_media(),side_effect=helper.InboxError('interrupted') if phase=='resolver' else None)
                downloader=Mock(side_effect=helper.InboxError('unavailable'))
                with self.assertRaises(helper.InboxError):
                    self.process(extractor=Mock(side_effect=helper.InboxError('unavailable')),fallback=resolver,downloader=downloader)
                resolver.assert_called_once_with()
                self.assertEqual(downloader.call_count,0 if phase=='resolver' else 1)
    def test_stop_before_or_after_resolve_prevents_next_operation(self):
        # Initial checkpoint, pre-resolve checkpoint, post-resolve checkpoint.
        for stop_at in (1,2,3):
            with self.subTest(stop_at=stop_at):
                resolver=Mock(return_value=self.resolved_media());downloader=Mock()
                count=0
                def checkpoint():
                    nonlocal count
                    count+=1
                    if count==stop_at: raise helper.InboxError('interrupted')
                with self.assertRaises(helper.InboxError):
                    self.process(extractor=Mock(side_effect=helper.InboxError('unavailable')),fallback=resolver,downloader=downloader,checkpoint=checkpoint)
                self.assertEqual(resolver.call_count,1 if stop_at==3 else 0)
                downloader.assert_not_called()
                self.assertIsNone(self.library.locate(self.job))
    def test_cycle_resolves_with_current_lease_and_sanitized_metadata(self):
        job={**self.job,'lease_id':str(uuid.uuid4())};calls=[]
        url,metadata=self.resolved_media()
        def call(payload):
            calls.append(payload)
            if payload['action']=='claim': return job
            if payload['action']=='resolve': return {'url':url,'metadata':{**metadata,'private':'excluded'}}
            return {'ok':True}
        def process(job,ffprobe,ffmpeg,**kwargs):
            kwargs['checkpoint']()
            resolved=kwargs['fallback']()
            kwargs['checkpoint']()
            self.assertEqual(resolved,(url,metadata))
            return {'stage':'Neu'}
        with patch.object(self.library,'process',side_effect=process):
            self.assertTrue(helper.cycle(Mock(call=call),self.library,'instance','probe','mpeg'))
        self.assertEqual([p['action'] for p in calls],['claim','renew','resolve','renew','ack'])
        self.assertEqual(calls[2],{'action':'resolve','id':job['id'],'lease':job['lease_id']})
    def test_cycle_resolver_errors_are_safe_and_fail_once(self):
        cases=[({'error':code},code) for code in ('unavailable','interrupted','setup','unsupported')]
        cases += [({'error':'https://secret.invalid/?token=private'},'unavailable'),
                  ({'url':self.resolved_media()[0],'metadata':{'title':42,'creator':'ok'}},'unavailable'),
                  ({'url':'https://evil.example/file','metadata':{'title':'x','creator':'y'}},'unsupported'),
                  (None,'unavailable'),
                  (ValueError('invalid JSON response'),'unavailable'),
                  (helper.urllib.error.URLError('private-url'),'interrupted')]
        for response,expected in cases:
            with self.subTest(expected=expected,response=type(response).__name__):
                calls=[]
                def call(payload):
                    calls.append(payload)
                    if payload['action']=='claim':return {**self.job,'lease_id':'lease'}
                    if payload['action']=='resolve':
                        if isinstance(response,Exception):raise response
                        return response
                    return {'ok':True}
                with patch.object(self.library,'process',side_effect=lambda *a,**k:k['fallback']()):
                    self.assertTrue(helper.cycle(Mock(call=call),self.library,'instance','probe','mpeg'))
                self.assertEqual([p['action'] for p in calls],['claim','resolve','fail'])
                self.assertEqual(calls[-1]['code'],expected)

class PublicDownloadTests(unittest.TestCase):
    def test_rate_limit_is_interrupted(self):
        url='https://video.cdninstagram.com/reel.mp4'
        opener=Mock();opener.open.side_effect=helper.urllib.error.HTTPError(url,429,'rate limited',{},None)
        with patch.object(helper,'media_url',return_value=url),patch.object(helper.urllib.request,'build_opener',return_value=opener):
            with self.assertRaises(helper.InboxError) as raised:
                helper.download_public(url,Path('unused'))
        self.assertEqual(raised.exception.code,'interrupted')
    def test_truncated_http_body_is_interrupted_and_preserved(self):
        url='https://video.cdninstagram.com/reel.mp4'
        response=Mock(headers={'Content-Length':'20'})
        response.read.side_effect=[b'first-part',helper.http.client.IncompleteRead(b'rest',10)]
        class ResponseContext:
            def __enter__(self):return response
            def __exit__(self,*_):return False
        opener=Mock();opener.open.return_value=ResponseContext()
        with tempfile.TemporaryDirectory() as folder:
            target=Path(folder)/'video.part'
            with patch.object(helper,'media_url',return_value=url),patch.object(helper.urllib.request,'build_opener',return_value=opener):
                with self.assertRaises(helper.InboxError) as raised:
                    helper.download_public(url,target)
            self.assertEqual(raised.exception.code,'interrupted')
            self.assertEqual(target.read_bytes(),b'first-part')

class CookieIsolation(unittest.TestCase):
    def test_extractor_failure_cleans_private_copy_and_preserves_source(self):
        with tempfile.TemporaryDirectory() as folder:
            source=Path(folder)/'session.txt';source.write_text('test-session')
            copies=[]
            def fail(args,timeout):
                jar=Path(args[args.index('--cookies')+1]);copies.append(jar)
                self.assertNotEqual(jar,source)
                self.assertEqual(jar.read_text(),'test-session')
                jar.write_text('extractor changes')
                raise helper.InboxError('unavailable')
            with patch.object(helper,'run_tool',side_effect=fail):
                with self.assertRaises(helper.InboxError):
                    helper.extract('https://www.instagram.com/reel/DeQGhsDvDqd/',cookie_file=source)
            self.assertEqual(source.read_text(),'test-session')
            self.assertEqual(len(copies),1)
            self.assertFalse(copies[0].exists())

if __name__=='__main__':unittest.main()

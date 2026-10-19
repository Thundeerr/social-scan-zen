import importlib.util
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

root=Path(__file__).resolve().parents[2]
spec=importlib.util.spec_from_file_location('inbox_helper',root/'windows/reel-inbox/helper.py')
helper=importlib.util.module_from_spec(spec);sys.modules['inbox_helper']=helper;spec.loader.exec_module(helper)
import worker

class WorkerRecovery(unittest.TestCase):
    def test_job_reference_profile_cannot_switch_model(self):
        with patch.object(worker,'profile',return_value=({},[])) as profile:
            worker.job_profile({'model':'kiikii','reference_profile':'kiikii'})
            profile.assert_called_once_with('kiikii')
            with self.assertRaises(worker.StopJob):
                worker.job_profile({'model':'kiikii','reference_profile':'tuuva'})
            self.assertEqual(profile.call_count,1)
    def test_request_contains_source_model_images_and_job_prompt(self):
        refs=[Path('front.jpg'),Path('side.png'),Path('back.jpg')]
        job={'model':'tuuva','prompt_id':'prompt_1'}
        with patch.object(worker,'upload',side_effect=['source-url','front-url','side-url','back-url']) as upload:
            body=worker.generation_request({'prompt':'Default','prompts':{'prompt_1':'Configured value'}},job,Path('source.mp4'),refs,{'duration':4.2})
        self.assertEqual(body['video'],'source-url')
        self.assertEqual(body['reference_images'],['front-url','side-url','back-url'])
        self.assertEqual(body['prompt'],'Configured value')
        self.assertEqual(body['duration'],5)
        self.assertEqual(upload.call_count,4)
    def test_prompt_identifier_resolution_and_missing_configuration(self):
        self.assertEqual(worker.generation_prompt({'prompt':'Default'},{}),'Default')
        config={'prompt':'Default','prompts':{'prompt_1':'Configured one','prompt_2':'Configured two'}}
        for key, expected in config['prompts'].items():
            self.assertEqual(worker.generation_prompt(config,{'prompt_id':key}),expected)
        value=worker.generation_prompt(config,{'prompt_id':'prompt_1','revision_notes':'Correction'})
        self.assertTrue(value.startswith('Configured one'))
        with patch.object(worker,'upload') as upload:
            for key in ['unknown','prompt_2']:
                with self.assertRaises(worker.StopJob):
                    worker.generation_request({'prompt':'Default'}, {'prompt_id':key},Path('source.mp4'),[],{'duration':5})
            upload.assert_not_called()
    def test_uncertain_paid_submission_is_never_repeated(self):
        with tempfile.TemporaryDirectory() as folder,patch.object(worker,'ROOT',Path(folder)),patch.object(worker,'profile',return_value=({},[])),patch.object(worker,'wave') as wave:
            job={'id':'11111111-1111-4111-8111-111111111111','lease':'22222222-2222-4222-8222-222222222222','model':'kiikii'}
            worker.checkpoint({'job':job,'submit_intent':True})
            with patch.object(worker,'api',side_effect=[{'state':'reserved'},{}]) as api:
                worker.tick()
                api.assert_any_call('block',job,issue='provider_uncertain')
            wave.assert_not_called();self.assertFalse((Path(folder)/'current.json').exists())
    def test_recovered_provider_id_only_polls_existing_job(self):
        with tempfile.TemporaryDirectory() as folder,patch.object(worker,'ROOT',Path(folder)),patch.object(worker,'profile',return_value=({},[])),patch.object(worker,'deliver') as deliver:
            job={'id':'11111111-1111-4111-8111-111111111111','lease':'22222222-2222-4222-8222-222222222222','model':'kiikii'}
            worker.checkpoint({'job':job,'submit_intent':True,'provider_id':'a'*32})
            with patch.object(worker,'api',side_effect=[{'state':'reserved'},{}]) as api:
                worker.tick();api.assert_any_call('submitted',job,provider_id='a'*32)
            deliver.assert_called_once()
    def test_credential_urls_and_unknown_provider_hosts_are_refused(self):
        for url in ['http://d2h7xmz5gqybh9.cloudfront.net/video','https://127.0.0.1/video','https://secret@d2h7xmz5gqybh9.cloudfront.net/video']:
            with self.assertRaises(worker.StopJob):worker.wave_download(url,Path('unused'))
if __name__=='__main__':unittest.main()

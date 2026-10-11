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

import datetime as dt
import unittest
from unittest.mock import patch
import business_analytics as api

class AccountingTests(unittest.TestCase):
    def test_pagination_and_berlin_month(self):
        calls = []
        def fake(url, token, data=None):
            calls.append((url, data))
            if url.endswith('/balance'):
                return {'code': 200, 'data': {'balance': 2.8339}}
            page = data['page']
            return {'code': 200, 'data': {'page': page, 'has_more': page == 1, 'items': [{
                'uuid': str(page), 'billing_type': 'deduct', 'price': .001,
                'created_at': '2026-10-24T22:00:00Z', 'prediction': {'uuid': 'abc'}}]}}
        with patch.object(api, 'request', fake):
            result = api.collect('test', dt.datetime(2026, 10, 28, tzinfo=dt.timezone.utc))
        self.assertEqual(len(result['records']), 2)
        self.assertEqual(calls[0][1]['start_time'], '2026-10-01T00:00:00+02:00')
        self.assertEqual(result['balance'], 2.8339)
        self.assertTrue(all('/billings/search' in c[0] or '/balance' in c[0] for c in calls))

    def test_partial_pagination_fails_closed(self):
        with patch.object(api, 'request', return_value={'code':200,'data':{'items':[]}}):
            with self.assertRaises(ValueError):
                api.collect('test')

    def test_missing_balance_not_zero(self):
        with patch.object(api, 'request', side_effect=[
            {'code':200,'data':{'items':[], 'page':1,'has_more':False}},
            {'code':200,'data':{}}]):
            with self.assertRaises(KeyError):
                api.collect('test')

if __name__ == '__main__':
    unittest.main()

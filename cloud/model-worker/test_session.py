import unittest
from export_session import render

class SessionBoundary(unittest.TestCase):
    def test_only_instagram_with_live_login_is_exported(self):
        rows=[('.instagram.com','/',1,200,'sessionid','test',1),('.example.com','/',1,200,'secret','private',1),('.instagram.com.evil.test','/',1,200,'secret','private',0),('.instagram.com','/',1,50,'expired','old',0),('.instagram.com','/',1,200,'bad','injected\nvalue',0)]
        body,ready=render(rows,100)
        self.assertTrue(ready)
        self.assertEqual(body,'# Netscape HTTP Cookie File\n#HttpOnly_.instagram.com\tTRUE\t/\tTRUE\t200\tsessionid\ttest\n')
    def test_logout_and_expiry_clear_export(self):
        for rows in [[],[('.instagram.com','/',1,50,'sessionid','expired',1)],[('.instagram.com','/',1,200,'csrftoken','test',0)]]:
            body,ready=render(rows,100)
            self.assertFalse(ready);self.assertEqual(body,'# Netscape HTTP Cookie File\n')
if __name__=='__main__':unittest.main()

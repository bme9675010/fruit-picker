# 本機測試用的靜態伺服器：關閉快取，改完程式重新整理就會生效。
# 用法：python tools/serve.py [port]
import functools
import http.server
import pathlib
import sys


class NoCacheHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()


root = pathlib.Path(__file__).resolve().parent.parent
port = int(sys.argv[1]) if len(sys.argv) > 1 else 5500
handler = functools.partial(NoCacheHandler, directory=str(root))
http.server.ThreadingHTTPServer(('127.0.0.1', port), handler).serve_forever()

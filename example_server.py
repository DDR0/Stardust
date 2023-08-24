#!/usr/bin/env python3
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

class ExampleServer(SimpleHTTPRequestHandler):
	def __init__(self, *args, **kwargs):
		super().__init__(*args, directory="www", **kwargs)
		
	def end_headers(self):
		#These headers are required for cross-origin isolation, which is
		#required for shared array buffers. See in JS: `crossOriginIsolated`.
		self.send_header("Cross-Origin-Opener-Policy", "same-origin")
		self.send_header("Cross-Origin-Embedder-Policy", "require-corp")
		super().end_headers()

web_server = ThreadingHTTPServer(("localhost", 8080), ExampleServer)

print("Stardust started at http://%s:%s." % (
	web_server.server_name or web_server.server_address[0],
	web_server.server_port
))

try:
	web_server.serve_forever()
except KeyboardInterrupt:
	web_server.server_close()
	print("\rGood-bye!")
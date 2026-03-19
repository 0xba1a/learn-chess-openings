#!/usr/bin/env python3
"""Simple HTTP server with no-cache headers for development."""
import http.server
import os

class NoCacheHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0')
        self.send_header('Pragma', 'no-cache')
        self.send_header('Expires', '0')
        super().end_headers()

os.chdir(os.path.dirname(os.path.abspath(__file__)))
server = http.server.HTTPServer(('0.0.0.0', 8080), NoCacheHandler)
print('Serving on http://localhost:8080 (no-cache)')
server.serve_forever()

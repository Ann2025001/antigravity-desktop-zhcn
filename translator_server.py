import json
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from threading import Lock

import argostranslate.translate

HOST = "127.0.0.1"
PORT = 45831
MAX_TEXT_LENGTH = 8000
cache = {}
cache_lock = Lock()


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *_args):
        pass

    def send_json(self, status, body):
        payload = json.dumps(body, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(payload)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()
        self.wfile.write(payload)

    def do_OPTIONS(self):
        self.send_json(204, {})

    def do_GET(self):
        if self.path == "/health":
            self.send_json(200, {"status": "ok", "mode": "offline"})
        else:
            self.send_json(404, {"error": "not found"})

    def do_POST(self):
        if self.path != "/translate":
            self.send_json(404, {"error": "not found"})
            return
        try:
            size = int(self.headers.get("Content-Length", "0"))
            if size <= 0 or size > MAX_TEXT_LENGTH * 4:
                raise ValueError("invalid request size")
            body = json.loads(self.rfile.read(size).decode("utf-8"))
            text = body.get("text")
            if not isinstance(text, str) or not text.strip() or len(text) > MAX_TEXT_LENGTH:
                raise ValueError("invalid text")
            with cache_lock:
                translated = cache.get(text)
            if translated is None:
                translated = argostranslate.translate.translate(text, "en", "zh")
                with cache_lock:
                    if len(cache) >= 512:
                        cache.pop(next(iter(cache)))
                    cache[text] = translated
            self.send_json(200, {"translatedText": translated})
        except Exception as error:
            self.send_json(400, {"error": str(error)})


if __name__ == "__main__":
    ThreadingHTTPServer((HOST, PORT), Handler).serve_forever()

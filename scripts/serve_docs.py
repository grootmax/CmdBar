import os
import sys
import time
import threading
import http.server
import socketserver
from compile_docs import compile_docs

PORT = 8000
reload_event = threading.Event()

class LiveReloadHandler(http.server.SimpleHTTPRequestHandler):
    def translate_path(self, path):
        # Serve compiled folders from build/
        if path.startswith('/public'):
            rel_path = path[7:].lstrip('/')
            return os.path.join(os.getcwd(), 'build/public', rel_path)
        elif path.startswith('/developer'):
            rel_path = path[10:].lstrip('/')
            return os.path.join(os.getcwd(), 'build/developer', rel_path)
        return super().translate_path(path)

    def do_GET(self):
        # SSE endpoint for instant-reload
        if self.path == '/__reload__':
            self.send_response(200)
            self.send_header('Content-Type', 'text/event-stream')
            self.send_header('Cache-Control', 'no-cache')
            self.send_header('Connection', 'keep-alive')
            self.end_headers()
            
            # Send initial ping
            try:
                self.wfile.write(b": ok\n\n")
                self.wfile.flush()
            except Exception:
                return

            # Keep client connection open and wait for reload events
            while True:
                reload_event.wait()
                try:
                    self.wfile.write(b"data: reload\n\n")
                    self.wfile.flush()
                except Exception:
                    break
                # Brief sleep to allow other threads to process and prevent high CPU on event.set()
                time.sleep(0.1)
            return

        if self.path == '/' or self.path == '':
            self.send_response(302)
            self.send_header('Location', '/public/')
            self.end_headers()
            return

        return super().do_GET()

    def log_message(self, format, *args):
        # Suppress standard logging for reload checks to keep output clean
        if "/__reload__" in args[0]:
            return
        super().log_message(format, *args)

def trigger_reload():
    print("Change detected. Recompiling & triggering browser reload...")
    reload_event.set()
    time.sleep(0.2)
    reload_event.clear()

def watch_docs_folder(interval=0.5):
    watch_dirs = ['docs']
    last_mtimes = {}
    
    # Initialize
    for directory in watch_dirs:
        if os.path.exists(directory):
            for root, _, filenames in os.walk(directory):
                for filename in filenames:
                    filepath = os.path.join(root, filename)
                    try:
                        last_mtimes[filepath] = os.path.getmtime(filepath)
                    except OSError:
                        pass

    while True:
        time.sleep(interval)
        changed = False
        current_files = set()
        
        for directory in watch_dirs:
            if os.path.exists(directory):
                for root, _, filenames in os.walk(directory):
                    for filename in filenames:
                        filepath = os.path.join(root, filename)
                        current_files.add(filepath)
                        try:
                            mtime = os.path.getmtime(filepath)
                        except OSError:
                            continue
                        
                        if filepath not in last_mtimes:
                            print(f"\n[Watcher] New file detected: {filepath}")
                            last_mtimes[filepath] = mtime
                            changed = True
                        elif last_mtimes[filepath] != mtime:
                            print(f"\n[Watcher] File modified: {filepath}")
                            last_mtimes[filepath] = mtime
                            changed = True
                            
        deleted_files = set(last_mtimes.keys()) - current_files
        if deleted_files:
            for filepath in deleted_files:
                print(f"\n[Watcher] File deleted: {filepath}")
                del last_mtimes[filepath]
            changed = True
            
        if changed:
            try:
                compile_docs(live_reload=True)
                trigger_reload()
            except Exception as e:
                print(f"Error compiling docs: {e}")

def main():
    # 1. Do initial compilation
    print("Performing initial compilation...")
    compile_docs(live_reload=True)

    # 2. Start the watch thread
    watcher_thread = threading.Thread(target=watch_docs_folder, daemon=True)
    watcher_thread.start()

    # 3. Start the HTTP server
    # ThreadingHTTPServer handles each request in a separate thread
    # which is required for long-lived SSE connections to not block other HTTP requests.
    server_address = ('', PORT)
    try:
        # Use ThreadingHTTPServer (Python 3.7+)
        from http.server import ThreadingHTTPServer
        httpd = ThreadingHTTPServer(server_address, LiveReloadHandler)
    except ImportError:
        # Fallback to standard ThreadingTCPServer if ThreadingHTTPServer is somehow not present
        class ThreadedHTTPServer(socketserver.ThreadingMixIn, http.server.HTTPServer):
            pass
        httpd = ThreadedHTTPServer(server_address, LiveReloadHandler)

    print(f"\n=============================================")
    print(f"Documentation server started at http://localhost:{PORT}")
    print(f"Public target:    http://localhost:{PORT}/public/")
    print(f"Developer target: http://localhost:{PORT}/developer/")
    print(f"=============================================\n")
    print("Watching for changes in 'docs/' directory (Press Ctrl+C to stop)...")

    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nShutting down documentation server...")
        httpd.server_close()
        sys.exit(0)

if __name__ == '__main__':
    main()

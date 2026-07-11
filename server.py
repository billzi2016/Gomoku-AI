#!/usr/bin/env python3
"""本地开发服务器。

默认绑定 127.0.0.1 的随机可用端口，并为浏览器补 COOP/COEP 响应头。
这样本机预览和 GitHub Pages 上的运行环境保持一致。
"""

from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import argparse


class HeaderHandler(SimpleHTTPRequestHandler):
    """给所有静态资源追加跨源隔离所需响应头。"""

    def end_headers(self):
        # 本地预览也加同样的头，避免“本地能跑、Pages 上表现不同”。
        self.send_header("Cross-Origin-Opener-Policy", "same-origin")
        self.send_header("Cross-Origin-Embedder-Policy", "require-corp")
        super().end_headers()


def main():
    """解析命令行参数并启动线程化静态服务器。"""

    parser = argparse.ArgumentParser(description="Serve Gomoku AI locally.")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=0, help="0 means random free port")
    args = parser.parse_args()

    root = Path(__file__).resolve().parent
    # SimpleHTTPRequestHandler 的 directory 需要在构造时传入，用 lambda 固定项目根目录。
    handler = lambda *h_args, **h_kwargs: HeaderHandler(*h_args, directory=str(root), **h_kwargs)
    server = ThreadingHTTPServer((args.host, args.port), handler)
    host, port = server.server_address
    # port=0 时系统会分配随机可用端口，这里必须 flush，方便 Codex/终端立刻看到链接。
    print(f"http://{host}:{port}/", flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()

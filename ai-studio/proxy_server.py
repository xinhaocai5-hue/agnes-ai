#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
ModelScope API 本地代理服务器
解决浏览器 CORS 跨域问题
"""

import http.server
import socketserver
import json
import urllib.request
import urllib.error
from urllib.parse import urlparse, parse_qs
import threading
from datetime import datetime

PORT = 8765
TARGET_BASE = "https://api-inference.modelscope.cn"

class ProxyHandler(http.server.BaseHTTPRequestHandler):
    """代理请求处理器"""
    
    def log_message(self, format, *args):
        """自定义日志格式"""
        timestamp = datetime.now().strftime("%H:%M:%S")
        print(f"[{timestamp}] {args[0]}")
    
    def do_OPTIONS(self):
        """处理 CORS 预检请求"""
        self.send_response(200)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', '*')
        self.send_header('Access-Control-Max-Age', '86400')
        self.end_headers()
    
    def do_GET(self):
        """处理 GET 请求"""
        self.proxy_request('GET')
    
    def do_POST(self):
        """处理 POST 请求"""
        self.proxy_request('POST')
    
    def proxy_request(self, method):
        """代理请求到目标服务器"""
        try:
            # 读取请求体
            content_length = int(self.headers.get('Content-Length', 0))
            body = self.rfile.read(content_length) if content_length > 0 else None
            
            # 构建目标 URL
            target_url = TARGET_BASE + self.path
            
            # 复制请求头（排除 Host）
            headers = {}
            for key, value in self.headers.items():
                if key.lower() not in ['host', 'content-length']:
                    headers[key] = value
            
            # 创建请求
            req = urllib.request.Request(
                target_url,
                data=body,
                headers=headers,
                method=method
            )
            
            # 发送请求
            with urllib.request.urlopen(req, timeout=300) as response:
                response_body = response.read()
                
                # 发送响应
                self.send_response(response.status)
                
                # 添加 CORS 头
                self.send_header('Access-Control-Allow-Origin', '*')
                self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
                self.send_header('Access-Control-Allow-Headers', '*')
                
                # 复制响应头（排除 CORS 相关头，避免重复）
                skip_headers = {'transfer-encoding', 'connection', 
                                'access-control-allow-origin', 'access-control-allow-methods',
                                'access-control-allow-headers', 'access-control-max-age'}
                for key, value in response.getheaders():
                    if key.lower() not in skip_headers:
                        self.send_header(key, value)
                
                self.end_headers()
                self.wfile.write(response_body)
                
                # 打印日志
                self.log_request_info(method, self.path, response.status)
                
        except urllib.error.HTTPError as e:
            # 处理 HTTP 错误
            error_body = e.read()
            self.send_response(e.code)
            self.send_header('Access-Control-Allow-Origin', '*')
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            self.wfile.write(error_body)
            self.log_request_info(method, self.path, e.code)
            
        except (ConnectionAbortedError, ConnectionResetError, BrokenPipeError) as e:
            # 处理连接中断错误（浏览器取消请求等）
            print(f"[WARN] 连接中断: {e}")
            
        except Exception as e:
            # 处理其他错误
            error_msg = str(e)
            try:
                self.send_response(500)
                self.send_header('Access-Control-Allow-Origin', '*')
                self.send_header('Content-Type', 'application/json')
                self.end_headers()
                self.wfile.write(json.dumps({
                    'error': {'message': error_msg}
                }).encode('utf-8'))
            except:
                pass
            print(f"[ERROR] {error_msg}")
    
    def log_request_info(self, method, path, status):
        """打印请求信息"""
        status_color = "\033[32m" if status < 400 else "\033[31m"
        reset = "\033[0m"
        print(f"  {method} {path} -> {status_color}{status}{reset}")


def run_server():
    """启动代理服务器"""
    print("=" * 60)
    print("ModelScope API 代理服务器")
    print("=" * 60)
    print(f"本地地址: http://localhost:{PORT}")
    print(f"目标地址: {TARGET_BASE}")
    print()
    print("使用方法:")
    print(f"  将前端 API Base URL 改为: http://localhost:{PORT}/v1/")
    print()
    print("按 Ctrl+C 停止服务器")
    print("=" * 60)
    print()
    
    with socketserver.TCPServer(("", PORT), ProxyHandler) as httpd:
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\n\n服务器已停止")
            httpd.shutdown()


if __name__ == "__main__":
    run_server()

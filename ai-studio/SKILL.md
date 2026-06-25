# Skill: ModelScope AIGC 前端集成开发

## 概述

本 Skill 记录如何为项目集成 ModelScope AIGC（文生图）功能，解决"只能对话，无法正常生图"的常见问题。适用于需要同时支持对话和图片生成的 AI 应用。

## 适用场景

- 项目已有对话功能，需要添加图片生成功能
- 生图功能无法正常工作（API 调用失败、任务状态异常等）
- 需要支持多个生图模型切换
- 需要深色主题 UI 界面

---

## 踩坑记录（必读）

以下是实际开发中遇到的所有问题，按优先级排列。**其他 AI 在实现时必须逐条检查。**

### 坑 1：浏览器 CORS 跨域 -- 必须用代理

**现象**：前端直接请求 `https://api-inference.modelscope.cn` 被浏览器拦截。

**原因**：ModelScope API 不允许浏览器直接跨域请求。

**解决**：必须搭建本地代理服务器（如 Python `proxy_server.py`），前端请求本地代理，代理转发到 ModelScope。

```
浏览器 --> localhost:8765 (代理) --> api-inference.modelscope.cn
```

### 坑 2：CORS 头重复导致浏览器拒绝响应

**现象**：
```
Access to fetch at 'http://localhost:8765/v1/models' has been blocked by CORS policy:
The 'Access-Control-Allow-Origin' header contains multiple values '*, *',
but only one is allowed.
```

**原因**：代理服务器自己添加了 `Access-Control-Allow-Origin: *`，同时上游 ModelScope 响应也返回了同样的头，导致响应中有两个重复的 CORS 头。

**解决**：代理服务器在复制上游响应头时，**必须跳过所有 CORS 相关头**：

```python
# 代理先添加自己的 CORS 头
self.send_header('Access-Control-Allow-Origin', '*')
self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
self.send_header('Access-Control-Allow-Headers', '*')

# 复制上游响应头时，排除 CORS 相关头，避免重复
skip_headers = {'transfer-encoding', 'connection',
                'access-control-allow-origin', 'access-control-allow-methods',
                'access-control-allow-headers', 'access-control-max-age'}
for key, value in response.getheaders():
    if key.lower() not in skip_headers:
        self.send_header(key, value)
```

### 坑 3：CORS 预检（OPTIONS）必须正确处理自定义头

**现象**：
```
Request header field x-modelscope-async-mode is not allowed by
Access-Control-Allow-Headers in preflight response.
```

**原因**：浏览器在发送带自定义头的请求前，会先发 OPTIONS 预检请求。代理必须正确响应。

**解决**：代理服务器必须实现 `do_OPTIONS` 方法：

```python
def do_OPTIONS(self):
    self.send_response(200)
    self.send_header('Access-Control-Allow-Origin', '*')
    self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
    self.send_header('Access-Control-Allow-Headers', '*')  # 允许所有自定义头
    self.send_header('Access-Control-Max-Age', '86400')    # 缓存预检结果
    self.end_headers()
```

### 坑 4：JavaScript 初始化顺序导致按钮完全无法点击

**现象**：页面加载后所有按钮都点不了，没有任何报错。

**原因**：`loadSettings()` 在 `debugConsole.init()` 之前被调用，但 `loadSettings()` 内部使用了 `debugConsole.log()`，此时 `debugConsole` 的 DOM 元素还未初始化（为 null），导致 JavaScript 运行时错误，后续的事件绑定代码（`bindEvents()`）根本没有执行。

**解决**：**必须先初始化调试控制台，再加载设置**：

```javascript
// 正确顺序
function init() {
    debugConsole.init();   // 1. 先初始化 DOM
    loadSettings();        // 2. 再加载设置（会调用 debugConsole.log）
    bindEvents();          // 3. 绑定事件
    updateUI();            // 4. 更新界面
    checkProxyStatus();    // 5. 检查代理
}
```

### 坑 5：API Key 输入后未实时同步到 state

**现象**：输入了 API Key，但发送消息时提示"请先设置 API Key"。

**原因**：API Key 只在点击"保存设置"按钮时才同步到 state 对象，但发送消息时检查的是 state 中的值。

**解决**：输入框必须监听 `input` 事件，实时同步到 state：

```javascript
apiKeyInput.addEventListener('input', () => {
    state.settings.apiKey = apiKeyInput.value.trim();
});
```

### 坑 6：代理服务器连接中断崩溃

**现象**：浏览器取消请求或页面刷新时，代理服务器抛出 `ConnectionAbortedError` 并可能崩溃。

**原因**：浏览器在请求未完成时关闭连接（如用户刷新页面），代理服务器尝试写入已关闭的连接。

**解决**：代理服务器必须捕获连接中断异常：

```python
except (ConnectionAbortedError, ConnectionResetError, BrokenPipeError) as e:
    print(f"[WARN] 连接中断: {e}")

except Exception as e:
    try:
        self.send_response(500)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Content-Type', 'application/json')
        self.end_headers()
        self.wfile.write(json.dumps({
            'error': {'message': str(e)}
        }).encode('utf-8'))
    except:
        pass  # 连接已断开，无法发送响应
```

### 坑 7：端口冲突导致服务启动失败

**现象**：启动 HTTP 服务器时报 `Address already in use`。

**原因**：之前的进程没有正确退出，端口仍被占用。

**解决**：启动前先检查并清理端口：

```powershell
# Windows
netstat -ano | findstr :8080
taskkill /PID <进程ID> /F

# 或在 start.bat 中自动处理
```

### 坑 8：生图 API 端点混淆

**现象**：生图请求返回 404 或返回对话结果。

**原因**：使用了对话 API 端点 `/v1/chat/completions` 来生图。

**解决**：
- 对话：`POST /v1/chat/completions`
- 生图：`POST /v1/images/generations`
- 任务查询：`GET /v1/tasks/{task_id}`

### 坑 9：异步任务轮询缺少正确的请求头

**现象**：提交任务成功获得 task_id，但轮询任务状态时返回 404 或异常。

**原因**：轮询时缺少 `X-ModelScope-Task-Type` 头。

**解决**：

```javascript
// 提交任务时
headers: {
    'Authorization': `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
    'X-ModelScope-Async-Mode': 'true'   // 必须
}

// 轮询任务时
headers: {
    'Authorization': `Bearer ${apiKey}`,
    'X-ModelScope-Task-Type': 'image_generation'  // 必须！
}
```

### 坑 10：`send_response()` 自动添加 Server/Date 头

**现象**：代理响应头中出现重复的 Server 或 Date 头。

**原因**：Python `http.server` 的 `send_response()` 会自动添加 `Server` 和 `Date` 头，不需要手动添加。

**解决**：不要在代理中手动添加 `Server` 和 `Date` 头。

### 坑 11：bat 脚本中文乱码导致命令无法执行

**现象**：双击 bat 文件后报错 `'xxx' 不是内部或外部命令`，中文全部变成乱码。

**原因**：Windows cmd 默认使用 GBK 编码，而文件保存为 UTF-8。`chcp 65001` 在 bat 中有时不生效或导致其他问题。

**解决**：bat 文件中**不要使用中文**，全部用英文。

### 坑 12：bat 脚本工作目录不正确

**现象**：双击 bat 文件后，`py proxy_server.py` 报找不到文件。

**原因**：bat 的工作目录不一定是文件所在目录（可能取决于快捷方式、右键菜单等）。

**解决**：bat 开头必须加 `cd /d "%~dp0"` 切换到文件所在目录。

### 坑 13：bat 中 `start` 打开浏览器不生效

**现象**：`start http://localhost:8080` 没有打开浏览器。

**原因**：`start` 命令在某些环境下对 URL 处理不一致。

**解决**：使用 `explorer "http://localhost:8080"` 代替 `start`。

### 坑 14：bat 启动多个服务弹出多个黑窗口

**现象**：双击 bat 后弹出 3 个命令行窗口，非常混乱。

**原因**：使用 `start "title" cmd /k "py xxx.py"` 会为每个服务创建独立窗口。

**解决**：使用 `start /B` 在后台运行服务，只保留一个主窗口：

```bat
start /B py proxy_server.py
start /B py -m http.server 8080
```

---

## 完整文件结构

```
project/
├── index.html          # 主页面
├── styles.css          # 深色主题样式
├── app.js              # 前端逻辑
├── proxy_server.py     # API 代理服务器（必须）
├── start.bat           # 一键启动脚本
└── SKILL.md            # 本文档
```

---

## 代理服务器完整实现（proxy_server.py）

```python
#!/usr/bin/env python3
"""ModelScope API 本地代理服务器 -- 解决浏览器 CORS 跨域问题"""

import http.server
import socketserver
import json
import urllib.request
import urllib.error
from datetime import datetime

PORT = 8765
TARGET_BASE = "https://api-inference.modelscope.cn"

class ProxyHandler(http.server.BaseHTTPRequestHandler):

    def log_message(self, format, *args):
        timestamp = datetime.now().strftime("%H:%M:%S")
        print(f"[{timestamp}] {args[0]}")

    def do_OPTIONS(self):
        """处理 CORS 预检请求 -- 必须实现"""
        self.send_response(200)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', '*')
        self.send_header('Access-Control-Max-Age', '86400')
        self.end_headers()

    def do_GET(self):
        self.proxy_request('GET')

    def do_POST(self):
        self.proxy_request('POST')

    def proxy_request(self, method):
        try:
            content_length = int(self.headers.get('Content-Length', 0))
            body = self.rfile.read(content_length) if content_length > 0 else None

            target_url = TARGET_BASE + self.path

            # 复制请求头（排除 Host）
            headers = {}
            for key, value in self.headers.items():
                if key.lower() not in ['host', 'content-length']:
                    headers[key] = value

            req = urllib.request.Request(
                target_url, data=body, headers=headers, method=method
            )

            with urllib.request.urlopen(req, timeout=300) as response:
                response_body = response.read()

                self.send_response(response.status)

                # 代理自己添加 CORS 头
                self.send_header('Access-Control-Allow-Origin', '*')
                self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
                self.send_header('Access-Control-Allow-Headers', '*')

                # 复制上游响应头时，排除 CORS 相关头，避免重复
                skip_headers = {
                    'transfer-encoding', 'connection',
                    'access-control-allow-origin', 'access-control-allow-methods',
                    'access-control-allow-headers', 'access-control-max-age'
                }
                for key, value in response.getheaders():
                    if key.lower() not in skip_headers:
                        self.send_header(key, value)

                self.end_headers()
                self.wfile.write(response_body)
                self.log_request_info(method, self.path, response.status)

        except urllib.error.HTTPError as e:
            error_body = e.read()
            self.send_response(e.code)
            self.send_header('Access-Control-Allow-Origin', '*')
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            self.wfile.write(error_body)
            self.log_request_info(method, self.path, e.code)

        except (ConnectionAbortedError, ConnectionResetError, BrokenPipeError) as e:
            print(f"[WARN] 连接中断: {e}")

        except Exception as e:
            try:
                self.send_response(500)
                self.send_header('Access-Control-Allow-Origin', '*')
                self.send_header('Content-Type', 'application/json')
                self.end_headers()
                self.wfile.write(json.dumps({
                    'error': {'message': str(e)}
                }).encode('utf-8'))
            except:
                pass
            print(f"[ERROR] {e}")

    def log_request_info(self, method, path, status):
        print(f"  {method} {path} -> {status}")


def run_server():
    print("=" * 60)
    print("ModelScope API 代理服务器")
    print("=" * 60)
    print(f"本地地址: http://localhost:{PORT}")
    print(f"目标地址: {TARGET_BASE}")
    print()
    with socketserver.TCPServer(("", PORT), ProxyHandler) as httpd:
        httpd.serve_forever()

if __name__ == "__main__":
    run_server()
```

---

## 一键启动脚本（start.bat）

```bat
@echo off
cd /d "%~dp0"

echo ========================================
echo   AI Studio Startup
echo ========================================
echo.

echo Starting proxy server (port 8765)...
start /B py proxy_server.py

timeout /t 2 /nobreak >nul

echo Starting http server (port 8080)...
start /B py -m http.server 8080

timeout /t 1 /nobreak >nul

echo.
echo ========================================
echo   Done!
echo   Frontend: http://localhost:8080
echo   Proxy:    http://localhost:8765
echo ========================================
echo.
echo Opening browser...
explorer "http://localhost:8080"
```

**注意事项**：
- 不要使用中文（编码问题）
- 必须加 `cd /d "%~dp0"` 切换工作目录
- 使用 `start /B` 后台运行服务，避免多个黑窗口
- 使用 `explorer` 打开浏览器，不要用 `start`

---

## 前端实现要点

### HTML 结构

```html
<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <title>AI Chat & Image</title>
    <link rel="stylesheet" href="styles.css">
</head>
<body>
    <div class="app">
        <!-- 侧边栏：设置面板 -->
        <aside class="sidebar">
            <!-- API Key 配置 -->
            <input type="password" id="apiKeyInput">
            <!-- 模型选择 -->
            <select id="chatModelSelect">...</select>
            <select id="imageModelSelect">...</select>
        </aside>

        <!-- 主内容区 -->
        <main class="main-content">
            <!-- 对话区域 -->
            <div class="chat-area">
                <div class="messages-container"></div>
            </div>
            <!-- 生图区域 -->
            <div class="image-area">
                <textarea placeholder="描述图片..."></textarea>
                <button>生成图片</button>
                <div class="image-results"></div>
            </div>
            <!-- 输入区 -->
            <div class="input-section">
                <textarea placeholder="输入消息..."></textarea>
                <button>发送</button>
            </div>
            <!-- 调试控制台 -->
            <div class="debug-console">
                <div class="debug-content"></div>
            </div>
        </main>
    </div>
    <script src="app.js"></script>
</body>
</html>
```

### CSS 深色主题

```css
:root {
    --bg-primary: #0d0d0d;
    --bg-secondary: #1a1a1a;
    --bg-tertiary: #252525;
    --border-color: #333333;
    --text-primary: #e0e0e0;
    --text-secondary: #a0a0a0;
    --accent: #4a9eff;
}

body {
    background: var(--bg-primary);
    color: var(--text-primary);
}

.sidebar {
    background: var(--bg-secondary);
    border-right: 1px solid var(--border-color);
}

input, textarea, select {
    background: var(--bg-tertiary);
    color: var(--text-primary);
    border: 1px solid var(--border-color);
}

input:focus, textarea:focus, select:focus {
    border-color: var(--accent);
    outline: none;
}
```

### JavaScript 初始化顺序（关键）

```javascript
// 正确顺序 -- 不要改！
function init() {
    debugConsole.init();   // 1. 先初始化调试控制台 DOM
    loadSettings();        // 2. 加载设置（会调用 debugConsole.log）
    bindEvents();          // 3. 绑定按钮事件
    updateUI();            // 4. 更新界面状态
    checkProxyStatus();    // 5. 检查代理服务器
}
```

### API Key 实时同步（必须）

```javascript
// 所有输入框都必须监听 input 事件实时同步
apiKeyInput.addEventListener('input', () => {
    state.settings.apiKey = apiKeyInput.value.trim();
});
baseUrlInput.addEventListener('input', () => {
    state.settings.baseUrl = baseUrlInput.value.trim();
});
chatModelSelect.addEventListener('change', () => {
    state.settings.chatModel = chatModelSelect.value;
});
imageModelSelect.addEventListener('change', () => {
    state.settings.imageModel = imageModelSelect.value;
});
```

### 对话 API 调用

```javascript
async function callChatAPI(message) {
    const url = `${baseUrl}chat/completions`;
    const headers = {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
    };
    const body = {
        model: chatModel,
        messages: messages,
        stream: false
    };
    const response = await fetch(url, {
        method: 'POST', headers,
        body: JSON.stringify(body)
    });
    if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error?.message || `HTTP ${response.status}`);
    }
    const data = await response.json();
    return data.choices[0].message.content;
}
```

### 生图 API 调用（核心）

```javascript
// 1. 提交生图任务
async function callImageAPI(prompt) {
    const url = `${baseUrl}images/generations`;
    const headers = {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'X-ModelScope-Async-Mode': 'true'   // 必须！
    };
    const body = {
        model: imageModel,
        prompt: prompt,
        n: 1,
        size: '1024x1024'
    };
    const response = await fetch(url, {
        method: 'POST', headers,
        body: JSON.stringify(body)
    });
    if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error?.message || `HTTP ${response.status}`);
    }
    const data = await response.json();
    if (!data.task_id) {
        throw new Error('未返回任务 ID');
    }
    // 2. 轮询任务状态
    return await pollImageTask(data.task_id);
}

// 3. 轮询任务
async function pollImageTask(taskId) {
    const url = `${baseUrl}tasks/${taskId}`;
    const headers = {
        'Authorization': `Bearer ${apiKey}`,
        'X-ModelScope-Task-Type': 'image_generation'  // 必须！
    };
    const maxAttempts = 60;
    for (let i = 0; i < maxAttempts; i++) {
        await new Promise(resolve => setTimeout(resolve, 5000));
        const response = await fetch(url, { headers });
        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error?.message || `HTTP ${response.status}`);
        }
        const data = await response.json();
        if (data.task_status === 'SUCCEED') {
            if (data.output_images && data.output_images.length > 0) {
                return data.output_images;
            }
            throw new Error('未返回图片 URL');
        } else if (data.task_status === 'FAILED') {
            throw new Error(data.error_message || '任务失败');
        }
        // PENDING 或 RUNNING，继续等待
    }
    throw new Error('生成超时');
}
```

---

## 调试控制台（强烈建议实现）

在页面底部添加一个调试控制台，实时显示所有请求和错误信息：

```javascript
const debugConsole = {
    log(level, message, details) {
        const time = new Date().toLocaleTimeString('zh-CN', { hour12: false });
        let html = `<span>[${time}]</span> ${message}`;
        if (details) {
            html += `<pre>${JSON.stringify(details, null, 2)}</pre>`;
        }
        // 追加到控制台 DOM
        // 同时输出到浏览器 console
        const fn = level === 'error' ? console.error
                 : level === 'warning' ? console.warn
                 : console.log;
        fn(`[Debug] ${message}`, details || '');
    }
};
```

在关键位置添加日志：
- API Key 检查时
- 发送请求前（URL、headers、body）
- 收到响应后（status、关键数据）
- 错误发生时（完整错误信息）

---

## 支持的模型列表

### 对话模型

| 模型 ID | 说明 |
|---------|------|
| Qwen/Qwen3.5-35B-A3B | 推荐，平衡 |
| Qwen/Qwen3.5-27B | 中等 |
| Qwen/Qwen3-235B-A22B | 最强 |
| Qwen/Qwen3-32B | 中等 |
| Qwen/Qwen3-8B | 轻量 |
| deepseek-ai/DeepSeek-V3.2 | DeepSeek |
| ZhipuAI/GLM-5.2 | 智谱 |
| MiniMax/MiniMax-M3 | MiniMax |
| moonshotai/Kimi-K2.5 | Kimi |
| stepfun-ai/Step-3.7-Flash | 阶跃 |

### 生图模型

| 模型 ID | 说明 |
|---------|------|
| Tongyi-MAI/Z-Image-Turbo | 推荐，快速 |
| Tongyi-MAI/Z-Image | 标准质量 |
| Qwen/Qwen-Image | 通义图像 |
| Qwen/Qwen-Image-2512 | 写实摄影 |
| Kwai-Kolors/Kolors | 快手可图 |
| Tencent-Hunyuan/HunyuanImage-3.0 | 腾讯混元 3.0 |
| Tencent-Hunyuan/HunyuanImage-2.1 | 腾讯混元 2.1 |
| black-forest-labs/FLUX.1-dev | FLUX 标准 |
| black-forest-labs/FLUX.1-schnell | FLUX 快速 |
| stabilityai/stable-diffusion-xl-base-1.0 | SDXL |
| HiDream-ai/HiDream-O1-Image | HiDream |

---

## 快速排查清单

遇到问题时，按以下顺序检查：

1. **代理服务器是否启动？**
   ```powershell
   netstat -ano | findstr :8765
   ```

2. **HTTP 服务器是否启动？**
   ```powershell
   netstat -ano | findstr :8080
   ```

3. **端口是否被占用？**
   - 如果有多个 LISTENING，用 `taskkill /PID <ID> /F` 清理

4. **浏览器控制台是否有 CORS 错误？**
   - 检查 `Access-Control-Allow-Origin` 是否只有一个 `*`
   - 检查代理是否正确响应 OPTIONS 请求

5. **API Key 是否已设置？**
   - 检查输入框是否有值
   - 检查 state.settings.apiKey 是否有值
   - 两者必须同步

6. **生图请求是否使用正确的端点？**
   - 必须是 `/v1/images/generations`
   - 不是 `/v1/chat/completions`

7. **生图请求是否带异步头？**
   - 提交时：`X-ModelScope-Async-Mode: true`
   - 轮询时：`X-ModelScope-Task-Type: image_generation`

8. **JavaScript 初始化顺序是否正确？**
   - debugConsole.init() 必须在 loadSettings() 之前
   - 否则按钮无法点击

---

## 参考资料

- [ModelScope API 文档](https://www.modelscope.cn/docs/model-service/API-Inference/intro)
- [ModelScope AIGC 模型列表](https://modelscope.cn/aigc/imageGeneration)

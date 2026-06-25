// Agnes AI 代理服务器 (Node.js)
// 运行: node server.js
// 解决浏览器直接调用魔搭等API的CORS问题

const http = require("http");
const https = require("https");
const fs = require("fs");
const path = require("path");
const { URL } = require("url");

const PORT = 8000;
const MODEL_SCOPE_BASE = "https://api-inference.modelscope.cn";

// 需要跳过的上游CORS头（避免重复）
const SKIP_HEADERS = new Set([
    'transfer-encoding', 'connection',
    'access-control-allow-origin', 'access-control-allow-methods',
    'access-control-allow-headers', 'access-control-max-age'
]);

// MIME types
const MIME_TYPES = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "application/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".svg": "image/svg+xml",
    ".ico": "image/x-icon",
    ".webp": "image/webp",
    ".mp4": "video/mp4",
    ".webm": "video/webm",
};

function setCORS(res) {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "*");
    res.setHeader("Access-Control-Expose-Headers", "*");
    res.setHeader("Access-Control-Max-Age", "86400");
}

function proxyRequest(targetUrl, method, reqHeaders, body) {
    return new Promise((resolve, reject) => {
        const parsed = new URL(targetUrl);
        const isHttps = parsed.protocol === "https:";
        const transport = isHttps ? https : http;

        // 复制请求头，排除不需要的
        const headers = {};
        for (const [k, v] of Object.entries(reqHeaders)) {
            const kl = k.toLowerCase();
            if (kl !== 'host' && kl !== 'content-length' && kl !== 'origin' && kl !== 'referer') {
                headers[k] = v;
            }
        }

        const options = {
            hostname: parsed.hostname,
            port: parsed.port || (isHttps ? 443 : 80),
            path: parsed.pathname + parsed.search,
            method,
            headers,
        };

        const proxyReq = transport.request(options, (proxyRes) => {
            let data = [];
            proxyRes.on("data", (chunk) => data.push(chunk));
            proxyRes.on("end", () => {
                resolve({
                    status: proxyRes.statusCode,
                    headers: proxyRes.headers,
                    body: Buffer.concat(data),
                });
            });
        });

        proxyReq.on("error", reject);
        proxyReq.setTimeout(300000, () => { proxyReq.destroy(); reject(new Error("Timeout")); });

        if (body && method !== "GET" && method !== "HEAD") {
            proxyReq.write(body);
        }
        proxyReq.end();
    });
}

function stripBOM(data) {
    let start = 0;
    while (start < data.length - 2 && data[start] === 0xEF && data[start + 1] === 0xBB && data[start + 2] === 0xBF) {
        start += 3;
    }
    if (start > 0) {
        console.log(`[BOM] 自动移除 ${start} 字节BOM`);
        return data.slice(start);
    }
    return data;
}

function serveStatic(req, res, filePath) {
    const ext = path.extname(filePath);
    const contentType = MIME_TYPES[ext] || "application/octet-stream";

    fs.readFile(filePath, (err, data) => {
        if (err) {
            res.writeHead(404, { "Content-Type": "text/plain" });
            res.end("Not Found");
            return;
        }
        data = stripBOM(data);
        setCORS(res);
        res.writeHead(200, { "Content-Type": contentType, "Cache-Control": "no-cache" });
        res.end(data);
    });
}

function getRequestBody(req) {
    return new Promise((resolve) => {
        let body = [];
        req.on("data", (chunk) => body.push(chunk));
        req.on("end", () => resolve(Buffer.concat(body)));
    });
}

// 写代理响应：先设CORS头，再复制上游头（跳过CORS相关），避免重复
function writeProxyResponse(res, result) {
    setCORS(res);
    // 复制上游响应头，跳过CORS相关头
    for (const [key, value] of Object.entries(result.headers)) {
        if (!SKIP_HEADERS.has(key.toLowerCase())) {
            res.setHeader(key, value);
        }
    }
    res.writeHead(result.status);
    res.end(result.body);
}

const server = http.createServer(async (req, res) => {
    const parsedUrl = new URL(req.url, `http://localhost:${PORT}`);
    const pathname = parsedUrl.pathname;

    // CORS 预检
    if (req.method === "OPTIONS") {
        setCORS(res);
        res.writeHead(204);
        res.end();
        return;
    }

    try {
        // 魔搭 API 代理: /api/modelscope/v1/... -> https://api-inference.modelscope.cn/v1/...
        if (pathname.startsWith("/api/modelscope/")) {
            const targetPath = pathname.replace("/api/modelscope", "");
            const targetUrl = MODEL_SCOPE_BASE + targetPath + parsedUrl.search;
            const body = await getRequestBody(req);
            const result = await proxyRequest(targetUrl, req.method, req.headers, body);
            writeProxyResponse(res, result);
            console.log(`[ModelScope] ${req.method} ${targetPath} -> ${result.status}`);
            return;
        }

        // 通用代理
        if (pathname === "/api/proxy") {
            const targetUrl = parsedUrl.searchParams.get("target");
            if (!targetUrl) {
                setCORS(res);
                res.writeHead(400, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ error: "Missing target parameter" }));
                return;
            }
            const body = await getRequestBody(req);
            const result = await proxyRequest(targetUrl, req.method, req.headers, body);
            writeProxyResponse(res, result);
            return;
        }

        // 下载代理
        if (pathname === "/dl") {
            const fileUrl = parsedUrl.searchParams.get("url");
            if (!fileUrl) {
                setCORS(res);
                res.writeHead(400);
                res.end("Missing url parameter");
                return;
            }
            const result = await proxyRequest(fileUrl, "GET", {}, null);
            setCORS(res);
            for (const [key, value] of Object.entries(result.headers)) {
                if (!SKIP_HEADERS.has(key.toLowerCase())) {
                    res.setHeader(key, value);
                }
            }
            res.setHeader("Cache-Control", "public, max-age=86400");
            res.writeHead(result.status);
            res.end(result.body);
            return;
        }

        // 静态文件
        let filePath = path.join(__dirname, pathname === "/" ? "Agnes.html" : pathname);
        filePath = path.resolve(filePath);
        if (!filePath.startsWith(__dirname)) {
            res.writeHead(403);
            res.end("Forbidden");
            return;
        }
        serveStatic(req, res, filePath);
    } catch (err) {
        console.error(`[Error] ${err.message}`);
        setCORS(res);
        try {
            res.writeHead(502, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: { message: err.message } }));
        } catch {}
    }
});

// 启动时自动清除主文件BOM
function cleanFileBOM(filePath) {
    try {
        const data = fs.readFileSync(filePath);
        let start = 0;
        while (start < data.length - 2 && data[start] === 0xEF && data[start + 1] === 0xBB && data[start + 2] === 0xBF) {
            start += 3;
        }
        if (start > 0) {
            fs.writeFileSync(filePath, data.slice(start));
            console.log(`[BOM] 启动时清除 ${start} 字节BOM`);
        }
    } catch {}
}
cleanFileBOM(path.join(__dirname, "Agnes.html"));

server.listen(PORT, () => {
    console.log(`Agnes AI 代理服务器已启动: http://localhost:${PORT}`);
    console.log(`魔搭代理: /api/modelscope/v1/... -> api-inference.modelscope.cn/v1/...`);
    console.log(`通用代理: /api/proxy?target=URL`);
    console.log(`下载代理: /dl?url=URL`);
    console.log(`打开 http://localhost:${PORT} 使用应用`);
});

// ===== Debug Console =====
const debugConsole = {
    el: null,
    contentEl: null,
    expanded: true,

    init() {
        this.el = document.getElementById('debugConsole');
        this.contentEl = document.getElementById('debugContent');
        document.getElementById('toggleDebug').addEventListener('click', () => this.toggle());
        document.getElementById('clearDebug').addEventListener('click', () => this.clear());
        this.log('info', '调试控制台已初始化');
    },

    log(level, message, details) {
        const time = new Date().toLocaleTimeString('zh-CN', { hour12: false });
        const entry = document.createElement('div');
        entry.className = `debug-log ${level}`;

        let html = `<span class="timestamp">[${time}]</span>${this.escapeHtml(message)}`;
        if (details) {
            const detailStr = typeof details === 'string' ? details : JSON.stringify(details, null, 2);
            html += `<span class="details">${this.escapeHtml(detailStr)}</span>`;
        }
        entry.innerHTML = html;
        this.contentEl.appendChild(entry);
        this.contentEl.scrollTop = this.contentEl.scrollHeight;

        // Also log to browser console
        const consoleFn = level === 'error' ? console.error : level === 'warning' ? console.warn : console.log;
        consoleFn(`[Debug] ${message}`, details || '');
    },

    escapeHtml(str) {
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    },

    toggle() {
        this.expanded = !this.expanded;
        this.contentEl.style.display = this.expanded ? 'block' : 'none';
    },

    clear() {
        this.contentEl.innerHTML = '';
        this.log('info', '控制台已清空');
    }
};

// ===== State Management =====
const state = {
    mode: 'chat',
    messages: [],
    isGenerating: false,
    settings: {
        apiKey: '',
        baseUrl: 'http://localhost:8765/v1/',
        chatModel: 'Qwen/Qwen3.5-35B-A3B',
        imageModel: 'Tongyi-MAI/Z-Image-Turbo',
        imageSize: '1024x1024',
        imageCount: 1,
        customModels: []
    }
};

// ===== DOM Elements =====
const elements = {
    sidebar: document.getElementById('sidebar'),
    toggleSidebar: document.getElementById('toggleSidebar'),
    openSidebar: document.getElementById('openSidebar'),
    modeChat: document.getElementById('modeChat'),
    modeImage: document.getElementById('modeImage'),
    topbarTitle: document.getElementById('topbarTitle'),
    apiKeyInput: document.getElementById('apiKeyInput'),
    baseUrlInput: document.getElementById('baseUrlInput'),
    chatModelSelect: document.getElementById('chatModelSelect'),
    imageModelSelect: document.getElementById('imageModelSelect'),
    customModelInput: document.getElementById('customModelInput'),
    addCustomModel: document.getElementById('addCustomModel'),
    customModelsList: document.getElementById('customModelsList'),
    imageSizeSelect: document.getElementById('imageSizeSelect'),
    imageCountInput: document.getElementById('imageCountInput'),
    saveSettings: document.getElementById('saveSettings'),
    toggleKeyVis: document.getElementById('toggleKeyVis'),
    chatArea: document.getElementById('chatArea'),
    imageArea: document.getElementById('imageArea'),
    inputSection: document.getElementById('inputSection'),
    messagesContainer: document.getElementById('messagesContainer'),
    welcomeMessage: document.getElementById('welcomeMessage'),
    chatInput: document.getElementById('chatInput'),
    sendBtn: document.getElementById('sendBtn'),
    clearBtn: document.getElementById('clearBtn'),
    imagePromptInput: document.getElementById('imagePromptInput'),
    generateImageBtn: document.getElementById('generateImageBtn'),
    imageResults: document.getElementById('imageResults')
};

// ===== Initialization =====
function init() {
    debugConsole.init();
    loadSettings();
    bindEvents();
    updateUI();
    checkProxyStatus();
}

// ===== Proxy Check =====
async function checkProxyStatus() {
    debugConsole.log('info', '检查代理服务器状态...');
    try {
        const resp = await fetch('http://localhost:8765/v1/models', {
            method: 'GET',
            headers: { 'Authorization': `Bearer ${state.settings.apiKey}` }
        });
        if (resp.ok) {
            debugConsole.log('success', '代理服务器连接正常 (localhost:8765)');
        } else {
            debugConsole.log('warning', `代理服务器返回异常状态: ${resp.status}`);
        }
    } catch (e) {
        debugConsole.log('error', '无法连接代理服务器，请先启动 proxy_server.py', {
            启动命令: 'py proxy_server.py',
            说明: '代理服务器未运行，生图功能将无法使用。对话功能可能也会受影响。'
        });
    }
}

// ===== Settings Management =====
function loadSettings() {
    const saved = localStorage.getItem('ai_studio_settings');
    if (saved) {
        try {
            const parsed = JSON.parse(saved);
            state.settings = { ...state.settings, ...parsed };
            debugConsole.log('info', '从 localStorage 加载设置', {
                hasApiKey: !!state.settings.apiKey,
                apiKeyPreview: state.settings.apiKey ? state.settings.apiKey.substring(0, 8) + '...' : '(空)',
                baseUrl: state.settings.baseUrl
            });
        } catch (e) {
            console.error('Failed to load settings:', e);
            debugConsole.log('error', '加载设置失败', { error: e.message });
        }
    } else {
        debugConsole.log('warning', 'localStorage 中没有保存的设置');
    }

    elements.apiKeyInput.value = state.settings.apiKey;
    elements.baseUrlInput.value = state.settings.baseUrl;
    elements.chatModelSelect.value = state.settings.chatModel;
    elements.imageModelSelect.value = state.settings.imageModel;
    elements.imageSizeSelect.value = state.settings.imageSize;
    elements.imageCountInput.value = state.settings.imageCount;

    renderCustomModels();
}

function saveSettings() {
    state.settings.apiKey = elements.apiKeyInput.value.trim();
    state.settings.baseUrl = elements.baseUrlInput.value.trim();
    state.settings.chatModel = elements.chatModelSelect.value;
    state.settings.imageModel = elements.imageModelSelect.value;
    state.settings.imageSize = elements.imageSizeSelect.value;
    state.settings.imageCount = parseInt(elements.imageCountInput.value) || 1;

    localStorage.setItem('ai_studio_settings', JSON.stringify(state.settings));
    debugConsole.log('success', '设置已保存', {
        baseUrl: state.settings.baseUrl,
        chatModel: state.settings.chatModel,
        imageModel: state.settings.imageModel,
        apiKey: state.settings.apiKey ? state.settings.apiKey.substring(0, 8) + '...' : '(空)'
    });
    showToast('设置已保存', 'success');
}

function renderCustomModels() {
    elements.customModelsList.innerHTML = '';
    state.settings.customModels.forEach((model, index) => {
        const tag = document.createElement('span');
        tag.className = 'custom-model-tag';
        tag.innerHTML = `
            <span>${model}</span>
            <span class="remove-model" data-index="${index}">&times;</span>
        `;
        elements.customModelsList.appendChild(tag);
    });
}

function addCustomModel() {
    const modelId = elements.customModelInput.value.trim();
    if (!modelId) return;

    if (!state.settings.customModels.includes(modelId)) {
        state.settings.customModels.push(modelId);
        elements.customModelInput.value = '';
        renderCustomModels();
        saveSettings();
        debugConsole.log('info', `添加自定义模型: ${modelId}`);
    }
}

function removeCustomModel(index) {
    const model = state.settings.customModels[index];
    state.settings.customModels.splice(index, 1);
    renderCustomModels();
    saveSettings();
    debugConsole.log('info', `移除自定义模型: ${model}`);
}

// ===== Event Binding =====
function bindEvents() {
    elements.toggleSidebar.addEventListener('click', () => {
        elements.sidebar.classList.add('collapsed');
        elements.openSidebar.style.display = 'block';
    });

    elements.openSidebar.addEventListener('click', () => {
        elements.sidebar.classList.remove('collapsed');
        elements.openSidebar.style.display = 'none';
    });

    elements.modeChat.addEventListener('click', () => switchMode('chat'));
    elements.modeImage.addEventListener('click', () => switchMode('image'));

    document.querySelectorAll('.welcome-card').forEach(card => {
        card.addEventListener('click', () => {
            switchMode(card.dataset.action);
        });
    });

    elements.saveSettings.addEventListener('click', saveSettings);
    elements.addCustomModel.addEventListener('click', addCustomModel);
    elements.customModelInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') addCustomModel();
    });

    elements.toggleKeyVis.addEventListener('click', () => {
        const type = elements.apiKeyInput.type === 'password' ? 'text' : 'password';
        elements.apiKeyInput.type = type;
    });

    // 实时同步
    elements.apiKeyInput.addEventListener('input', () => {
        state.settings.apiKey = elements.apiKeyInput.value.trim();
    });
    elements.baseUrlInput.addEventListener('input', () => {
        state.settings.baseUrl = elements.baseUrlInput.value.trim();
    });
    elements.chatModelSelect.addEventListener('change', () => {
        state.settings.chatModel = elements.chatModelSelect.value;
    });
    elements.imageModelSelect.addEventListener('change', () => {
        state.settings.imageModel = elements.imageModelSelect.value;
    });

    elements.customModelsList.addEventListener('click', (e) => {
        if (e.target.classList.contains('remove-model')) {
            removeCustomModel(parseInt(e.target.dataset.index));
        }
    });

    // Chat
    elements.sendBtn.addEventListener('click', sendMessage);
    elements.chatInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            sendMessage();
        }
    });
    elements.chatInput.addEventListener('input', () => {
        elements.chatInput.style.height = 'auto';
        elements.chatInput.style.height = Math.min(elements.chatInput.scrollHeight, 120) + 'px';
    });
    elements.clearBtn.addEventListener('click', clearChat);

    // Image
    elements.generateImageBtn.addEventListener('click', generateImage);
    elements.imagePromptInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            generateImage();
        }
    });
}

// ===== Mode Switching =====
function switchMode(mode) {
    state.mode = mode;
    updateUI();
    debugConsole.log('info', `切换到${mode === 'chat' ? '对话' : '生图'}模式`);
}

function updateUI() {
    elements.modeChat.classList.toggle('active', state.mode === 'chat');
    elements.modeImage.classList.toggle('active', state.mode === 'image');
    elements.topbarTitle.textContent = state.mode === 'chat' ? '对话' : '生图';

    if (state.mode === 'chat') {
        elements.chatArea.classList.remove('hidden');
        elements.imageArea.classList.add('hidden');
        elements.inputSection.classList.remove('hidden');
    } else {
        elements.chatArea.classList.add('hidden');
        elements.imageArea.classList.remove('hidden');
        elements.inputSection.classList.add('hidden');
    }
}

// ===== Chat Functions =====
function addMessage(role, content) {
    state.messages.push({ role, content });
    renderMessage(role, content);
}

function renderMessage(role, content) {
    elements.welcomeMessage.classList.add('hidden');

    const messageEl = document.createElement('div');
    messageEl.className = `message ${role}`;

    const avatar = document.createElement('div');
    avatar.className = 'message-avatar';
    avatar.textContent = role === 'user' ? '你' : 'AI';

    const contentEl = document.createElement('div');
    contentEl.className = 'message-content';
    contentEl.innerHTML = formatMessage(content);

    messageEl.appendChild(avatar);
    messageEl.appendChild(contentEl);
    elements.messagesContainer.appendChild(messageEl);
    elements.chatArea.scrollTop = elements.chatArea.scrollHeight;
}

function formatMessage(text) {
    let html = text
        .replace(/```(\w+)?\n([\s\S]*?)```/g, '<pre><code>$2</code></pre>')
        .replace(/`([^`]+)`/g, '<code>$1</code>')
        .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
        .replace(/\*(.+?)\*/g, '<em>$1</em>')
        .replace(/\n/g, '<br>');
    return html;
}

function clearChat() {
    state.messages = [];
    elements.messagesContainer.innerHTML = '';
    elements.welcomeMessage.classList.remove('hidden');
    debugConsole.log('info', '对话已清空');
}

async function sendMessage() {
    const content = elements.chatInput.value.trim();
    if (!content || state.isGenerating) return;

    debugConsole.log('info', '检查 API Key', {
        hasApiKey: !!state.settings.apiKey,
        apiKeyLength: state.settings.apiKey ? state.settings.apiKey.length : 0,
        apiKeyPreview: state.settings.apiKey ? state.settings.apiKey.substring(0, 8) + '...' : '(空)'
    });

    if (!state.settings.apiKey) {
        showToast('请先设置 API Key', 'error');
        debugConsole.log('error', '发送失败: API Key 未设置', {
            inputValue: elements.apiKeyInput.value ? '有值' : '空',
            stateValue: state.settings.apiKey ? '有值' : '空'
        });
        return;
    }

    addMessage('user', content);
    elements.chatInput.value = '';
    elements.chatInput.style.height = 'auto';

    state.isGenerating = true;
    elements.sendBtn.disabled = true;

    const typingEl = document.createElement('div');
    typingEl.className = 'message assistant';
    typingEl.innerHTML = `
        <div class="message-avatar">AI</div>
        <div class="message-content">
            <div class="typing-indicator">
                <span></span><span></span><span></span>
            </div>
        </div>
    `;
    elements.messagesContainer.appendChild(typingEl);
    elements.chatArea.scrollTop = elements.chatArea.scrollHeight;

    try {
        debugConsole.log('info', '发送对话请求', {
            url: `${state.settings.baseUrl}chat/completions`,
            model: state.settings.chatModel,
            message: content.substring(0, 100)
        });

        const response = await callChatAPI(content);
        typingEl.remove();
        addMessage('assistant', response);
        debugConsole.log('success', '对话响应成功', {
            回复长度: response.length
        });
    } catch (error) {
        typingEl.remove();
        addMessage('assistant', `错误: ${error.message}`);
        debugConsole.log('error', '对话请求失败', {
            错误: error.message,
            baseUrl: state.settings.baseUrl,
            提示: '请确认代理服务器已启动 (py proxy_server.py)'
        });
        showToast('请求失败', 'error');
    } finally {
        state.isGenerating = false;
        elements.sendBtn.disabled = false;
    }
}

async function callChatAPI(message) {
    const url = `${state.settings.baseUrl}chat/completions`;
    const headers = {
        'Authorization': `Bearer ${state.settings.apiKey}`,
        'Content-Type': 'application/json'
    };

    const messages = [
        ...state.messages.slice(-10),
        { role: 'user', content: message }
    ];

    const body = {
        model: state.settings.chatModel,
        messages: messages,
        stream: false
    };

    debugConsole.log('info', '对话 API 请求体', { model: body.model, messages_count: body.messages.length });

    const response = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(body)
    });

    debugConsole.log('info', `对话 API 响应状态: ${response.status}`);

    if (!response.ok) {
        const errorText = await response.text();
        debugConsole.log('error', '对话 API 错误响应', { status: response.status, body: errorText.substring(0, 500) });
        let errorMsg = `HTTP ${response.status}`;
        try {
            const error = JSON.parse(errorText);
            errorMsg = error.error?.message || errorMsg;
        } catch (e) {}
        throw new Error(errorMsg);
    }

    const data = await response.json();
    debugConsole.log('info', '对话 API 响应数据', {
        model: data.model,
        choices: data.choices?.length,
        usage: data.usage
    });

    return data.choices[0].message.content;
}

// ===== Image Generation Functions =====
async function generateImage() {
    const prompt = elements.imagePromptInput.value.trim();
    if (!prompt || state.isGenerating) return;

    if (!state.settings.apiKey) {
        showToast('请先设置 API Key', 'error');
        debugConsole.log('error', '生图失败: API Key 未设置');
        return;
    }

    state.isGenerating = true;
    elements.generateImageBtn.disabled = true;

    const loadingEl = document.createElement('div');
    loadingEl.className = 'image-result-card';
    loadingEl.innerHTML = `
        <div class="image-loading">
            <div class="spinner"></div>
            <span>正在生成图片...</span>
        </div>
    `;
    elements.imageResults.insertBefore(loadingEl, elements.imageResults.firstChild);

    try {
        debugConsole.log('info', '开始生图任务', {
            model: state.settings.imageModel,
            prompt: prompt,
            size: state.settings.imageSize,
            count: state.settings.imageCount
        });

        const images = await callImageAPI(prompt);
        loadingEl.remove();

        images.forEach((imageUrl, index) => {
            addImageResult(imageUrl, prompt, index + 1);
        });

        debugConsole.log('success', `成功生成 ${images.length} 张图片`);
        showToast(`成功生成 ${images.length} 张图片`, 'success');
    } catch (error) {
        loadingEl.remove();
        debugConsole.log('error', '生图失败', {
            错误: error.message,
            baseUrl: state.settings.baseUrl,
            提示: '请确认代理服务器已启动 (py proxy_server.py)'
        });
        showToast(`生成失败: ${error.message}`, 'error');
    } finally {
        state.isGenerating = false;
        elements.generateImageBtn.disabled = false;
    }
}

async function callImageAPI(prompt) {
    const url = `${state.settings.baseUrl}images/generations`;
    const headers = {
        'Authorization': `Bearer ${state.settings.apiKey}`,
        'Content-Type': 'application/json',
        'X-ModelScope-Async-Mode': 'true'
    };

    const body = {
        model: state.settings.imageModel,
        prompt: prompt,
        n: state.settings.imageCount,
        size: state.settings.imageSize
    };

    debugConsole.log('info', '生图 API 提交请求', {
        url: url,
        headers: { 'X-ModelScope-Async-Mode': 'true' },
        body: body
    });

    let response;
    try {
        response = await fetch(url, {
            method: 'POST',
            headers,
            body: JSON.stringify(body)
        });
    } catch (e) {
        debugConsole.log('error', '生图 API 网络请求失败', {
            错误: e.message,
            可能原因: '代理服务器未启动或网络连接失败'
        });
        throw new Error('网络请求失败: ' + e.message);
    }

    debugConsole.log('info', `生图 API 响应状态: ${response.status}`);

    const responseText = await response.text();
    debugConsole.log('info', '生图 API 响应体', { body: responseText.substring(0, 1000) });

    if (!response.ok) {
        let errorMsg = `HTTP ${response.status}`;
        try {
            const error = JSON.parse(responseText);
            errorMsg = error.error?.message || errorMsg;
        } catch (e) {}
        throw new Error(errorMsg);
    }

    let data;
    try {
        data = JSON.parse(responseText);
    } catch (e) {
        throw new Error('响应解析失败: ' + responseText.substring(0, 200));
    }

    debugConsole.log('info', '生图 API 解析结果', {
        task_id: data.task_id,
        task_status: data.task_status,
        所有字段: Object.keys(data)
    });

    if (!data.task_id) {
        // 可能直接返回了图片
        if (data.data && data.data.length > 0 && data.data[0].url) {
            debugConsole.log('success', '同步模式直接返回图片');
            return data.data.map(d => d.url);
        }
        throw new Error('未返回任务 ID，响应: ' + JSON.stringify(data).substring(0, 300));
    }

    return await pollImageTask(data.task_id);
}

async function pollImageTask(taskId) {
    const url = `${state.settings.baseUrl}tasks/${taskId}`;
    const headers = {
        'Authorization': `Bearer ${state.settings.apiKey}`,
        'X-ModelScope-Task-Type': 'image_generation'
    };

    debugConsole.log('info', '开始轮询任务状态', {
        url: url,
        taskId: taskId,
        headers: { 'X-ModelScope-Task-Type': 'image_generation' }
    });

    const maxAttempts = 60;
    let attempts = 0;

    while (attempts < maxAttempts) {
        await new Promise(resolve => setTimeout(resolve, 5000));
        attempts++;

        debugConsole.log('info', `轮询第 ${attempts} 次...`);

        let response;
        try {
            response = await fetch(url, { headers });
        } catch (e) {
            debugConsole.log('error', `轮询网络失败 (第${attempts}次)`, { 错误: e.message });
            continue;
        }

        const responseText = await response.text();
        debugConsole.log('info', `轮询响应 [${response.status}]`, { body: responseText.substring(0, 500) });

        if (!response.ok) {
            debugConsole.log('warning', `轮询返回错误状态: ${response.status}`);
            continue;
        }

        let data;
        try {
            data = JSON.parse(responseText);
        } catch (e) {
            debugConsole.log('warning', '轮询响应解析失败');
            continue;
        }

        debugConsole.log('info', `任务状态: ${data.task_status}`, {
            所有字段: Object.keys(data),
            output_images: data.output_images ? `${data.output_images.length} 张` : '无'
        });

        if (data.task_status === 'SUCCEED') {
            if (data.output_images && data.output_images.length > 0) {
                debugConsole.log('success', '任务完成，获取图片 URL', {
                    urls: data.output_images
                });
                return data.output_images;
            } else {
                debugConsole.log('error', '任务成功但没有图片 URL', {
                    完整响应: data
                });
                throw new Error('任务成功但未返回图片 URL');
            }
        } else if (data.task_status === 'FAILED') {
            debugConsole.log('error', '任务失败', { 完整响应: data });
            throw new Error('任务失败: ' + JSON.stringify(data).substring(0, 300));
        }
    }

    throw new Error(`生成超时 (已轮询 ${maxAttempts} 次)`);
}

function addImageResult(imageUrl, prompt, index) {
    const card = document.createElement('div');
    card.className = 'image-result-card';
    card.innerHTML = `
        <img src="${imageUrl}" alt="${prompt}" onclick="window.open('${imageUrl}', '_blank')">
        <div class="image-result-info">
            <span>图片 ${index}</span>
            <button onclick="downloadImage('${imageUrl}', 'image_${Date.now()}.jpg')">下载</button>
        </div>
    `;
    elements.imageResults.insertBefore(card, elements.imageResults.firstChild);
}

function downloadImage(url, filename) {
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
}

// ===== Toast Notifications =====
function showToast(message, type = 'info') {
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.textContent = message;
    toast.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        padding: 12px 20px;
        background: ${type === 'success' ? '#4caf50' : type === 'error' ? '#f44336' : '#2196f3'};
        color: white;
        border-radius: 6px;
        box-shadow: 0 4px 12px rgba(0,0,0,0.3);
        z-index: 10000;
        animation: slideIn 0.3s ease;
    `;
    document.body.appendChild(toast);
    setTimeout(() => {
        toast.style.animation = 'slideOut 0.3s ease';
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}

const style = document.createElement('style');
style.textContent = `
    @keyframes slideIn {
        from { transform: translateX(100%); opacity: 0; }
        to { transform: translateX(0); opacity: 1; }
    }
    @keyframes slideOut {
        from { transform: translateX(0); opacity: 1; }
        to { transform: translateX(100%); opacity: 0; }
    }
`;
document.head.appendChild(style);

// ===== Initialize =====
init();

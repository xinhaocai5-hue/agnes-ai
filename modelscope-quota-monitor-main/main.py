import requests
import os
import concurrent.futures
import unicodedata
from dotenv import load_dotenv

# 尝试从同目录下的 .env 文件加载环境变量 (开源安全最佳实践)
load_dotenv()

# ================= 配置区 =================
# 从环境变量读取 Token，不再硬编码！
API_TOKEN = os.getenv("MODELSCOPE_API_TOKEN")
API_BASE = "https://api-inference.modelscope.cn"
CHAT_URL = API_BASE + "/v1/chat/completions"
MODELS_URL = API_BASE + "/v1/models"
ZERO_COST_PROBE = True

# 生图/视频模型不在 /v1/models 列表里，需要手动维护
# 格式: "模型ID": "能力标注"
# 来源: 项目 Agnes.html / 魔搭 AIGC 页面 / SKILL.md
IMAGE_MODELS = {
    # Z-Image 系列 (通义) - 文生图
    "Tongyi-MAI/Z-Image-Turbo": "文生图",
    "Tongyi-MAI/Z-Image": "文生图",
    # Qwen-Image 系列 - 文生图 / 图片编辑
    "Qwen/Qwen-Image": "文生图",
    "Qwen/Qwen-Image-2512": "文生图",
    "Qwen/Qwen-Image-Edit-2511": "图片编辑",
    "Qwen/Qwen-Image-Edit": "图片编辑",
    # FLUX.1 系列 - 文生图
    "black-forest-labs/FLUX.1-dev": "文生图",
    "black-forest-labs/FLUX.1-schnell": "文生图",
    "ai-modelscope/flux.1-dev": "文生图",
    # FLUX.2 系列 (新) - 文生图
    "black-forest-labs/FLUX.2-dev": "文生图",
    "black-forest-labs/FLUX.2-klein-9B": "文生图",
    "black-forest-labs/FLUX.2-klein-4B": "文生图",
    "black-forest-labs/FLUX.2-klein-base-9B": "文生图",
    # Stable Diffusion 系列 - 文生图
    "stabilityai/stable-diffusion-xl-base-1.0": "文生图",
    "MusePublic/stable-diffusion-v1-5": "文生图",
    # 其他生图/编辑模型
    "Kwai-Kolors/Kolors": "文生图",
    "Tencent-Hunyuan/HunyuanImage-3.0": "文生图",
    "Tencent-Hunyuan/HunyuanImage-2.1": "文生图",
    "HiDream-ai/HiDream-O1-Image": "文生图",
    "FireRedTeam/FireRed-Image-Edit-1.1": "图片编辑",
    "jd-opensource/JoyAI-Image-Edit": "图片编辑",
    "MusePublic/Qwen-Image-Edit": "图片编辑",
    # 视频生成
    "Lightricks/LTX-2.3": "视频生成",
}

# 厂商前缀到中文名称的映射 (用于自动分组)
VENDOR_NAMES = {
    "deepseek-ai": "DeepSeek 阵营",
    "Qwen": "Qwen (通义千问) 阵营",
    "ZhipuAI": "智谱 GLM 阵营",
    "moonshotai": "Kimi (月之暗面)",
    "MiniMax": "MiniMax",
    "stepfun-ai": "Step (阶跃星辰)",
    "meituan-longcat": "美团 LongCat",
    "XiaomiMiMo": "小米 MiMo",
    "mistralai": "Mistral (法国)",
    "LLM-Research": "LLM-Research (开源)",
    "PaddlePaddle": "百度 ERNIE (飞桨)",
    "OpenGVLab": "OpenGVLab (书生视觉)",
    "Shanghai_AI_Laboratory": "上海 AI Lab (Intern)",
    "iic": "iic (达摩院)",
    "MedAIBase": "医疗 AI",
    "nex-agi": "Nex AGI",
    "opencompass": "OpenCompass",
    "XGenerationLab": "XGenerationLab (SQL)",
    "MusePublic": "MusePublic",
    "black-forest-labs": "Black Forest Labs (FLUX)",
    "stabilityai": "Stability AI (SD)",
    "jd-opensource": "京东开源",
    "Tongyi-MAI": "通义 MAI (Z-Image)",
    "Kwai-Kolors": "快手 (Kolors)",
    "Tencent-Hunyuan": "腾讯混元",
    "HiDream-ai": "智象未来 (HiDream)",
    "FireRedTeam": "FireRedTeam",
    "Lightricks": "Lightricks (LTX)",
}
# ==========================================

def get_display_width(text):
    width = 0
    for char in str(text):
        if unicodedata.east_asian_width(char) in ('W', 'F'):
            width += 2
        else:
            width += 1
    return width

def pad_string(text, target_width):
    text = str(text) if text is not None else "N/A"
    current_width = get_display_width(text)
    padding = max(0, target_width - current_width)
    return text + " " * padding

def safe_int(val, default=0):
    try:
        return int(val)
    except (ValueError, TypeError):
        return default

def infer_capability(model_id):
    """根据模型名推断对话模型的能力类型"""
    name_lower = model_id.lower()
    # 视觉多模态
    if any(k in name_lower for k in ["vl", "vision", "gui-owl", "internvl", "phi-4-reasoning-vision"]):
        return "多模态理解"
    # 代码生成
    if any(k in name_lower for k in ["coder", "code"]):
        return "代码生成"
    # SQL
    if "sql" in name_lower:
        return "SQL生成"
    # GUI Agent
    if "gui" in name_lower:
        return "GUI Agent"
    # 医疗
    if any(k in name_lower for k in ["med", "antangel"]):
        return "医疗AI"
    # 评测/判断
    if "judger" in name_lower:
        return "模型评测"
    # 默认: 文本生成
    return "文本生成"

def fetch_model_list():
    """从 /v1/models 端点自动拉取所有可用对话模型"""
    headers = {
        "Authorization": f"Bearer {API_TOKEN}",
        "Content-Type": "application/json"
    }
    try:
        response = requests.get(MODELS_URL, headers=headers, timeout=10)
        if response.status_code == 200:
            data = response.json()
            return [m["id"] for m in data.get("data", [])]
        else:
            print(f"⚠️ 拉取模型列表失败: HTTP {response.status_code}")
            return []
    except requests.exceptions.RequestException as e:
        print(f"⚠️ 拉取模型列表异常: {e}")
        return []

def group_models_by_vendor(model_ids):
    """按厂商前缀自动分组"""
    groups = {}
    for model_id in model_ids:
        vendor = model_id.split("/")[0] if "/" in model_id else "其他"
        display_name = VENDOR_NAMES.get(vendor, vendor)
        if display_name not in groups:
            groups[display_name] = []
        groups[display_name].append(model_id)
    return groups

def check_single_model(model, capability, headers):
    payload = {
        "model": model,
        "messages": [] if ZERO_COST_PROBE else [{"role": "user", "content": "hi"}],
        "max_tokens": 1
    }

    result = {
        "model": model,
        "capability": capability,
        "model_limit": "N/A",
        "model_remain": "N/A",
        "user_limit": "N/A",
        "user_remain": "N/A",
        "status_code": None,
        "remain_int": -1,
        "limit_int": float('inf'),
        "error": None
    }

    try:
        response = requests.post(CHAT_URL, headers=headers, json=payload, timeout=8)
        result["status_code"] = response.status_code
        resp_headers = response.headers

        result["model_limit"] = resp_headers.get("modelscope-ratelimit-model-requests-limit", "N/A")
        result["model_remain"] = resp_headers.get("modelscope-ratelimit-model-requests-remaining", "N/A")
        result["user_limit"] = resp_headers.get("modelscope-ratelimit-requests-limit", "N/A")
        result["user_remain"] = resp_headers.get("modelscope-ratelimit-requests-remaining", "N/A")

        result["remain_int"] = safe_int(result["model_remain"], -1)
        result["limit_int"] = safe_int(result["model_limit"], float('inf'))

        if response.status_code == 401:
            result["error"] = "Auth Error (Token无效或未实名)"
        elif response.status_code == 429:
            result["error"] = "Rate Limited (被限流)"
        elif result["remain_int"] == -1:
            result["error"] = f"HTTP {response.status_code} (未能获取配额)"

    except requests.exceptions.RequestException:
        result["error"] = "网络/超时异常"
        result["remain_int"] = -2

    return result

def fetch_and_sort_limits():
    headers = {
        "Authorization": f"Bearer {API_TOKEN}",
        "Content-Type": "application/json"
    }

    # 1. 自动拉取官方模型列表
    print("📋 正在拉取官方模型列表...")
    api_models = fetch_model_list()
    print(f"   官方列表共 {len(api_models)} 个模型")

    # 2. 合并: 官方模型 + 手动维护的生图模型 (去重)
    # 生图模型的手动标注优先; 对话模型的能力自动推断
    all_models = {}  # model_id -> capability
    for m in api_models:
        all_models[m] = infer_capability(m)
    for m, cap in IMAGE_MODELS.items():
        # 生图模型标注覆盖推断结果 (手动标注更准确)
        all_models[m] = cap
    print(f"   加上生图模型共 {len(all_models)} 个模型")

    # 3. 按厂商自动分组
    model_groups = group_models_by_vendor(list(all_models.keys()))

    print("\n🚀 正在并发查询各模型额度，请稍候...\n")

    results_map = {}

    with concurrent.futures.ThreadPoolExecutor(max_workers=10) as executor:
        futures = {
            executor.submit(check_single_model, model, all_models[model], headers): model
            for model in all_models
        }
        for future in concurrent.futures.as_completed(futures):
            res = future.result()
            results_map[res['model']] = res

    if any("Auth Error" in str(r.get("error")) for r in results_map.values()):
        print("🚫 严重错误: Token 无效或未实名，请检查你的 .env 文件配置。")
        return

    user_remain, user_limit = "N/A", "N/A"
    for r in results_map.values():
        if r['user_remain'] != "N/A":
            user_remain = r['user_remain']
            user_limit = r['user_limit']
            break

    print(f"📊 【账号总览】 剩余调用次数: {user_remain} / {user_limit}\n")

    # 列宽: 模型名称 | 能力 | 总限额 | 剩余
    col1, col2, col3, col4 = 40, 12, 10, 10
    divider = "-" * (col1 + col2 + col3 + col4 + 13)

    # 按厂商名排序输出
    for group_name in sorted(model_groups.keys()):
        models = model_groups[group_name]
        print(f"\n📁 {group_name}")
        print(divider)
        print(f"| {pad_string('模型名称', col1)} | {pad_string('能力', col2)} | {pad_string('总限额', col3)} | {pad_string('剩余', col4)} |")
        print(divider)

        group_results = [results_map[m] for m in models if m in results_map]
        group_results.sort(key=lambda x: (x['limit_int'], -x['remain_int']))

        for r in group_results:
            if r.get("error") and r['status_code'] != 429:
                err_msg = f"⚠️ {r['error']}"
                print(f"| {pad_string(r['model'], col1)} | {pad_string(r['capability'], col2)} | {pad_string(err_msg, col3 + col4 + 3)} |")
                continue

            model_name = r['model']
            if r['status_code'] == 429:
                model_name = "🔴 " + model_name

            print(f"| {pad_string(model_name, col1)} | {pad_string(r['capability'], col2)} | {pad_string(r['model_limit'], col3)} | {pad_string(r['model_remain'], col4)} |")

        print(divider)

if __name__ == "__main__":
    if not API_TOKEN:
        print("❌ 严重错误: 未找到 API Token！")
        print("💡 请确保你已经在代码同级目录下创建了 .env 文件，")
        print("   并填入了 MODELSCOPE_API_TOKEN=你的真实Token")
    else:
        fetch_and_sort_limits()

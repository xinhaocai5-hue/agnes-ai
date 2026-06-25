#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
批量测试魔搭模型可用性
"""

import os
import json
import requests
from dotenv import load_dotenv
from concurrent.futures import ThreadPoolExecutor, as_completed

load_dotenv()

TOKEN = os.getenv('MODELSCOPE_API_TOKEN')
if not TOKEN:
    print('错误: 请先在 .env 文件中配置 MODELSCOPE_API_TOKEN')
    exit(1)

BASE_URL = 'https://api-inference.modelscope.cn'
HEADERS = {
    'Authorization': f'Bearer {TOKEN}',
    'Content-Type': 'application/json'
}

# 零成本探测请求
ZERO_COST_PROBE = {
    'model': '',
    'messages': [],
    'max_tokens': 1
}

def test_model(model_id):
    """测试单个模型是否可用"""
    try:
        payload = {**ZERO_COST_PROBE, 'model': model_id}
        res = requests.post(
            f'{BASE_URL}/v1/chat/completions',
            headers=HEADERS,
            json=payload,
            timeout=10
        )
        
        if res.status_code == 200:
            return {'model': model_id, 'status': 'ok', 'message': '可用'}
        elif res.status_code == 429:
            return {'model': model_id, 'status': 'rate_limited', 'message': '被限流（但可用）'}
        elif res.status_code == 401:
            return {'model': model_id, 'status': 'auth_error', 'message': '密钥无效'}
        elif res.status_code == 403:
            return {'model': model_id, 'status': 'forbidden', 'message': '需要托管密钥或无权限'}
        elif res.status_code == 404:
            return {'model': model_id, 'status': 'not_found', 'message': '模型不存在'}
        else:
            data = res.json() if res.headers.get('content-type', '').startswith('application/json') else {}
            error_msg = data.get('error', {}).get('message', '') or data.get('message', '') or res.text[:100]
            if 'hosted' in error_msg.lower() or '托管' in error_msg:
                return {'model': model_id, 'status': 'hosted_key_required', 'message': '需要托管密钥'}
            return {'model': model_id, 'status': f'error_{res.status_code}', 'message': error_msg[:80]}
    except requests.exceptions.Timeout:
        return {'model': model_id, 'status': 'timeout', 'message': '请求超时'}
    except Exception as e:
        return {'model': model_id, 'status': 'exception', 'message': str(e)[:80]}

def get_model_list():
    """获取模型列表"""
    print('正在获取模型列表...')
    
    # 获取对话模型
    try:
        res = requests.get(f'{BASE_URL}/v1/models', headers=HEADERS, timeout=10)
        if res.status_code == 200:
            data = res.json()
            chat_models = [m['id'] for m in data.get('data', [])]
            print(f'  对话模型: {len(chat_models)} 个')
        else:
            print(f'  获取对话模型失败: {res.status_code}')
            chat_models = []
    except Exception as e:
        print(f'  获取对话模型失败: {e}')
        chat_models = []
    
    # 生图模型列表（手动维护）
    image_models = [
        'MusePublic/489_ckpt_FLUX_1',
        'black-forest-labs/FLUX.1-dev',
        'black-forest-labs/FLUX.1-schnell',
        'stabilityai/stable-diffusion-xl-base-1.0',
        'stabilityai/stable-diffusion-v1-5',
        'Qwen/Qwen-Image',
        'Qwen/Qwen-Image-2512',
        'Qwen/Qwen-Image-Edit-2511',
        'Tongyi-MAI/Z-Image',
        'Tongyi-MAI/Z-Image-Turbo',
        'Kwai-Kolors/Kolors',
        'Tencent/HunyuanImage-3.0',
        'Tencent/HunyuanImage-2.1',
        'black-forest-labs/FLUX.2-dev',
        'black-forest-labs/FLUX.2-klein-9B',
        'black-forest-labs/FLUX.2-klein-4B',
        'black-forest-labs/FLUX.2-klein-base-9B',
        'HiDream-ai/HiDream-O1-Image',
        'jdcloud/JoyAI-Image-Edit',
    ]
    print(f'  生图模型: {len(image_models)} 个')
    
    return chat_models + image_models

def main():
    models = get_model_list()
    total = len(models)
    print(f'\n开始测试 {total} 个模型的可用性...\n')
    
    results = []
    completed = 0
    
    with ThreadPoolExecutor(max_workers=10) as executor:
        futures = {executor.submit(test_model, model): model for model in models}
        for future in as_completed(futures):
            result = future.result()
            results.append(result)
            completed += 1
            status_icon = '✓' if result['status'] in ['ok', 'rate_limited'] else '✗'
            print(f'[{completed}/{total}] {status_icon} {result["model"]} - {result["message"]}')
    
    # 分类统计
    ok_models = [r for r in results if r['status'] in ['ok', 'rate_limited']]
    hosted_models = [r for r in results if r['status'] == 'hosted_key_required']
    forbidden_models = [r for r in results if r['status'] == 'forbidden']
    other_failures = [r for r in results if r['status'] not in ['ok', 'rate_limited', 'hosted_key_required', 'forbidden']]
    
    print('\n' + '=' * 60)
    print(f'测试完成: {len(ok_models)}/{total} 个模型可用')
    print('=' * 60)
    
    if hosted_models:
        print(f'\n需要托管密钥的模型 ({len(hosted_models)} 个):')
        for r in hosted_models:
            print(f'  - {r["model"]}')
    
    if forbidden_models:
        print(f'\n无权限的模型 ({len(forbidden_models)} 个):')
        for r in forbidden_models:
            print(f'  - {r["model"]}')
    
    if other_failures:
        print(f'\n其他问题的模型 ({len(other_failures)} 个):')
        for r in other_failures:
            print(f'  - {r["model"]} ({r["message"]})')
    
    # 保存结果到 JSON
    output = {
        'total': total,
        'available': len(ok_models),
        'unavailable': total - len(ok_models),
        'ok_models': [r['model'] for r in ok_models],
        'hosted_key_required': [r['model'] for r in hosted_models],
        'forbidden': [r['model'] for r in forbidden_models],
        'other_failures': [{'model': r['model'], 'reason': r['message']} for r in other_failures]
    }
    
    with open('model_test_results.json', 'w', encoding='utf-8') as f:
        json.dump(output, f, ensure_ascii=False, indent=2)
    
    print(f'\n详细结果已保存到 model_test_results.json')

if __name__ == '__main__':
    main()

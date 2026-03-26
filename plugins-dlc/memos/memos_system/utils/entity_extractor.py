# entity_extractor.py - 实体关系提取器
"""
使用 LLM 从文本中提取实体和关系
"""

import json
import logging
import asyncio
import aiohttp
from typing import List, Dict, Any, Optional, Tuple

# 使用 try-except 处理不同的导入方式
try:
    from ..models.entity import ExtractedEntity, EntityType
    from ..models.relation import ExtractedRelation, RelationType
except ImportError:
    # 当作为独立模块导入时
    from models.entity import ExtractedEntity, EntityType
    from models.relation import ExtractedRelation, RelationType

logger = logging.getLogger(__name__)


# 实体提取 Prompt
ENTITY_EXTRACTION_PROMPT = """你是一个实体关系提取专家。请从以下文本中提取实体和它们之间的关系。

文本：
{text}

请以 JSON 格式输出，包含两个数组：
1. entities: 实体列表，每个实体包含 name(名称), type(类型), description(简短描述)
2. relations: 关系列表，每个关系包含 source(源实体名), target(目标实体名), type(关系类型), description(描述)

实体类型可选值：person(人物), place(地点), object(物品), event(事件), concept(概念), preference(偏好), organization(组织), time(时间)

关系类型可选值：LIKES(喜欢), DISLIKES(不喜欢), KNOWS(认识), RELATED_TO(相关), PART_OF(属于), LOCATED_AT(位于), USES(使用), OWNS(拥有)

只输出 JSON，不要其他内容。如果没有找到实体或关系，输出空数组。

示例输出：
{{
  "entities": [
    {{"name": "张三", "type": "person", "description": "用户提到的人物"}},
    {{"name": "咖啡", "type": "preference", "description": "饮品偏好"}}
  ],
  "relations": [
    {{"source": "张三", "target": "咖啡", "type": "LIKES", "description": "张三喜欢喝咖啡"}}
  ]
}}
"""


class EntityExtractor:
    """实体关系提取器"""
    
    def __init__(
        self,
        llm_config: Optional[Dict[str, Any]] = None,
        fallback_config: Optional[Dict[str, Any]] = None
    ):
        """
        初始化提取器
        
        Args:
            llm_config: LLM 配置 {model, api_key, base_url}
            fallback_config: 备用 LLM 配置
        """
        self.llm_config = llm_config
        self.fallback_config = fallback_config
    
    async def extract(
        self,
        text: str,
        context: Optional[str] = None
    ) -> Tuple[List[ExtractedEntity], List[ExtractedRelation]]:
        """
        从文本中提取实体和关系
        
        Args:
            text: 输入文本
            context: 额外上下文
        
        Returns:
            (实体列表, 关系列表)
        """
        if not self.llm_config:
            logger.warning("LLM 配置不可用，无法提取实体")
            return [], []
        
        # 构建提示词
        full_text = text
        if context:
            full_text = f"上下文：{context}\n\n文本：{text}"
        
        prompt = ENTITY_EXTRACTION_PROMPT.format(text=full_text)
        
        # 调用 LLM
        response = await self._call_llm(prompt)
        
        if not response:
            return [], []
        
        # 解析结果
        return self._parse_response(response)
    
    async def _call_llm(self, prompt: str) -> Optional[str]:
        """调用 LLM API（带超时重试机制）"""
        configs = [self.llm_config]
        if self.fallback_config:
            configs.append(self.fallback_config)
        
        # 超时重试配置：先尝试 60 秒，失败后重试 120 秒
        timeouts = [60, 120]
        
        for config in configs:
            if not config:
                continue
            
            model_name = config.get('model', 'unknown')
            
            for attempt, timeout_seconds in enumerate(timeouts, 1):
                try:
                    logger.info(f"[实体提取] 尝试 {model_name} (第{attempt}次, 超时{timeout_seconds}s)")
                    
                    async with aiohttp.ClientSession() as session:
                        headers = {
                            "Authorization": f"Bearer {config.get('api_key', '')}",
                            "Content-Type": "application/json"
                        }
                        
                        payload = {
                            "model": model_name,
                            "messages": [
                                {"role": "user", "content": prompt}
                            ],
                            "temperature": 0.3,
                            "max_tokens": 1000
                        }
                        
                        async with session.post(
                            f"{config.get('base_url', '')}/chat/completions",
                            headers=headers,
                            json=payload,
                            timeout=aiohttp.ClientTimeout(total=timeout_seconds)
                        ) as resp:
                            if resp.status == 200:
                                data = await resp.json()
                                logger.info(f"[实体提取] {model_name} 调用成功")
                                return data['choices'][0]['message']['content']
                            else:
                                logger.warning(f"[实体提取] {model_name} 返回 {resp.status}")
                                
                except asyncio.TimeoutError:
                    logger.warning(f"[实体提取] {model_name} 超时 (第{attempt}次, {timeout_seconds}s)")
                    continue
                except Exception as e:
                    logger.error(f"[实体提取] {model_name} 调用失败: {e}")
                    continue
            
            logger.warning(f"[实体提取] {model_name} 所有重试均失败，切换到备用模型")
        
        logger.error("[实体提取] 所有模型均失败")
        return None
    
    def _parse_response(
        self,
        response: str
    ) -> Tuple[List[ExtractedEntity], List[ExtractedRelation]]:
        """解析 LLM 响应"""
        entities = []
        relations = []
        
        try:
            # 尝试提取 JSON
            response = response.strip()
            
            # 处理 markdown 代码块
            if response.startswith('```'):
                lines = response.split('\n')
                json_lines = []
                in_json = False
                for line in lines:
                    if line.startswith('```') and not in_json:
                        in_json = True
                        continue
                    elif line.startswith('```') and in_json:
                        break
                    elif in_json:
                        json_lines.append(line)
                response = '\n'.join(json_lines)
            
            # 尝试解析 JSON，如果失败则尝试修复
            data = None
            try:
                data = json.loads(response)
            except json.JSONDecodeError as e:
                logger.warning(f"JSON 解析失败，尝试修复: {e}")
                # 尝试修复截断的 JSON
                fixed_response = self._try_fix_json(response)
                if fixed_response:
                    try:
                        data = json.loads(fixed_response)
                        logger.info("JSON 修复成功")
                    except:
                        logger.error("JSON 修复失败")
            
            if not data:
                return entities, relations
            
            # 解析实体
            for entity_data in data.get('entities', []):
                try:
                    entity_type = self._map_entity_type(entity_data.get('type', 'custom'))
                    entities.append(ExtractedEntity(
                        name=entity_data.get('name', ''),
                        entity_type=entity_type,
                        description=entity_data.get('description'),
                        confidence=0.8
                    ))
                except Exception as e:
                    logger.warning(f"解析实体失败: {e}")
            
            # 解析关系
            for relation_data in data.get('relations', []):
                try:
                    relation_type = self._map_relation_type(relation_data.get('type', 'RELATED_TO'))
                    relations.append(ExtractedRelation(
                        source_name=relation_data.get('source', ''),
                        target_name=relation_data.get('target', ''),
                        relation_type=relation_type,
                        description=relation_data.get('description'),
                        confidence=0.8
                    ))
                except Exception as e:
                    logger.warning(f"解析关系失败: {e}")
                    
        except Exception as e:
            logger.error(f"解析响应失败: {e}")
        
        return entities, relations
    
    def _try_fix_json(self, json_str: str) -> Optional[str]:
        """尝试修复截断或不完整的 JSON"""
        import re
        
        # 移除末尾不完整的内容
        # 找到最后一个完整的 } 或 ]
        json_str = json_str.strip()
        
        # 尝试找到 entities 和 relations 数组
        # 如果 JSON 被截断，尝试补全
        
        # 方法1：尝试截断到最后一个完整的对象
        # 查找最后一个 }, 或 }] 的位置
        last_complete = -1
        brace_count = 0
        bracket_count = 0
        in_string = False
        escape_next = False
        
        for i, char in enumerate(json_str):
            if escape_next:
                escape_next = False
                continue
            if char == '\\':
                escape_next = True
                continue
            if char == '"' and not escape_next:
                in_string = not in_string
                continue
            if in_string:
                continue
            
            if char == '{':
                brace_count += 1
            elif char == '}':
                brace_count -= 1
                if brace_count >= 0:
                    last_complete = i
            elif char == '[':
                bracket_count += 1
            elif char == ']':
                bracket_count -= 1
        
        # 如果找到了最后一个完整的位置，截断并尝试补全
        if last_complete > 0:
            truncated = json_str[:last_complete + 1]
            
            # 计算需要补全的括号
            open_braces = truncated.count('{') - truncated.count('}')
            open_brackets = truncated.count('[') - truncated.count(']')
            
            # 补全括号
            fixed = truncated + ']' * open_brackets + '}' * open_braces
            
            return fixed
        
        # 方法2：尝试用正则提取已有的完整对象
        # 提取 entities 数组中已完整的对象
        entities_match = re.search(r'"entities"\s*:\s*\[(.*)', json_str, re.DOTALL)
        if entities_match:
            entities_content = entities_match.group(1)
            # 找所有完整的实体对象
            complete_entities = re.findall(
                r'\{\s*"name"\s*:\s*"[^"]*"\s*,\s*"type"\s*:\s*"[^"]*"\s*,\s*"description"\s*:\s*"[^"]*"\s*\}',
                entities_content
            )
            if complete_entities:
                # 构建修复后的 JSON
                return json.dumps({
                    "entities": [json.loads(e) for e in complete_entities],
                    "relations": []
                })
        
        return None
    
    def _map_entity_type(self, type_str: str) -> EntityType:
        """映射实体类型"""
        type_map = {
            'person': EntityType.PERSON,
            'place': EntityType.PLACE,
            'object': EntityType.OBJECT,
            'event': EntityType.EVENT,
            'concept': EntityType.CONCEPT,
            'preference': EntityType.PREFERENCE,
            'organization': EntityType.ORGANIZATION,
            'time': EntityType.TIME,
        }
        return type_map.get(type_str.lower(), EntityType.CUSTOM)
    
    def _map_relation_type(self, type_str: str) -> RelationType:
        """映射关系类型"""
        type_map = {
            'likes': RelationType.LIKES,
            'dislikes': RelationType.DISLIKES,
            'knows': RelationType.KNOWS,
            'related_to': RelationType.RELATED_TO,
            'part_of': RelationType.PART_OF,
            'located_at': RelationType.LOCATED_AT,
            'uses': RelationType.USES,
            'owns': RelationType.OWNS,
        }
        return type_map.get(type_str.lower(), RelationType.CUSTOM)


class PreferenceExtractor:
    """偏好提取器（专门用于提取用户偏好）"""
    
    PREFERENCE_PROMPT = """你是一个用户偏好分析专家。请从以下对话内容中提取用户的偏好信息。

对话内容：
{text}

请以 JSON 格式输出用户偏好，包含：
1. likes: 用户喜欢的事物列表，每项包含 item(事物), category(类别), confidence(置信度0-1)
2. dislikes: 用户不喜欢的事物列表，格式同上

类别可选：food(食物), drink(饮品), music(音乐), movie(电影), game(游戏), hobby(爱好), style(风格), other(其他)

只输出 JSON，不要其他内容。

示例输出：
{{
  "likes": [
    {{"item": "咖啡", "category": "drink", "confidence": 0.9}},
    {{"item": "摇滚乐", "category": "music", "confidence": 0.7}}
  ],
  "dislikes": [
    {{"item": "辣椒", "category": "food", "confidence": 0.8}}
  ]
}}
"""
    
    def __init__(self, llm_config: Optional[Dict[str, Any]] = None, fallback_config: Optional[Dict[str, Any]] = None):
        self.llm_config = llm_config
        self.fallback_config = fallback_config
    
    async def extract_preferences(
        self,
        text: str
    ) -> Dict[str, List[Dict[str, Any]]]:
        """
        提取偏好（带超时重试和备用模型）
        
        Args:
            text: 对话文本
        
        Returns:
            {likes: [...], dislikes: [...]}
        """
        if not self.llm_config:
            return {'likes': [], 'dislikes': []}
        
        prompt = self.PREFERENCE_PROMPT.format(text=text)
        
        # 构建模型列表
        configs = [self.llm_config]
        if self.fallback_config:
            configs.append(self.fallback_config)
        
        # 超时重试配置：先尝试 60 秒，失败后重试 120 秒
        timeouts = [60, 120]
        
        for config in configs:
            if not config:
                continue
            
            model_name = config.get('model', 'unknown')
            
            for attempt, timeout_seconds in enumerate(timeouts, 1):
                try:
                    logger.info(f"[偏好提取] 尝试 {model_name} (第{attempt}次, 超时{timeout_seconds}s)")
                    
                    async with aiohttp.ClientSession() as session:
                        headers = {
                            "Authorization": f"Bearer {config.get('api_key', '')}",
                            "Content-Type": "application/json"
                        }
                        
                        payload = {
                            "model": model_name,
                            "messages": [{"role": "user", "content": prompt}],
                            "temperature": 0.3
                        }
                        
                        async with session.post(
                            f"{config.get('base_url', '')}/chat/completions",
                            headers=headers,
                            json=payload,
                            timeout=aiohttp.ClientTimeout(total=timeout_seconds)
                        ) as resp:
                            if resp.status == 200:
                                data = await resp.json()
                                content = data['choices'][0]['message']['content']
                                logger.info(f"[偏好提取] {model_name} 调用成功")
                                return self._parse_preferences(content)
                            else:
                                logger.warning(f"[偏好提取] {model_name} 返回 {resp.status}")
                                
                except asyncio.TimeoutError:
                    logger.warning(f"[偏好提取] {model_name} 超时 (第{attempt}次, {timeout_seconds}s)")
                    continue
                except Exception as e:
                    logger.error(f"[偏好提取] {model_name} 调用失败: {e}")
                    continue
            
            logger.warning(f"[偏好提取] {model_name} 所有重试均失败，切换到备用模型")
        
        logger.error("[偏好提取] 所有模型均失败")
        return {'likes': [], 'dislikes': []}
    
    def _parse_preferences(self, response: str) -> Dict[str, List[Dict[str, Any]]]:
        """解析偏好响应"""
        try:
            response = response.strip()
            if response.startswith('```'):
                lines = response.split('\n')[1:-1]
                response = '\n'.join(lines)
            
            data = json.loads(response)
            return {
                'likes': data.get('likes', []),
                'dislikes': data.get('dislikes', [])
            }
        except:
            return {'likes': [], 'dislikes': []}

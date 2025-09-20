from transformers import AutoModelForCausalLM, AutoTokenizer
import torch
from peft import PeftModel
import sys
import os

# 添加项目根目录到路径，以便导入设备工具
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from device_utils import get_optimal_device, move_to_device, clear_device_cache

# 获取最优推理设备
DEVICE, DEVICE_TYPE = get_optimal_device()
print(f"LLM推理设备: {DEVICE} (类型: {DEVICE_TYPE})")

model_path = '模型本体路径'
lora_path = '训练后的lora权重路径'

# 加载tokenizer和模型
tokenizer = AutoTokenizer.from_pretrained(model_path)
model = AutoModelForCausalLM.from_pretrained(
    model_path, 
    device_map="auto" if DEVICE_TYPE == 'cuda' else None,  # DirectML 不支持 device_map="auto"
    torch_dtype=torch.bfloat16 if DEVICE_TYPE != 'cpu' else torch.float32
)

# 如果不是CUDA，手动移动模型到设备
if DEVICE_TYPE != 'cuda':
    model = move_to_device(model, DEVICE)

model = PeftModel.from_pretrained(model, lora_path)

# 自行选择适合自己的prompt
messages = [
    {"role": "system", "content": "你的名字叫做fake neuro,你是一个喜欢毒舌、傲娇的AI。你在回复时要表现得活泼可爱一些。"}
]

def chat(prompt):
    try:
        # 添加用户输入到对话历史
        messages.append({"role": "user", "content": prompt})
        
        # 使用对话模板格式化整个对话历史
        text = tokenizer.apply_chat_template(
            messages, 
            tokenize=False, 
            add_generation_prompt=True
        )
        
        # 生成回复
        model_inputs = tokenizer([text], return_tensors="pt")
        model_inputs = move_to_device(model_inputs, DEVICE)
        generated_ids = model.generate(
            model_inputs.input_ids,
            max_new_tokens=512,
            do_sample=True,
            top_p=0.9,
            temperature=0.7,
            repetition_penalty=1.2
        )
        
        # 仅保留新生成的token
        generated_ids = [
            output_ids[len(input_ids):] 
            for input_ids, output_ids in zip(model_inputs.input_ids, generated_ids)
        ]
        
        # 解码生成的文本
        response = tokenizer.batch_decode(
            generated_ids, 
            skip_special_tokens=True
        )[0]
        
        # 将AI的回复添加到对话历史
        messages.append({"role": "assistant", "content": response})
        return response
        
    finally:
        # 清理显存 - 支持多种设备类型
        if 'model_inputs' in locals():
            del model_inputs
        if 'generated_ids' in locals():
            del generated_ids
        clear_device_cache()

# 交互式对话循环
print("开始对话，输入 'quit' 结束对话")
while True:
    user_input = input("\n用户: ")
    if user_input.lower() == 'quit':
        print("对话结束")
        break
        
    response = chat(user_input)
    print("\nAI: " + response)

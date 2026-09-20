with open(r'C:\Users\MI\AppData\Roaming\Antigravity\agy_zhcn_ui_main.js', 'r', encoding='utf-8') as f:
    content = f.read()

# 搜索包含 "Exploring" 或 "Analyzed" 的位置
import re
matches = re.finditer(r'["\'](Exploring|Analyzed|Analyzing|reading|running|editing)[^"\']{0,60}["\']', content)
for m in matches:
    pos = m.start()
    print(f"Match at {pos}:", content[max(0, pos-50):min(len(content), pos+150)])
    print("-" * 50)

#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
微信聊天记录物品清单提取工具
处理格式：图片 + 文字描述，以位置标记（如 a1, b2）分隔
"""

import json
import csv
import re
from pathlib import Path
from typing import List, Dict
import base64

ROOT = Path(__file__).resolve().parents[2]
OUTPUT_DIR = ROOT / "artifacts" / "legacy" / "wechat-import"

# 位置规范化映射
LOCATION_MAP = {
    'a1': 'A1', 'a2': 'A2', 'a3': 'A3', 'a4': 'A4',
    'b1': 'B1', 'b2': 'B2', 'b3': 'B3', 'b4': 'B4',
    'c1': 'C1', 'c2': 'C2', 'c3': 'C3', 'c4': 'C4',
    'd1': 'D1', 'd2': 'D2', 'd3': 'D3', 'd4': 'D4',
    '地板': 'FLOOR', '门后': 'DOOR'
}

class WeChatInventoryProcessor:
    def __init__(self):
        self.items = []
        self.current_location = None
        self.item_counter = 1

    def normalize_location(self, text: str) -> str:
        """规范化位置标记"""
        text = text.lower().strip()
        return LOCATION_MAP.get(text, text.upper())

    def is_location_marker(self, text: str) -> bool:
        """判断是否为位置标记"""
        text = text.lower().strip()
        # 匹配 a1, b2, c3, d4 或 地板、门后
        pattern = r'^[abcd][1-4]$|^地板$|^门后$'
        return bool(re.match(pattern, text))

    def parse_manual_input(self, input_text: str):
        """
        手动输入模式：解析用户粘贴的微信消息
        格式示例：
        kt板
        [图片]
        彩色纸 5包
        [图片]
        a1
        剪刀
        [图片]
        b2
        """
        lines = [line.strip() for line in input_text.split('\n') if line.strip()]

        for line in lines:
            # 检查是否为位置标记
            if self.is_location_marker(line):
                self.current_location = self.normalize_location(line)
                print(f"📍 切换位置: {self.current_location}")
                continue

            # 跳过图片标记
            if line.startswith('[图片]') or line.startswith('[Image]'):
                continue

            # 其他内容视为物品描述
            if self.current_location:
                self.add_item(line, self.current_location)

    def add_item(self, description: str, location: str):
        """添加物品"""
        item_id = f"ITEM{self.item_counter:04d}"
        self.item_counter += 1

        # 简单解析数量（如果有）
        quantity_match = re.search(r'(\d+)\s*(个|把|张|包|盒|件)', description)
        quantity = quantity_match.group(1) if quantity_match else '若干'

        # 提取物品名称（去掉数量部分）
        item_name = re.sub(r'\s*\d+\s*(个|把|张|包|盒|件)\s*', '', description).strip()

        item = {
            '编号': item_id,
            '物品名称': item_name,
            '位置': location,
            '数量': quantity,
            '原始描述': description
        }

        self.items.append(item)
        print(f"✅ 添加: {item_id} | {item_name} | {location} | {quantity}")

    def export_csv(self, output_path: str | Path = 'inventory.csv'):
        """导出为 CSV"""
        if not self.items:
            print("⚠️  没有数据可导出")
            return

        with open(output_path, 'w', newline='', encoding='utf-8-sig') as f:
            fieldnames = ['编号', '物品名称', '位置', '数量', '原始描述']
            writer = csv.DictWriter(f, fieldnames=fieldnames)
            writer.writeheader()
            writer.writerows(self.items)

        print(f"📄 CSV已导出: {output_path}")

    def export_json(self, output_path: str | Path = 'inventory.json'):
        """导出为 JSON"""
        if not self.items:
            print("⚠️  没有数据可导出")
            return

        with open(output_path, 'w', encoding='utf-8') as f:
            json.dump(self.items, f, ensure_ascii=False, indent=2)

        print(f"📄 JSON已导出: {output_path}")

    def export_supabase_sql(self, output_path: str | Path = 'inventory_import.sql'):
        """生成 Supabase SQL 导入脚本"""
        if not self.items:
            print("⚠️  没有数据可导出")
            return

        sql_lines = [
            "-- Supabase 物品表导入脚本",
            "-- 先创建表（如果不存在）",
            "CREATE TABLE IF NOT EXISTS items (",
            "  id TEXT PRIMARY KEY,",
            "  name TEXT NOT NULL,",
            "  location TEXT NOT NULL,",
            "  quantity TEXT,",
            "  description TEXT,",
            "  image_url TEXT,",
            "  created_at TIMESTAMPTZ DEFAULT NOW()",
            ");",
            "",
            "-- 插入数据"
        ]

        for item in self.items:
            name = item['物品名称'].replace("'", "''")
            desc = item['原始描述'].replace("'", "''")
            sql = f"INSERT INTO items (id, name, location, quantity, description) VALUES ('{item['编号']}', '{name}', '{item['位置']}', '{item['数量']}', '{desc}');"
            sql_lines.append(sql)

        with open(output_path, 'w', encoding='utf-8') as f:
            f.write('\n'.join(sql_lines))

        print(f"📄 SQL脚本已导出: {output_path}")

    def print_statistics(self):
        """打印统计信息"""
        print("\n" + "="*50)
        print("📊 统计信息")
        print("="*50)
        print(f"总物品数: {len(self.items)}")

        # 按位置统计
        location_stats = {}
        for item in self.items:
            loc = item['位置']
            location_stats[loc] = location_stats.get(loc, 0) + 1

        print("\n各位置物品数量:")
        for loc in sorted(location_stats.keys()):
            print(f"  {loc}: {location_stats[loc]} 件")


def main():
    print("="*50)
    print("🏪 学部仓库物品清单提取工具")
    print("="*50)
    print("\n使用方法：")
    print("1. 从微信PC端复制聊天记录")
    print("2. 粘贴到下方（输入 END 结束）")
    print("3. 程序自动识别位置标记（a1, b2等）并提取物品")
    print("\n格式示例：")
    print("  kt板")
    print("  [图片]")
    print("  彩色纸 5包")
    print("  a1")
    print("  剪刀")
    print("  b2")
    print("\n" + "-"*50)
    print("开始输入（输入 END 结束）：\n")

    lines = []
    while True:
        try:
            line = input()
            if line.strip().upper() == 'END':
                break
            lines.append(line)
        except EOFError:
            break

    input_text = '\n'.join(lines)

    if not input_text.strip():
        print("⚠️  未输入任何内容")
        return

    # 处理数据
    processor = WeChatInventoryProcessor()
    processor.parse_manual_input(input_text)

    # 打印统计
    processor.print_statistics()

    # 导出文件
    print("\n正在导出文件...")
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    processor.export_csv(OUTPUT_DIR / 'inventory.csv')
    processor.export_json(OUTPUT_DIR / 'inventory.json')
    processor.export_supabase_sql(OUTPUT_DIR / 'inventory_import.sql')

    print("\n✅ 处理完成！")
    print(f"生成的文件位于：{OUTPUT_DIR}")
    print("  - inventory.csv (Excel可打开)")
    print("  - inventory.json (程序可读)")
    print("  - inventory_import.sql (历史结构，仅供离线审阅)")


if __name__ == '__main__':
    main()

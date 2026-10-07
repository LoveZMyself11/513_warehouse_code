#!/usr/bin/env python3
"""Rename inventory photos after visual review and emit a traceable manifest."""

import csv
import re
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
DATA_DIR = ROOT / "data"
MANIFEST = ROOT / "fixtures" / "inventory" / "inventory_image_manifest.csv"

# (WeChat sequence, item name, visual review status)
ITEMS = [
    (1, "镇部之宝纪念盒", "已确认"),
    (5, "卡通吉祥物头套", "已确认"),
    (7, "充气活动道具", "待确认具体类型"),
    (9, "宣传展板", "已确认"),
    (12, "素描纸", "已确认"),
    (14, "仿真花", "已确认"),
    (16, "袖章与袖套", "已确认"),
    (19, "篷布", "已确认"),
    (22, "折叠桌收纳包", "待确认是否含桌具"),
    (24, "鼓", "已确认"),
    (27, "学部Logo服装", "已确认"),
    (30, "学校Logo马甲", "已确认"),
    (32, "迎新工作证", "已确认"),
    (34, "篮球服", "已确认"),
    (36, "学部Polo衫", "已确认"),
    (38, "反光背心", "已确认"),
    (40, "消防马甲", "已确认"),
    (42, "绿色袋装服装", "待确认具体服装"),
    (44, "民族服装", "已确认"),
    (46, "草帽", "已确认"),
    (50, "小国旗", "已确认"),
    (51, "矿泉水", "已确认"),
    (53, "塑料盆", "已确认"),
    (55, "鼓收纳包", "已确认"),
    (57, "素质拓展球", "已确认"),
    (59, "素质拓展旗帜", "已确认"),
    (61, "素质拓展器材", "已确认"),
    (63, "荧光棒", "已确认"),
    (66, "啦啦队彩球", "已确认"),
    (68, "毛巾", "已确认"),
    (70, "爱心义卖箱", "已确认"),
    (72, "学士帽", "已确认"),
    (75, "花瓶", "已确认"),
    (77, "彩色编织篮", "已确认"),
    (79, "茶具", "已确认"),
    (81, "酒礼盒", "已确认"),
    (83, "风车", "已确认"),
    (85, "奖品笔记本套装", "已确认"),
    (87, "捏捏乐玩具", "已确认"),
    (89, "面具与手机支架", "已确认"),
    (91, "古装道具剑与折扇", "已确认"),
    (94, "手持标语牌", "已确认"),
    (96, "抽奖箱", "已确认"),
    (98, "羊角锤", "已确认"),
    (100, "钢丝钳", "已确认"),
    (102, "卷尺", "已确认"),
    (104, "铁丝", "已确认"),
    (106, "台式电脑主机", "已确认"),
    (108, "黑板", "已确认"),
    (110, "收录机", "已确认"),
    (112, "手提音箱", "已确认"),
    (114, "键盘", "已确认"),
    (118, "长尾票夹", "已确认"),
    (120, "活动手牌与塑料扇", "已确认"),
    (122, "超轻粘土", "已确认"),
    (124, "眼罩", "已确认"),
    (126, "防滑粉", "已确认"),
    (128, "乒乓球", "已确认"),
    (130, "红色罐装喷剂", "待确认具体用途"),
    (132, "书签", "已确认"),
    (134, "护具与手套", "已确认"),
    (136, "迷彩油彩", "已确认"),
    (138, "乒乓球拍", "已确认"),
    (140, "帆布鞋", "已确认"),
    (143, "学部Logo贴纸", "已确认"),
    (145, "气球与打气筒", "已确认"),
    (147, "直尺", "已确认"),
    (149, "尼龙扎带", "已确认"),
    (151, "透明塑料扎带", "待确认具体类型"),
    (153, "透明胶带", "已确认"),
    (155, "彩色笔", "已确认"),
    (157, "自喷漆", "已确认"),
    (159, "墨镜", "已确认"),
    (161, "党建工作室招新报名表", "已确认"),
    (163, "针线盒", "已确认"),
    (165, "聘书", "已确认"),
    (167, "双面泡棉胶带", "已确认"),
    (170, "木质展示架", "已确认"),
    (173, "落地宣传牌与配重", "区域总览"),
    (175, "竹竿", "已确认"),
    (177, "展架配重底座", "已确认"),
    (180, "展架支撑杆", "待确认具体展架"),
    (182, "宣传海报与展板", "已确认"),
    (184, "黑色卷筒物料", "待确认具体类型"),
    (187, "折叠平板车", "已确认"),
    (189, "塑料盆组", "已确认"),
    (191, "金属收纳篮", "已确认"),
    (193, "拾物夹", "已确认"),
    (195, "不锈钢伸缩杆", "已确认"),
    (197, "平板拖把", "已确认"),
    (199, "宣传横幅与展板", "区域总览"),
    (201, "展架圆形配重底座", "已确认"),
]


def location_for(path: Path) -> str:
    relative_parent = path.parent.relative_to(DATA_DIR)
    parts = relative_parent.parts
    if not parts:
        return "UNKNOWN"
    if len(parts) == 1 and parts[0] in {"A", "B", "C", "D"}:
        return f"{parts[0]}?"
    return parts[-1]


def find_originals() -> dict[int, Path]:
    originals: dict[int, Path] = {}
    pattern = re.compile(r"_(\d+)_3107\.jpg$", re.IGNORECASE)
    for path in DATA_DIR.rglob("*.jpg"):
        match = pattern.search(path.name)
        if not match:
            continue
        sequence = int(match.group(1))
        if sequence in originals:
            raise RuntimeError(f"Duplicate WeChat sequence {sequence}: {path}")
        originals[sequence] = path
    return originals


def main() -> None:
    originals = find_originals()
    expected = {sequence for sequence, _, _ in ITEMS}
    missing = sorted(expected - originals.keys())
    unexpected = sorted(originals.keys() - expected)
    if missing or unexpected:
        raise RuntimeError(f"Image set mismatch; missing={missing}, unexpected={unexpected}")

    rows = []
    planned_destinations: set[Path] = set()
    for index, (sequence, name, status) in enumerate(ITEMS, start=1):
        source = originals[sequence]
        item_id = f"ITEM{index:04d}"
        destination = source.with_name(f"{item_id}_{name}.jpg")
        if destination in planned_destinations or destination.exists():
            raise RuntimeError(f"Destination already exists: {destination}")
        planned_destinations.add(destination)
        rows.append(
            {
                "编号": item_id,
                "微信原序号": sequence,
                "位置": location_for(source),
                "物品名称": name,
                "视觉识别状态": status,
                "原始路径": str(source.relative_to(ROOT)),
                "新路径": str(destination.relative_to(ROOT)),
            }
        )

    for row in rows:
        (ROOT / row["原始路径"]).rename(ROOT / row["新路径"])

    with MANIFEST.open("w", newline="", encoding="utf-8-sig") as handle:
        writer = csv.DictWriter(handle, fieldnames=list(rows[0]))
        writer.writeheader()
        writer.writerows(rows)

    print(f"Renamed {len(rows)} images")
    print(f"Manifest: {MANIFEST}")


if __name__ == "__main__":
    main()

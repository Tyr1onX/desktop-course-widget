from __future__ import annotations

import json
from pathlib import Path
from typing import Any


def _weeks(start: int, end: int) -> list[int]:
    return list(range(start, end + 1))


GROUND_TRUTHS: dict[str, dict[str, Any]] = {
    "standard_10": {
        "schemaVersion": 1,
        "source": "synthetic:standard_10",
        "courses": [
            {
                "weekday": 1,
                "startSection": 1,
                "endSection": 2,
                "name": "通信原理",
                "teacher": "张老师",
                "location": "A101",
                "weeks": _weeks(1, 8),
                "parity": "all",
            },
            {
                "weekday": 3,
                "startSection": 3,
                "endSection": 4,
                "name": "信息论",
                "teacher": "李明",
                "location": "逸夫楼203",
                "weeks": _weeks(1, 15),
                "parity": "odd",
            },
            {
                "weekday": 5,
                "startSection": 5,
                "endSection": 6,
                "name": "数字信号处理",
                "teacher": "王老师",
                "location": "",
                "weeks": _weeks(1, 16),
                "parity": "even",
            },
            {
                "weekday": 2,
                "startSection": 7,
                "endSection": 8,
                "name": "计算机网络",
                "teacher": "赵老师",
                "location": "B204",
                "weeks": _weeks(1, 8) + _weeks(10, 16),
                "parity": "all",
            },
            {
                "weekday": 2,
                "startSection": 9,
                "endSection": 10,
                "name": "电磁场",
                "teacher": "陈老师",
                "location": "实验楼301",
                "weeks": _weeks(1, 12),
                "parity": "all",
            },
        ],
    },
    "tilted_12": {
        "schemaVersion": 1,
        "source": "synthetic:tilted_12",
        "courses": [
            {
                "weekday": 4,
                "startSection": 2,
                "endSection": 4,
                "name": "高频电子技术",
                "teacher": "刘老师",
                "location": "教学楼C302",
                "weeks": _weeks(1, 8),
                "parity": "all",
            },
            {
                "weekday": 6,
                "startSection": 6,
                "endSection": 8,
                "name": "单片机原理",
                "teacher": "周老师",
                "location": "逸夫楼405",
                "weeks": _weeks(1, 15),
                "parity": "odd",
            },
            {
                "weekday": 7,
                "startSection": 9,
                "endSection": 10,
                "name": "数字电路",
                "teacher": "孙老师",
                "location": "D101",
                "weeks": _weeks(2, 16),
                "parity": "even",
            },
            {
                "weekday": 1,
                "startSection": 11,
                "endSection": 12,
                "name": "通信与网络",
                "teacher": "吴老师",
                "location": "",
                "weeks": _weeks(1, 16),
                "parity": "all",
            },
        ],
    },
}


def ground_truth_for(name: str) -> dict[str, Any]:
    try:
        return GROUND_TRUTHS[name]
    except KeyError as error:
        raise ValueError(f"no ground truth is defined for synthetic scenario {name}") from error


def write_ground_truth(name: str, output_dir: str | Path) -> Path:
    output = Path(output_dir)
    output.mkdir(parents=True, exist_ok=True)
    path = output / f"{name}.ground-truth.json"
    path.write_text(
        json.dumps(ground_truth_for(name), ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    return path

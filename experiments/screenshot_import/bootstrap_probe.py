from __future__ import annotations

import json
import sys
from pathlib import Path


def main() -> int:
    package_root = Path(__file__).resolve().parents[2]
    print(
        json.dumps(
            {
                "ok": True,
                "isolated": bool(sys.flags.isolated),
                "packageRootName": package_root.name,
                "module": __name__,
            },
            ensure_ascii=False,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

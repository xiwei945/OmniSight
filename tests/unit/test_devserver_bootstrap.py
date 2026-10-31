"""开发服务器的两条"看得见数据"的保证（``tools/devserver.py``）。

这两条都不是功能，是**别人第一次打开这个页面时的第一印象**，而它们坏掉时长得都像
"这个项目没有数据"：

1. 裸地址（`http://127.0.0.1:6180/`，没有 `?token=`）要能看见仪表盘。外壳的
   `data-token` 只从查询串取（`web.py:shell`），所以开发服务器得自己把令牌补上。
2. 库要补到今天。合成数据是以"播种子那天"为终点的；隔两天再看，默认停在「今天」
   的那一屏就是一行都没有——和"没有数据"完全同形。

不启动服务器：这里只验判断与重定向，播种/装配那一半由 `tools/devserver.py` 自己跑。
"""

from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT / "tools") not in sys.path:
    sys.path.insert(0, str(ROOT / "tools"))

from flask import Flask  # noqa: E402

import devserver  # noqa: E402


def _client() -> "object":
    app = Flask(__name__)

    @app.get("/")
    def index():
        return "dash"

    @app.get("/settings")
    def settings_page():
        return "settings"

    @app.get("/api/v1/status")
    def status():
        return "status"

    devserver._with_dev_token(app)
    return app.test_client()


def test_bare_shell_url_gets_the_token():
    """裸地址 302 到带令牌的同一个地址，且目标里的令牌就是开发令牌。"""
    response = _client().get("/", follow_redirects=False)
    assert response.status_code == 302
    assert response.headers["Location"].endswith(f"/?token={devserver.DEV_TOKEN}")


def test_settings_page_also_bootstraps():
    response = _client().get("/settings", follow_redirects=False)
    assert response.status_code == 302
    assert "token=" in response.headers["Location"]


def test_url_that_already_has_a_token_is_left_alone():
    """已经有令牌就不要再跳：否则前端把地址栏抹干净后每次刷新都要多一跳。"""
    response = _client().get("/?token=whatever", follow_redirects=False)
    assert response.status_code == 200
    assert response.get_data(as_text=True) == "dash"


def test_api_is_not_redirected():
    """**只碰页面外壳**。给 API 补令牌等于把校验关掉一半，且 curl 会拿到一页 HTML。"""
    response = _client().get("/api/v1/status", follow_redirects=False)
    assert response.status_code == 200
    assert response.get_data(as_text=True) == "status"


def test_only_get_is_bootstrapped():
    client = _client()
    response = client.post("/", follow_redirects=False)
    assert response.status_code == 405  # 没有 POST 路由，也没被重定向吃掉

"""注册表自启项（10 文档 §5.3）。

这个文件盯的是 2026-10-31 实际踩到的那个"开机自启没生效"：

* **写出去的命令行必须自己找得到代码。** 开发模式原先写 ``-m omnisight``，而 ``Run``
  项由资源管理器在登录时拉起——工作目录是系统目录，仓库是 src 布局、包又没装进解释器
  的 ``site-packages``，于是它当场 ``No module named 'omnisight'``；pythonw 没有控制台，
  这一死完全静默。启动器自己把 ``src`` 塞进 ``sys.path``，这条路才与工作目录无关。
* **``is_enabled()`` 精确比对整条命令行**，而不是"键在就算开着"：程序换了位置之后
  谎报已启用，比功能缺失更糟（10 文档 §4）。

``winreg`` 是假的：``autostart`` 在函数里才导入它（模块级导入会让本文件在 macOS /
Linux 上 ImportError），往 ``sys.modules`` 里塞一个替身就能在三个平台上跑，也保证
这些用例**永远不碰真实注册表**。
"""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

from omnisight.adapters.windows import autostart

INSTALLED = r"C:\Program Files\OmniSight\OmniSight.exe"
PORTABLE = r"D:\Downloads\OmniSight\OmniSight.exe"

#: 假的仓库根。路径**不必存在**：这些用例换掉了 ``_dev_launcher``，测的是命令行怎么写。
#: 刻意带上空格（本仓库的真实路径就有），顺便把引号也测进去。
FAKE_REPO = Path(__file__).resolve().parent / "fake repo"


class _Key:
    """``winreg`` 的键句柄：包里包一层字典，支持 ``with``。"""

    def __init__(self, values: dict[str, str]) -> None:
        self.values = values

    def __enter__(self) -> _Key:
        return self

    def __exit__(self, *exc_info: object) -> bool:
        return False


class FakeWinreg:
    """只实现 ``autostart`` 用到的那几个函数，行为按真实 ``winreg`` 来。

    最要紧的一条是**缺键、缺值都抛 ``FileNotFoundError``**：真实 ``winreg`` 就是这么
    表现的，而 ``set_enabled(False)`` 对"本来就没有"的容忍、``is_enabled()`` 对"键不
    存在"的判断都建立在这上面。
    """

    HKEY_CURRENT_USER = "HKCU"
    HKEY_LOCAL_MACHINE = "HKLM"
    REG_SZ = 1
    KEY_SET_VALUE = 2

    def __init__(self) -> None:
        self.storage: dict[tuple[str, str], dict[str, str]] = {}

    # ── 测试用的直通车 ────────────────────────────────────────────────
    def seed(self, key: str, name: str, data: str, root: str = "HKCU") -> None:
        self.storage.setdefault((root, key), {})[name] = data

    def read(self, key: str, name: str, root: str = "HKCU") -> str | None:
        return self.storage.get((root, key), {}).get(name)

    # ── winreg 的那几个函数 ──────────────────────────────────────────
    def OpenKey(self, root: str, key: str, reserved: int = 0, access: int = 0) -> _Key:
        try:
            return _Key(self.storage[(root, key)])
        except KeyError:
            raise FileNotFoundError(f"没有键 {key}") from None

    def CreateKeyEx(self, root: str, key: str, reserved: int = 0, access: int = 0) -> _Key:
        return _Key(self.storage.setdefault((root, key), {}))

    def QueryValueEx(self, key: _Key, name: str) -> tuple[str, int]:
        try:
            return key.values[name], self.REG_SZ
        except KeyError:
            raise FileNotFoundError(f"没有值 {name}") from None

    def SetValueEx(self, key: _Key, name: str, reserved: int, kind: int, data: str) -> None:
        key.values[name] = data

    def DeleteValue(self, key: _Key, name: str) -> None:
        try:
            del key.values[name]
        except KeyError:
            raise FileNotFoundError(f"没有值 {name}") from None


@pytest.fixture
def registry(monkeypatch) -> FakeWinreg:
    fake = FakeWinreg()
    monkeypatch.setitem(sys.modules, "winreg", fake)
    return fake


def _control(command: str) -> autostart.RegistryAutostart:
    return autostart.RegistryAutostart(command=command)


# ── 命令行：自启项必须自己找得到代码 ────────────────────────────────────
def test_the_dev_command_runs_a_launcher_instead_of_dash_m(monkeypatch):
    """开发模式那条命令不能是 ``-m omnisight``：登录时它没有仓库当工作目录。

    ``-m`` 要求包在解释器的搜索路径上，而开发环境只装依赖、不装包。启动器自己搭
    ``sys.path``，所以这条自启项与"双击桌面那个快捷方式"等价。
    """
    launcher = FAKE_REPO / autostart.DEV_LAUNCHER_NAME
    monkeypatch.setattr(sys, "frozen", False, raising=False)
    monkeypatch.setattr(autostart, "_dev_launcher", lambda: launcher)

    command = autostart.startup_command()

    assert f'"{launcher}"' in command
    assert "-m omnisight" not in command
    assert command.endswith(f" {autostart.AUTOSTART_FLAG}")


def test_the_dev_command_carries_an_absolute_launcher_path(monkeypatch):
    """相对路径等于没写：``Run`` 项的工作目录不是仓库，登录时它指不到任何东西。"""
    launcher = FAKE_REPO / autostart.DEV_LAUNCHER_NAME
    monkeypatch.setattr(sys, "frozen", False, raising=False)
    monkeypatch.setattr(autostart, "_dev_launcher", lambda: launcher)

    assert str(launcher) in autostart.startup_command()
    assert launcher.is_absolute()


def test_a_pip_installed_tree_falls_back_to_dash_m(monkeypatch):
    """包已经装进解释器（``pip install -e .``）时不需要启动器，``-m`` 才是对的。"""
    monkeypatch.setattr(sys, "frozen", False, raising=False)
    monkeypatch.setattr(autostart, "_dev_launcher", lambda: None)

    assert "-m omnisight" in autostart.startup_command()


def test_the_frozen_command_is_just_the_exe(monkeypatch):
    monkeypatch.setattr(sys, "frozen", True, raising=False)
    monkeypatch.setattr(sys, "executable", INSTALLED)

    assert autostart.startup_command() == f'"{INSTALLED}" {autostart.AUTOSTART_FLAG}'


# ── 判定：键在 ≠ 开着 ──────────────────────────────────────────────────
def test_is_enabled_compares_the_whole_command_line(registry):
    """程序搬到别处之后自启项还指着旧路径：那是"没开"，不是"开着"。"""
    control = _control(f'"{PORTABLE}" {autostart.AUTOSTART_FLAG}')

    assert control.is_enabled() is False  # 键还不存在
    control.set_enabled(True)
    assert control.is_enabled() is True
    assert registry.read(autostart.RUN_KEY, autostart.VALUE_NAME) == control.command

    registry.seed(
        autostart.RUN_KEY, autostart.VALUE_NAME, f'"{INSTALLED}" {autostart.AUTOSTART_FLAG}'
    )
    assert control.is_enabled() is False
    assert control.is_present() is True  # 残留项在，重新打开会用 /F 覆盖它


def test_repair_rewrites_a_stale_entry(registry):
    """用户的意图是"要自启"，程序换了位置不该让这个意图丢失。"""
    control = _control(f'"{PORTABLE}" {autostart.AUTOSTART_FLAG}')
    registry.seed(autostart.RUN_KEY, autostart.VALUE_NAME, f'"{INSTALLED}" --autostart')

    assert control.repair_if_stale() is True
    assert control.is_enabled() is True
    assert registry.read(autostart.RUN_KEY, autostart.VALUE_NAME) == control.command


def test_repair_leaves_a_matching_entry_alone(registry):
    control = _control(f'"{PORTABLE}" {autostart.AUTOSTART_FLAG}')
    control.set_enabled(True)

    assert control.repair_if_stale() is False


def test_repair_does_not_create_an_entry_nobody_asked_for(registry):
    """自启项本来就不存在时，"修复"不许顺手把它打开。"""
    control = _control(f'"{PORTABLE}" {autostart.AUTOSTART_FLAG}')

    assert control.repair_if_stale() is False
    assert control.is_present() is False


def test_turning_off_an_absent_entry_is_a_no_op(registry):
    """用户要的状态已经达到了；真实 ``winreg`` 抛的 ``FileNotFoundError`` 不该冒出去。"""
    _control(f'"{PORTABLE}" {autostart.AUTOSTART_FLAG}').set_enabled(False)

    assert registry.read(autostart.RUN_KEY, autostart.VALUE_NAME) is None

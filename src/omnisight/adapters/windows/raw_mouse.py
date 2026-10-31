"""Raw Input 的鼠标纯 ctypes 层。

与 :mod:`raw_input`（键盘）是同一个已验证的形状：``RegisterRawInputDevices`` + 未显示的
顶层窗口 + 自带消息泵。**另起一个窗口而不是复用键盘那个**，理由有两条：

1. 失败隔离。鼠标设备注册失败（某些反作弊驱动只拦鼠标、某些远程会话没有鼠标设备）
   不该把键盘采集一起带下去，反之亦然——那是 10 文档 §6 的失败隔离原则。
2. ``raw_input.py`` 是"已经在 KeyTrace 上验证过、不重写"的代码（04 文档 §3.1）。
   往它里面塞第二个设备的解析只会让那份已验证的代码多一条未验证的分支。

代价是进程里多一个隐藏窗口与一条消息泵线程——两者都只有几十 KB，且与键盘那条互不
依赖。窗口仍然从不 ``ShowWindow``：它不该出现在任务栏与 Alt+Tab 里。

``RIDEV_INPUTSINK`` 同样关键：它让窗口在**没有焦点时**也能收到鼠标输入。没有它，
统计到的只会是本程序自己窗口上的点击（而 OmniSight 的窗口在浏览器里，与这里无关）。

**只解码按键位**。``lLastX`` / ``lLastY`` / 滚轮位一律不读——这一版统计的是点击次数，
光标坐标与移动距离不在采集范围内（隐私口径见 README）。
"""

from __future__ import annotations

import ctypes
import logging
import os
import threading
from collections.abc import Callable
from ctypes import wintypes
from typing import ClassVar

logger = logging.getLogger(__name__)

WM_INPUT = 0x00FF
WM_QUIT = 0x0012
WM_CLOSE = 0x0010
WM_DESTROY = 0x0002
WM_QUERYENDSESSION = 0x0011
WM_ENDSESSION = 0x0016
RID_INPUT = 0x10000003
RIM_TYPEMOUSE = 0
RIDEV_INPUTSINK = 0x00000100

#: ``usButtonFlags`` 里的按键位。低字节是"按下"，高字节是同名按键的"抬起"。
#: 本模块只上报**按下**（见 :mod:`..mouse`），但把抬起位也一并交给回调，让适配器
#: 能数出"抬起多于按下"这类后端异常。
RI_MOUSE_LEFT_BUTTON_DOWN = 0x0001
RI_MOUSE_LEFT_BUTTON_UP = 0x0002
RI_MOUSE_RIGHT_BUTTON_DOWN = 0x0004
RI_MOUSE_RIGHT_BUTTON_UP = 0x0008
RI_MOUSE_MIDDLE_BUTTON_DOWN = 0x0010
RI_MOUSE_MIDDLE_BUTTON_UP = 0x0020
RI_MOUSE_BUTTON_4_DOWN = 0x0040
RI_MOUSE_BUTTON_4_UP = 0x0080
RI_MOUSE_BUTTON_5_DOWN = 0x0100
RI_MOUSE_BUTTON_5_UP = 0x0200
#: 滚轮位。**刻意不处理**：它们会出现在同一条 ``WM_INPUT`` 里，若不显式识别就会被
#: 当成"未知按位"记进 ``unmapped_events``，让那个诊断数字失去意义。
RI_MOUSE_WHEEL = 0x0400
RI_MOUSE_HWHEEL = 0x0800

#: ``(usButtonFlags, is_down)``——回调拿到的是一条原始事件里的一个按键位。
MouseCallback = Callable[[int, bool], None]

ULONG_PTR = wintypes.WPARAM
LRESULT = wintypes.LPARAM
WNDPROC = ctypes.WINFUNCTYPE(
    LRESULT, wintypes.HWND, wintypes.UINT, wintypes.WPARAM, wintypes.LPARAM
)


class RAWINPUTDEVICE(ctypes.Structure):
    _fields_: ClassVar = [
        ("usUsagePage", wintypes.USHORT),
        ("usUsage", wintypes.USHORT),
        ("dwFlags", wintypes.DWORD),
        ("hwndTarget", wintypes.HWND),
    ]


class RAWINPUTHEADER(ctypes.Structure):
    _fields_: ClassVar = [
        ("dwType", wintypes.DWORD),
        ("dwSize", wintypes.DWORD),
        ("hDevice", wintypes.HANDLE),
        ("wParam", ULONG_PTR),
    ]


class _BUTTON_STATE(ctypes.Structure):
    """C 里 ``RAWMOUSE`` 那个匿名联合的第二个成员。"""

    _fields_: ClassVar = [
        ("usButtonFlags", wintypes.USHORT),
        ("usButtonData", wintypes.USHORT),
    ]


class _BUTTONS(ctypes.Union):
    """``ulButtons`` 与 ``{usButtonFlags, usButtonData}`` 共用四个字节。

    **必须用联合体读**：直接读 ``ulButtons`` 再移位在 64 位下也能得到同样的低字，
    但那把"哪个字段是按键位"这件事埋进了一个魔数；联合体让结构体与 SDL 头文件里
    写的一致，日后补滚轮解析时不会有人再猜一次。
    """

    _fields_: ClassVar = [
        ("ulButtons", wintypes.ULONG),
        ("state", _BUTTON_STATE),
    ]


class RAWMOUSE(ctypes.Structure):
    _fields_: ClassVar = [
        ("usFlags", wintypes.USHORT),
        ("buttons", _BUTTONS),
        ("ulRawButtons", wintypes.ULONG),
        ("lLastX", wintypes.LONG),
        ("lLastY", wintypes.LONG),
        ("ulExtraInformation", wintypes.ULONG),
    ]


class RAWINPUT(ctypes.Structure):
    """只看鼠标那一支。缓冲区按 ``GetRawInputData`` 给的真实尺寸分配，因此这里
    不需要复刻键盘那 16 字节的联合——``RAWMOUSE`` 比 ``RAWKEYBOARD`` 大，读取不会越界。
    """

    _fields_: ClassVar = [("header", RAWINPUTHEADER), ("mouse", RAWMOUSE)]


class WNDCLASSW(ctypes.Structure):
    _fields_: ClassVar = [
        ("style", wintypes.UINT),
        ("lpfnWndProc", WNDPROC),
        ("cbClsExtra", ctypes.c_int),
        ("cbWndExtra", ctypes.c_int),
        ("hInstance", wintypes.HINSTANCE),
        ("hIcon", wintypes.HICON),
        ("hCursor", wintypes.HANDLE),
        ("hbrBackground", wintypes.HBRUSH),
        ("lpszMenuName", wintypes.LPCWSTR),
        ("lpszClassName", wintypes.LPCWSTR),
    ]


def _configure_win32() -> tuple[ctypes.WinDLL, ctypes.WinDLL]:
    """写好这一批函数原型，并把配置好的对象交回调用方。

    与 :func:`raw_input._configure_win32` 同样的理由：``ctypes.windll.user32`` 的缓存
    不是原子的，两个线程各拿一个 WinDLL 时原型只写在其中一个身上。这里用私有实例，
    与那个模块互不共享，也不与它争同一个缓存槽。
    """
    user32 = ctypes.WinDLL("user32")
    kernel32 = ctypes.WinDLL("kernel32")
    kernel32.GetModuleHandleW.argtypes = [wintypes.LPCWSTR]
    kernel32.GetModuleHandleW.restype = wintypes.HMODULE
    kernel32.GetCurrentThreadId.argtypes = []
    kernel32.GetCurrentThreadId.restype = wintypes.DWORD
    user32.RegisterClassW.argtypes = [ctypes.POINTER(WNDCLASSW)]
    user32.RegisterClassW.restype = wintypes.ATOM
    user32.CreateWindowExW.argtypes = [
        wintypes.DWORD, wintypes.LPCWSTR, wintypes.LPCWSTR, wintypes.DWORD,
        ctypes.c_int, ctypes.c_int, ctypes.c_int, ctypes.c_int,
        wintypes.HWND, wintypes.HANDLE, wintypes.HINSTANCE, wintypes.LPVOID,
    ]
    user32.CreateWindowExW.restype = wintypes.HWND
    user32.DefWindowProcW.argtypes = [
        wintypes.HWND, wintypes.UINT, wintypes.WPARAM, wintypes.LPARAM
    ]
    user32.DefWindowProcW.restype = LRESULT
    user32.RegisterRawInputDevices.argtypes = [
        ctypes.POINTER(RAWINPUTDEVICE), wintypes.UINT, wintypes.UINT
    ]
    user32.RegisterRawInputDevices.restype = wintypes.BOOL
    user32.GetRawInputData.argtypes = [
        wintypes.HANDLE, wintypes.UINT, wintypes.LPVOID,
        ctypes.POINTER(wintypes.UINT), wintypes.UINT,
    ]
    user32.GetRawInputData.restype = wintypes.UINT
    user32.GetMessageW.argtypes = [
        ctypes.POINTER(wintypes.MSG), wintypes.HWND, wintypes.UINT, wintypes.UINT
    ]
    user32.GetMessageW.restype = wintypes.BOOL
    user32.TranslateMessage.argtypes = [ctypes.POINTER(wintypes.MSG)]
    user32.DispatchMessageW.argtypes = [ctypes.POINTER(wintypes.MSG)]
    user32.DispatchMessageW.restype = LRESULT
    user32.PostThreadMessageW.argtypes = [
        wintypes.DWORD, wintypes.UINT, wintypes.WPARAM, wintypes.LPARAM
    ]
    user32.PostThreadMessageW.restype = wintypes.BOOL
    user32.DestroyWindow.argtypes = [wintypes.HWND]
    user32.UnregisterClassW.argtypes = [wintypes.LPCWSTR, wintypes.HINSTANCE]
    return user32, kernel32


def _release_window(
    user32: object,
    hwnd: int | None,
    atom: int,
    class_name: str,
    instance: int | None,
) -> None:
    """收掉消息窗口与窗口类。**尽力而为：一律不抛**（理由见 raw_input 里同名函数）。"""
    try:
        if hwnd:
            user32.DestroyWindow(wintypes.HWND(hwnd))
        if atom and instance:
            user32.UnregisterClassW(
                ctypes.c_wchar_p(class_name), wintypes.HINSTANCE(instance)
            )
    except Exception:  # 收尾阶段的失败没有后果，更不该变成一份崩溃报告
        logger.debug("Raw Input 鼠标窗口清理未完成（进程可能正在退出）", exc_info=True)


#: 按位与按下/抬起。顺序固定，便于测试断言。
_BUTTON_BITS: tuple[tuple[int, bool], ...] = (
    (RI_MOUSE_LEFT_BUTTON_DOWN, True),
    (RI_MOUSE_LEFT_BUTTON_UP, False),
    (RI_MOUSE_RIGHT_BUTTON_DOWN, True),
    (RI_MOUSE_RIGHT_BUTTON_UP, False),
    (RI_MOUSE_MIDDLE_BUTTON_DOWN, True),
    (RI_MOUSE_MIDDLE_BUTTON_UP, False),
    (RI_MOUSE_BUTTON_4_DOWN, True),
    (RI_MOUSE_BUTTON_4_UP, False),
    (RI_MOUSE_BUTTON_5_DOWN, True),
    (RI_MOUSE_BUTTON_5_UP, False),
)

#: 全部按键位。用来把滚轮位、移动位与"认不出的按键"分开。
_BUTTON_MASK = 0
for _bit, _pressed in _BUTTON_BITS:
    _BUTTON_MASK |= _bit


class RawInputMouseListener:
    """接收鼠标 Raw Input，含后台与全屏独占程序内的点击。"""
    def __init__(
        self, callback: MouseCallback, *, on_session_end: Callable[[], None] | None = None
    ) -> None:
        self.callback = callback
        self.on_session_end = on_session_end
        self._thread: threading.Thread | None = None
        self._thread_id = 0
        self._ready = threading.Event()
        self._error: BaseException | None = None
        self._wnd_proc: WNDPROC | None = None
        self._user32: ctypes.WinDLL | None = None
        #: 收到过但一个已知按键位都没认出来的 ``WM_INPUT`` 数（滚轮单独排除）。
        self.unmapped_events = 0

    @property
    def running(self) -> bool:
        return bool(
            self._thread and self._thread.is_alive() and self._ready.is_set() and not self._error
        )

    def start(self) -> None:
        if os.name != "nt":  # pragma: no cover - 由能力探测保证不会走到
            raise RuntimeError("Raw Input 仅支持 Windows")
        if self.running:
            return
        self._ready.clear()
        self._error = None
        self._thread = threading.Thread(
            target=self._run, name="omnisight-raw-mouse", daemon=True
        )
        self._thread.start()
        if not self._ready.wait(timeout=3):
            raise RuntimeError("Raw Input 鼠标监听器启动超时")
        if self._error:
            raise RuntimeError(f"Raw Input 鼠标监听器启动失败：{self._error}") from self._error

    def stop(self) -> None:
        user32 = self._user32
        if os.name == "nt" and self._thread_id and user32 is not None:
            user32.PostThreadMessageW(self._thread_id, WM_QUIT, 0, 0)
        if self._thread and self._thread is not threading.current_thread():
            self._thread.join(timeout=3)
            self._thread = None
        self._thread_id = 0
        self._ready.clear()

    def _run(self) -> None:
        user32, kernel32 = _configure_win32()
        self._user32 = user32
        self._thread_id = kernel32.GetCurrentThreadId()
        class_name = f"OmniSightRawMouse_{os.getpid()}_{self._thread_id}"
        hwnd = None
        atom = 0
        instance = None
        try:
            self._wnd_proc = WNDPROC(self._window_proc)
            instance = kernel32.GetModuleHandleW(None)
            window_class = WNDCLASSW()
            window_class.lpfnWndProc = self._wnd_proc
            window_class.hInstance = instance
            window_class.lpszClassName = class_name
            atom = user32.RegisterClassW(ctypes.byref(window_class))
            if not atom:
                raise ctypes.WinError()
            hwnd = user32.CreateWindowExW(
                0, class_name, "OmniSight", 0, 0, 0, 0, 0, None, None, instance, None
            )
            if not hwnd:
                raise ctypes.WinError()
            # usage page 0x01（通用桌面）/ usage 0x02（鼠标）。
            device = RAWINPUTDEVICE(0x01, 0x02, RIDEV_INPUTSINK, hwnd)
            if not user32.RegisterRawInputDevices(
                ctypes.byref(device), 1, ctypes.sizeof(device)
            ):
                raise ctypes.WinError()
            self._ready.set()
            message = wintypes.MSG()
            while user32.GetMessageW(ctypes.byref(message), None, 0, 0) > 0:
                user32.TranslateMessage(ctypes.byref(message))
                user32.DispatchMessageW(ctypes.byref(message))
        except BaseException as exc:
            self._error = exc
            self._ready.set()
        finally:
            _release_window(user32, hwnd, atom, class_name, instance)

    def _window_proc(self, hwnd, message, w_param, l_param):
        if message == WM_INPUT:
            self._read_mouse(l_param)
            return 0
        if message == WM_QUERYENDSESSION:
            return 1
        if message == WM_ENDSESSION:
            if w_param and self.on_session_end is not None:
                logger.info("鼠标采集收到 WM_ENDSESSION，开始停机")
                try:
                    self.on_session_end()
                except Exception:
                    logger.exception("关机回调失败")
            return 0
        user32 = self._user32
        if message in (WM_CLOSE, WM_DESTROY):
            user32.PostQuitMessage(0)
            return 0
        return user32.DefWindowProcW(hwnd, message, w_param, l_param)

    def _read_mouse(self, raw_handle: int) -> None:
        size = wintypes.UINT(0)
        header_size = ctypes.sizeof(RAWINPUTHEADER)
        user32 = self._user32
        if (
            user32.GetRawInputData(raw_handle, RID_INPUT, None, ctypes.byref(size), header_size)
            == 0xFFFFFFFF
        ):
            return
        buffer = ctypes.create_string_buffer(size.value)
        if (
            user32.GetRawInputData(raw_handle, RID_INPUT, buffer, ctypes.byref(size), header_size)
            == 0xFFFFFFFF
        ):
            return
        raw = ctypes.cast(buffer, ctypes.POINTER(RAWINPUT)).contents
        if raw.header.dwType != RIM_TYPEMOUSE:
            return
        flags = int(raw.mouse.buttons.state.usButtonFlags)
        buttons = flags & _BUTTON_MASK
        if not buttons:
            # 纯滚轮（或纯移动）不需要上报，也不该被算成"认不出的按键"——那会让
            # unmapped_events 这个诊断数字变成"滚轮滚了多少格"。
            if not flags & (RI_MOUSE_WHEEL | RI_MOUSE_HWHEEL):
                self.unmapped_events += 1
            return
        # **一条 WM_INPUT 里可能同时有几个按键位**（左右键几乎同时按下时合并上报），
        # 因此按位逐个回调，而不是假设"一条消息一个按钮"。
        for bit, pressed in _BUTTON_BITS:
            if buttons & bit:
                self.callback(bit, pressed)


__all__ = [
    "RAWINPUT",
    "RAWINPUTDEVICE",
    "RAWINPUTHEADER",
    "RAWMOUSE",
    "RI_MOUSE_BUTTON_4_DOWN",
    "RI_MOUSE_BUTTON_4_UP",
    "RI_MOUSE_BUTTON_5_DOWN",
    "RI_MOUSE_BUTTON_5_UP",
    "RI_MOUSE_LEFT_BUTTON_DOWN",
    "RI_MOUSE_LEFT_BUTTON_UP",
    "RI_MOUSE_MIDDLE_BUTTON_DOWN",
    "RI_MOUSE_MIDDLE_BUTTON_UP",
    "RI_MOUSE_RIGHT_BUTTON_DOWN",
    "RI_MOUSE_RIGHT_BUTTON_UP",
    "RawInputMouseListener",
]

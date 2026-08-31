#!/usr/bin/env python3
"""
PTY 代理：为 Obsidian Folder Terminal 插件提供真实伪终端。

用法：
    python3 -u -c <本文件内容> <shell>

通道约定：
    fd 0  stdin  -> 写入 pty（键盘输入）
    fd 1  stdout <- pty 输出（终端渲染）
    fd 2  stderr（错误信息）
    fd 3  控制通道，接收 "rows cols\\n" 行，调用 TIOCSWINSZ 调整 pty 尺寸
         （因此 vim / ssh 等全屏程序也能正确感知窗口变化）

为什么不用 `script` 命令？
    macOS 上 Node/Electron 的 child_process 管道是 socketpair（libuv 行为），
    而 BSD script 会对 stdin 做 tcgetattr，遇 socket 返回 EOPNOTSUPP 直接退出。
    本代理只做字节搬运，对 stdio 类型无要求。
"""
import fcntl
import os
import pty
import select
import struct
import sys
import termios


def main() -> int:
    shell = sys.argv[1] if len(sys.argv) > 1 else "/bin/zsh"
    pid, fd = pty.fork()
    if pid == 0:  # 子进程：成为会话组长，ptty 作为控制终端
        os.environ["TERM"] = "xterm-256color"
        try:
            os.execvp(shell, [shell])
        except OSError:
            os.write(2, f"[Folder Terminal] 无法启动 shell: {shell}\n".encode())
            os._exit(127)

    # 父进程：fd <-> stdio 双向搬运 + 控制通道调整尺寸
    def resize(rows: int, cols: int) -> None:
        try:
            fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack("HHHH", rows, cols, 0, 0))
        except OSError:
            pass

    buf = b""
    try:
        while True:
            r, _, _ = select.select([fd, 0, 3], [], [])
            for s in r:
                if s == fd:
                    data = os.read(fd, 65536)
                    if not data:
                        raise EOFError
                    os.write(1, data)
                elif s == 0:
                    data = os.read(0, 65536)
                    if not data:
                        raise EOFError
                    os.write(fd, data)
                else:  # fd 3 控制通道
                    data = os.read(3, 4096)
                    if not data:
                        raise EOFError
                    buf += data
                    while b"\n" in buf:
                        line, buf = buf.split(b"\n", 1)
                        parts = line.split()
                        if len(parts) == 2:
                            try:
                                resize(int(parts[0]), int(parts[1]))
                            except ValueError:
                                pass
    except (EOFError, OSError):
        pass

    try:
        os.waitpid(pid, 0)
    except Exception:
        pass
    return 0


if __name__ == "__main__":
    sys.exit(main())

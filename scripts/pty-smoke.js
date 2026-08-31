#!/usr/bin/env node
/**
 * PTY 冒烟测试：验证「python3 PTY 代理」链路（与插件内 spawnShell 完全一致：
 * node spawn + 4 个管道 stdio）能在本机创建真实伪终端并执行命令。
 *
 * 运行：npm run smoke:pty
 */
const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");

const proxyCode = fs.readFileSync(path.join(__dirname, "..", "src", "pty-proxy.py"), "utf8");
const shell = process.env.SHELL || "/bin/zsh";

const p = spawn("python3", ["-u", "-c", proxyCode, shell], {
	env: { ...process.env, TERM: "xterm-256color" },
	cwd: process.env.HOME,
	stdio: ["pipe", "pipe", "pipe", "pipe"],
});

let out = "";
p.stdout.on("data", (d) => {
	out += d.toString();
	process.stdout.write(d);
});
p.stderr.on("data", (d) => process.stdout.write(d));
p.on("exit", (code) => {
	const ok = out.includes("HELLO_FROM_PTY");
	console.log(`\n[smoke] shell=${shell} exit=${code} pty_works=${ok}`);
	process.exit(ok && code === 0 ? 0 : 1);
});

// 测试尺寸控制通道（fd 3）：下发 40x120 后执行 stty size 应回显 "40 120"
p.stdio[3].write("40 120\n");

setTimeout(() => {
	p.stdin.write("stty size; echo HELLO_FROM_PTY\n");
	setTimeout(() => p.stdin.write("exit\n"), 400);
}, 900);

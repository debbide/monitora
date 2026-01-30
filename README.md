# CloudEye 监控面板 (Uptime Monitor)

[![Docker Build](https://github.com/debbide/monitora/actions/workflows/docker-build.yml/badge.svg)](https://github.com/debbide/monitora/actions/workflows/docker-build.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

**CloudEye** 是一个现代化、轻量级且功能强大的服务器监控面板。
它不仅仅是一个 uptime 监控工具，更集成了 **主动探针 (Active Probe)**、**随机调度**、**Komari 面板集成** 和 **Telegram 深度控制** 等高级功能。

非常适合用于：
*   监控网站、API 接口、TCP 端口连通性。
*   **GitHub Actions 保活**：利用随机长周期调度，定期触发 Workflow。
*   **Komari 探针监控**：聚合多台服务器状态，离线自动报警。
*   **Telegram 消息监听**：监控那些为了隐私而不开放端口的服务。

---

## ✨ 核心特性

### 1. 多样化的监控类型
*   **🌐 HTTP/HTTPS**：支持自定义 Method (GET/POST/..)、Headers、Body。
    *   **深度验证**：验证状态码 (200-204)、包含/排除关键词。
*   **🔌 TCP Ping**：检测端口连通性。
*   **📊 Komari 面板**：对接 Komari 面板 API，监控旗下所有服务器在线状态。
*   **🚀 Scheduled Webhook (主动探针)**：
    *   定期向目标发送请求（可带鉴权）。
    *   **用途**：触发 CI/CD 构建、服务器无服务器函数 (Serverless) 唤醒、GitHub Actions 保活。
*   **📱 Telegram 监听**：不主动发请求，而是监听指定 TG 群组的消息，根据关键词（"Server Offline"）被动判断服务状态。

### 2. 智能调度系统 (从 v1.2 新增)
*   **固定周期**：传统的 cron 模式，每 5 分钟/1 小时执行一次。
*   **🎲 随机区间 (Random Interval)**：
    *   设置 `Min - Max` 范围（如 10天 ~ 12天）。
    *   系统每次执行完，会在该范围内随机生成**下一次**执行时间点。
    *   **模拟真实**：避免由于固定的定时请求被防火墙识别为机器行为。
*   **💾 持久化调度**：
    *   所有“下次执行时间”均写入 SQLite 数据库。
    *   **无惧重启**：服务重启、升级、崩溃后，任务倒计时**不会丢失**，不会重置。

### 3. 告警与通知
*   **🤖 Telegram Bot**：
    *   **全局配置**：一次配置 Bot Token，所有任务通用。
    *   **Komari 专属**：专门的群组接收服务器离线/恢复通知。
    *   **丰富的交互**：告警消息带“立即重试”按钮。
*   **🔗 Webhook**：支持 Discord, Slack, DingTalk 等标准 Webhook。
*   **📡 实时推送**：内置 SSE (Server-Sent Events) 服务，可配合浏览器插件实现图标红点报警。

### 4. 易用性与部署
*   **Docker 一键部署**：多架构支持 (AMD64/ARM64)。
*   **SQLite 存储**：无需配置外部数据库，数据文件单文件迁移。
*   **可视化图表**：响应时间趋势图、国家/地区旗帜显示 (Komari)。

---

## 🚀 快速部署 (Docker Compose)

1. 创建 `docker-compose.yml`：

```yaml
version: '3.8'

services:
  uptime-monitor:
    image: ghcr.io/debbide/monitora:latest
    container_name: uptime-monitor
    restart: unless-stopped
    ports:
      - "3000:3000"
    volumes:
      - ./data:/app/data
    environment:
      - TZ=Asia/Shanghai
```

2. 启动服务：

```bash
docker-compose up -d
```

3. 访问面板：
   *   URL: `http://localhost:3000`
   *   默认密码: `admin123` (登录后请务必修改)

---

## 📖 详细使用指南

### 1. 配置 GitHub Actions 保活 (随机长周期)

这是本面板的一个特色场景。如果你需要每隔 10~15 天给 GitHub 仓库发个信号防止 Workflow 暂停：

1.  **添加监控** -> 选择类型 **Scheduled Webhook**。
2.  **调度模式**：选择 **随机区间**，填入 `10` - `12`，单位选择 **Days**。
3.  **Request Configuration**：
    *   URL: `https://api.github.com/repos/YOUR_USER/YOUR_REPO/dispatches`
    *   Method: `POST`
    *   Headers:
        ```json
        {
          "Authorization": "Bearer YOUR_GITHUB_TOKEN",
          "Accept": "application/vnd.github+json"
        }
        ```
    *   Body: `{"event_type": "keep-alive"}`
4.  **保存**。
    *   系统会立即执行一次以验证配置。
    *   成功后，它会生成一个 10~12 天后的随机时间点。
    *   这就是你的“保活”助手，完全自动化且具有随机性。

### 2. 对接 Komari 探针

如果你有自建的探针面板，想把报警统一收敛：

1.  **添加监控** -> 选择类型 **Komari**。
2.  **URL**：填写探针数据的 API 地址（返回 JSON 格式）。
3.  **离线阈值**：设置 `3` 分钟（如果服务器数据 `updated_at` 超过3分钟未变动，视为离线）。
4.  **Telegram 通知配置**：
    *   点击右上角机器人图标 🤖。
    *   设置 **Komari 通知群组 ID**。
    *   一旦检测到离线，机器人会直接发消息到该群组。

### 3. Telegram 消息监听 (被动监控)

适用于：你的服务器在内网，没有公网 IP，但能发 TG 消息。

1.  让服务器的脚本定时往群里发 "Server A is Online"。
2.  在面板添加 **Telegram** 监控。
3.  配置：
    *   监听群组 ID。
    *   上线关键词：`Online`。
    *   服务器名称：`Server A`。
4.  逻辑：面板如果没有在规定时间内（间隔 x 2）收到包含 `Server A` 和 `Online` 的消息，就标记为 **Down**。

---

## 🛠️ API 接口 (供第三方集成)

*   `GET /api/monitors`: 获取所有监控项状态。
*   `GET /poll?since=0`: 获取最新的刷新指令（用于浏览器插件）。
*   `POST /api/check-now`: 强制立即触发某个任务。

## ⚙️ 环境变量

| 变量 名 | 默认值 | 描述 |
| :--- | :--- | :--- |
| `PORT` | 3000 | 监听端口 |
| `DATA_DIR` | /app/data | 数据库存储路径 |
| `TZ` | UTC | 时区设置 (建议设为 Asia/Shanghai) |

---

## 🤝 贡献与反馈

欢迎提交 Issue 或 Pull Request。
更多详情请查看 [CONTRIBUTING.md](./CONTRIBUTING.md)。

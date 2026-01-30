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

## ✨ 核心功能

### 1. 全方位监控能力
*   **🌐 HTTP/HTTPS 深度检测**
    *   支持 GET/POST/HEAD 等多种方法。
    *   自定义 Headers (JSON) 与 Body (JSON)。
    *   **双重验证**：同时验证 HTTP 状态码 (如 200,201) 与 响应内容关键词 (包含/排除)。
*   **🔌 TCP 端口监控**
    *   通过 Ping 检测目标主机端口连通性。
*   **📊 Komari 探针集成**
    *   对接 Komari 面板 API，一处配置即可监控旗下所有服务器。
    *   支持**主动轮询**与**被动 Webhook** 两种模式。
*   **📱 Telegram 无探针监控 (被动模式)**
    *   适用于无公网 IP 服务器。
    *   监听指定 TG 群组消息，根据关键词 (如 "Server Up/Down") 自动标记状态。

### 2. 智能调度系统 (Smart Scheduling)
*   **🎲 随机区间模式 (Random Interval)**
    *   **独家功能**：支持设置 `Min - Max` 范围（如 10天 ~ 12天）。
    *   **应用场景**：通过长周期随机请求，完美模拟人工操作（如 GitHub Actions 保活），避免被判定为滥用。
*   **💾 持久化调度技术**
    *   任务的“下次执行时间”实时写入 SQLite 数据库。
    *   **掉电保护**：容器重启、升级或崩溃后，倒计时**继续运行**，绝不丢失或重置。
*   **🚀 主动探针 (Active Webhook)**
    *   定时触发 Webhook 任务。
    *   **用途**：定期唤醒 Serverless 服务、触发 CI/CD 构建等。

### 3. 下一代告警系统
*   **🤖 Telegram 深度交互**
    *   **全局 Bot**：配置一次，全系统通用。
    *   **交互式卡片**：告警消息附带 **[🔄 立即重试]** 按钮，直接在 TG 里控制重测。
    *   **独立通道**：支持将不同类型的告警推送到不同群组 (如 Komari 告警单独分组)。
*   **🔔 多渠道分发**
    *   支持标准 Webhook (Discord / Slack / 钉钉 / 企业微信)。
    *   内置 SSE (Server-Sent Events) 推送，支持浏览器插件实时红点告警。

### 4. 极致轻量与部署
*   **🐳 Docker Native**：原生支持 AMD64 与 ARM64 (树莓派/Mac M1)，体积小巧。
*   **📁 Zero-Config DB**：内置 SQLite，无需部署 MySQL/Postgres，单文件即可备份迁移。
*   **📉 可视化面板**：直观的响应时间趋势图、状态历史、服务器地区旗帜展示。

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

如果你有自建的探针面板，想把报警统一收敛，有两种方式：

#### 方案 A: API 轮询 (推荐)
主动定期拉取 Komari 面板数据，适合需要实时监控所有服务器状态的场景。

1.  **添加监控** -> 选择类型 **Komari**。
2.  **URL**：填写探针数据的 API 地址（如 `https://status.example.com/api/v1/servers`）。
3.  **离线阈值**：设置 `3` 分钟（如果服务器数据 `updated_at` 超过3分钟未变动，视为离线）。
4.  **Telegram 通知配置**：
    *   点击右上角机器人图标 🤖。
    *   设置 **Komari 通知群组 ID**。

#### 方案 B: Webhook 被动接收
CloudEye 作为接收端，被动接收 Komari 面板发出的 Webhook 告警。

1.  **添加监控** -> 选择类型 **Komari Webhook**。
2.  **监控目标服务器**：填写服务器名称 (如 `HK-Server-1`)，与探针面板上的名称一致。
3.  **前往 Komari 面板后台** -> 通知设置 -> 添加 Webhook：
    *   **URL**: `http://你的CloudEye域名:3000/api/komari-notify`
    *   **Method**: `POST`
    *   **Body**: 默认 JSON 即可。
4.  **效果**：当 CloudEye 收到该 Webhook，会匹配服务器名称，更新监控状态，并可触发额外的通知。

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

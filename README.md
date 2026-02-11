
# CloudEye 监控面板 (Uptime Monitor)

[![Docker Build](https://github.com/debbide/monitora/actions/workflows/docker-build.yml/badge.svg)](https://github.com/debbide/monitora/actions/workflows/docker-build.yml)  
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

**CloudEye** 是一个现代化、轻量级且功能强大的服务器监控面板。  
它不仅仅是一个 uptime 监控工具，更集成了 **主动探针 (Active Probe)**、**随机调度**、**Komari 面板集成** 和 **Telegram 深度控制** 等高级功能。

### 适用场景
- 监控网站、API 接口、TCP 端口连通性。
- **GitHub Actions 保活**：利用随机长周期调度，定期触发 Workflow。
- **Komari 探针监控**：聚合多台服务器状态，离线自动报警。
- **Telegram 消息监听**：监控那些为了隐私而不开放端口的服务。

---

## ✨ 核心功能

### 1. 全方位监控能力
- **🌐 HTTP/HTTPS 深度检测**  
    支持 GET/POST/HEAD 等多种方法，自定义 Headers 和 Body，双重验证：状态码与响应内容关键词。

- **🔌 TCP 端口监控**  
    通过 Ping 检测目标主机端口连通性。

- **📊 Komari 探针集成**  
    支持主动轮询与被动 Webhook，适配 Komari 面板，监控旗下所有服务器状态。

- **📱 Telegram 无探针监控 (被动模式)**  
    适用于无公网 IP 的服务器，监听群组消息，根据关键词自动标记状态。

- **🔗 反馈联动监控 (Feedback Linkage)**  
    下一代保活技术。由监控目标（服务器）主动上报剩余时间，面板根据“阈值+随机波动”智能调度下一次续期任务。

### 2. 智能调度系统 (Smart Scheduling)
- **🎲 随机区间模式 (Random Interval)**  
    设置 `Min - Max` 范围（如 10天 ~ 12天）避免滥用，通过长周期模拟人工操作。

- **💾 持久化调度技术**  
    任务的下次执行时间写入 SQLite 数据库，容器重启后倒计时继续运行。

- **🚀 主动探针 (Active Webhook)**  
    定时触发 Webhook 任务，如定期唤醒 Serverless 服务、触发 CI/CD 构建。

### 3. 下一代告警系统
- **🤖 Telegram 深度交互**  
    配置一次，全系统通用，支持交互式卡片与不同群组推送。

- **🔔 多渠道分发**  
    支持 Webhook (Discord/Slack/钉钉/企业微信)，内置 SSE 推送，浏览器插件实时告警。

### 4. 极致轻量与部署
- **🐳 Docker Native**  
    原生支持 AMD64 与 ARM64，体积小巧。

- **📁 Zero-Config DB**  
    内置 SQLite，无需部署 MySQL/Postgres，单文件即可备份迁移。

- **📉 可视化面板**  
    响应时间趋势图、状态历史、服务器地区旗帜展示。

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
   - URL: `http://localhost:3000`
   - 默认密码: `admin123`（登录后请务必修改）

---

## 📖 详细使用指南

### 1. 配置 GitHub Actions 保活 (随机长周期)
1. 添加监控 -> 选择类型 **Scheduled Webhook**。
2. 调度模式：选择 **随机区间**，填入 `10` - `12`，单位选择 **Days**。
3. 配置 Request：
    - URL: `https://api.github.com/repos/YOUR_USER/YOUR_REPO/dispatches`
    - Method: `POST`
    - Headers:
        ```json
        {
          "Authorization": "Bearer YOUR_GITHUB_TOKEN",
          "Accept": "application/vnd.github+json"
        }
        ```
    - Body: `{"event_type": "keep-alive"}`
4. 保存配置，系统会立即执行一次。

### 2. 对接 Komari 探针
- **方案 A: API 轮询 (推荐)**  
  适合需要实时监控所有服务器状态的场景。定期拉取 Komari 面板数据。

- **方案 B: Webhook 被动接收**  
  被动接收 Komari 面板发出的告警。

### 3. 对接 哪吒探针 (Nezha)

类似于 Komari，CloudEye 也支持接收 哪吒探针 (Nezha) 的 Webhook 告警。

1.  **添加监控** -> 选择类型 **哪吒 (Nezha) Webhook 监控**。
2.  **服务器名称**：填写在哪吒面板中显示的服务器名称 (如 `US-Node-1`)，需完全一致。
3.  **前往 哪吒面板后台** -> 报警通知 -> 添加通知方式：
    *   **方式**: `Webhook`
    *   **URL**: `https://你的CloudEye域名/api/nezha-notify-v1`
    *   **Request Body**: 保持默认 JSON 格式即可。
4.  **效果**：当哪吒探针检测到服务器离线/上线，会发送 Webhook 给 CloudEye，CloudEye 会更新面板状态并发送 TG 通知。

### 4. Telegram 消息监听 (被动监控)

适用于：你的服务器在内网，没有公网 IP，但能发 TG 消息。

1.  让服务器的脚本定时往群里发 "Server A is Online"。
2.  在面板添加 **Telegram** 监控。
3.  配置：
    *   监听群组 ID。
    *   上线关键词：`Online`。
    *   服务器名称：`Server A`。
4.  逻辑：面板如果没有在规定时间内（间隔 x 2）收到包含 `Server A` 和 `Online` 的消息，就标记为 **Down**。

---

## 🔗 反馈联动监控 (Feedback Linkage)

反馈联动是 CloudEye 的核心进阶功能，主要解决“请求触发”模式中调度不精准的问题。

### 1. 核心逻辑 (智能续期窗口)
- **触发点计算**：`实际触发点 = 触发阈值 - 随机(波动范围)`。
- **动态调度**：服务器通过回调接口告知面板其“剩余到期时间”。面板计算该时间是否已达到触发点。
- **智能等待**：如果时间尚未到达，面板会自动计算差值并修改自身的 `next_check_at`，精准等待，避免频繁的无用触发。

### 2. 快速对接指引

1.  **添加监控** -> 选择类型 **反馈联动监控 (Feedback Linkage)**。
2.  **配置参数**：
    *   **关键词**：用于在通用接口中识别服务器 (如 `MyNode-01`)。
    *   **触发阈值**：基准剩余时间（如填 `24` 小时）。
    *   **波动范围**：防止规律性行为（如填 `2-4` 小时）。
3.  **脚本集成**：
    在你的保活脚本中，执行完续期逻辑后，通过 API 告知面板。

    - **接口地址**: `http://你的IP:3000/api/callback`
    - **请求方式**: `POST`
    - **Payload**:
      ```json
      {
        "server_name": "MyNode-01",
        "remaining_time": 86400,
        "status": "up"
      }
      ```
4.  **TG 联动**：配置专属通知群组，每次成功或失败都会收到详细通知，并带有 **立即重试** 按钮。


---

## 🔔 Webhook 被动接收配置 (Komari 面板接收 CloudEye)

### 1. 在 CloudEye 面板中添加 Webhook 监控
在 CloudEye 面板中，选择 **添加监控**，然后选择 **Komari Webhook** 类型。

### 2. 配置监控目标
填写你想要监控的目标服务器名称，确保它与 Komari 面板上的服务器名称一致。例如：
- 服务器名称：`HK-Server-1`

### 3. 在 Komari 面板后台配置 Webhook
- 打开 **Komari 面板后台**。
- 转到 **通知设置** -> **Webhook** 部分。
- 添加一个新的 Webhook，配置如下：
  - **URL**: `https://你的CloudEye域名/api/komari-notify`
  - **Method**: `POST`
  - **Body**: 默认 JSON 格式即可，无需修改。

  例如，假设 CloudEye 部署在 `cloudeye.example.com`，则 URL 配置为：
  ```plaintext
  https://cloudeye.example.com/api/komari-notify
  ```

- 保存设置，Komari 面板会在监控目标发生变化时，自动向 CloudEye 发送通知。

### 4. CloudEye 接收通知并更新状态
当 CloudEye 接收到 Webhook 通知后，会根据服务器名称更新监控状态，并触发相应的告警操作。

---

## 🛠️ API 接口

- `GET /api/monitors`: 获取所有监控项状态。
- `GET /poll?since=0`: 获取最新的刷新指令。
- `POST /api/check-now`: 强制立即触发任务。

## ⚙️ 环境变量

| 变量 名  | 默认值  | 描述 |
| ---  | ---  | --- |
| `PORT`  | 3000  | 监听端口 |
| `DATA_DIR`  | /app/data  | 数据存储路径 |
| `TZ`  | UTC  | 时区设置 (建议设为 Asia/Shanghai) |

---

## 🤝 贡献与反馈
欢迎提交 Issue 或 Pull Request。更多详情请查看 [CONTRIBUTING.md](./CONTRIBUTING.md)。

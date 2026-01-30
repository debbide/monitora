# CloudEye 监控面板

[![Docker Build](https://github.com/debbide/monitora/actions/workflows/docker-build.yml/badge.svg)](https://github.com/debbide/monitora/actions/workflows/docker-build.yml)
[![Code Quality](https://github.com/debbide/monitora/actions/workflows/code-quality.yml/badge.svg)](https://github.com/debbide/monitora/actions/workflows/code-quality.yml)

一个现代化的服务监控面板，支持 HTTP/TCP/Komari/Telegram 监控，基于 Docker 快速部署。

## ✨ 特性

- 🌐 **HTTP/HTTPS 检测** - 支持自定义请求方法、Header、Body 和状态码验证
- 🔌 **TCP 连通性检测** - 端口可用性监控
- 🎲 **随机检测间隔** - 支持设置 10~12 天等长周期随机检测，模拟真实用户行为
- 📌 **持久化调度** - 定时任务状态写入数据库，重启服务不丢失下次执行时间（倒计时继续）
- 🚀 **定时 Webhook (Active Probe)** - 主动定时触发远程 API (如 GitHub Actions) 并根据响应判断状态
- 📊 **Komari 面板监控** - 专门针对 Komari 探针的服务器状态监控
- 📱 **Telegram 深度集成** - 支持群组消息监听、全局 Bot 配置、Komari 离线通知
- 🔔 **多渠道通知** - Webhook、Telegram、SSE 实时推送
- 🔍 **关键词检测** - 检测页面是否包含/不包含特定关键词
- 👁️ **可视化图表** - 响应时间趋势图

### 使用预构建镜像（推荐）

#### Docker Compose

创建 `docker-compose.yml` 文件：

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
      - NODE_ENV=production
      - PORT=3000
      - DATA_DIR=/app/data
```

然后运行:

```bash
docker-compose up -d
```

启动后访问 `http://localhost:3000`，默认密码为 **`admin123`**。

### 从源码构建

```bash
# 克隆仓库
git clone https://github.com/debbide/monitora.git
cd monitora

# 使用 Docker Compose 构建并启动
docker-compose up -d
```

## 📖 使用方法

### 访问界面

打开浏览器访问 `http://localhost:3000`

**默认密码**: `admin123`

⚠️ **首次使用请立即修改密码！**

### 添加监控与高级配置

1. 点击"添加监控"按钮
2. **基础配置**：
   - **名称**：监控项目名称
   - **URL**：要监控的网址或 API 地址
   - **检测类型**：
     - **HTTP/HTTPS**：常规网站监控
     - **TCP**：端口连通性
     - **Komari**：针对 Komari 面板 API 的特定监控
     - **Scheduled Webhook**：定时触发器（如下方详解）
     - **Telegram**：被动监听群组消息

3. **调度模式 (新功能)**：
   - **固定周期**：每隔 X 分钟/小时/天执行一次（如：每 5 分钟）。
   - **随机区间**：在 X 到 Y 之间随机执行（如：每 10 ~ 12 天）。每次执行完后会自动生成下一个随机时间点并持久化保存。

4. **高级设置**：
   - **Request Configuration**：自定义 HTTP Method, Headers (JSON), Body (JSON)。
   - **预期状态码**：如 `200,201,204`。
   - **Webhook Notification**：当检测失败/成功时，发送通知到外部系统（如 Discord/Slack）。

### 🚀 定时 Webhook (Scheduled Webhook)

这是一个特殊的监控类型，用于 **“主动触发”** 外部任务（如 GitHub Actions, Vercel Deploy Hooks 等）。

*   **场景**：你需要每隔 10~12 天自动触发一次 GitHub Workflow 来保活。
*   **配置方法**：
    *   **类型**选择 `Scheduled Webhook`。
    *   **Request Configuration** 中填写触发所需的 Headers (如 `Authorization`) 和 Body。
    *   **判断逻辑**：只要对方 API 返回 2xx (如 GitHub 返回 204)，即视为成功。
    *   **结果**：会在面板记录触发时间和耗时，失败则报警。

### 📊 Komari 集成与通知

针对 Komari 探针系统的深度集成功能：

1. **Komari 监控**：
   - 填写 Komari 面板的 API 地址 (如 `https://status.example.com/api/v1/servers`)。
   - 设置 **离线阈值** (如 3 分钟)，如果服务器超过该时间未上报，视为离线。
   - 打开 **Telegram 机器人设置** (右上角机器人图标) -> **Komari 通知设置**，配置全局通知群组。
   - 当检测到服务器离线时，会自动向指定的 TG 群组发送告警。

2. **Komari Webhook**：
   - 作为一个被动接收端，接收 Komari 面板发来的 Webhook 消息并转发到 Telegram。

### 🤖 Telegram 全局配置

点击右上角的 🤖 图标进行全局设置：

- **Bot Token**：设置全局 Telegram Bot Token。
- **连接测试**：输入 Chat ID 测试机器人连通性。
- **Komari 通知**：设置专门用于接收 Komari 告警的群组 ID。

### SSE/轮询刷新通知服务

内置刷新通知服务，可供浏览器插件接收实时刷新通知：

| 端点 | 方法 | 用途 |
|------|------|------|
| `/poll` | GET | 轮询获取刷新通知（推荐） |
| `/api/sse/refresh` | GET | SSE 长连接方式 |
| `/api/webhook/refresh` | POST | 触发刷新通知 `{"url": "..."}` |
| `/api/sse/status` | GET | 查看连接的客户端数量 |

**浏览器插件配置**：
1. 插件服务器地址填写：`http://你的服务器:3000`
2. 面板监控项 Webhook 填写：`http://你的服务器:3000/api/webhook/refresh`
3. 面板监控项 Webhook Body 填写：`{"url": "要刷新的页面URL"}`


### 配置 Webhook 通知

支持常见的 Webhook 服务：

#### Discord

```
https://discord.com/api/webhooks/YOUR_WEBHOOK_ID/YOUR_WEBHOOK_TOKEN
```

#### Slack

```
https://hooks.slack.com/services/YOUR/WEBHOOK/URL
```

## 🛠️ 配置选项

### 环境变量

| 变量 | 默认值 | 说明 |
|-----|--------|------|
| `PORT` | 3000 | 服务端口 |
| `DATA_DIR` | /app/data | 数据目录 |
| `NODE_ENV` | production | 运行环境 |

### 数据持久化

数据存储在 `./data` 目录中（SQLite 数据库），使用 Docker 卷挂载确保数据不会丢失。

## 🏗️ 多平台支持

本项目使用 GitHub Actions 自动构建多平台 Docker 镜像：

- **linux/amd64** - x86_64 架构（普通 PC、服务器）
- **linux/arm64** - ARM64 架构（树莓派 4、Apple M1/M2 等）

Docker 会自动选择适合你系统的镜像版本。

## 🔧 开发

查看 [CONTRIBUTING.md](./CONTRIBUTING.md) 了解如何参与开发。

### 开发环境要求

- Node.js 20+
- npm
- Docker (可选)

### 本地开发

```bash
# 安装依赖
npm install

# 启动开发服务器
npm run dev

# 运行代码检查
npm run lint

# 格式化代码
npm run format

# 类型检查
npm run type-check
```

## 📦 技术栈

- **前端**: React 18 + TypeScript + Vite
- **后端**: Express + TypeScript + Node.js 20
- **数据库**: SQLite (sql.js)
- **定时任务**: node-cron
- **容器化**: Docker + Docker Compose
- **CI/CD**: GitHub Actions


## 🤝 贡献

欢迎提交 Issue 和 Pull Request！

## 📧 联系方式

如有问题或建议，请提交 Issue。


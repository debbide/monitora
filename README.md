# CloudEye 监控面板

[![Docker Build](https://github.com/debbide/monitora/actions/workflows/docker-build.yml/badge.svg)](https://github.com/debbide/monitora/actions/workflows/docker-build.yml)
[![Code Quality](https://github.com/debbide/monitora/actions/workflows/code-quality.yml/badge.svg)](https://github.com/debbide/monitora/actions/workflows/code-quality.yml)

一个现代化的服务监控面板，支持 HTTP/TCP/Komari/Telegram 监控，基于 Docker 快速部署。

## ✨ 特性

- 🌐 **HTTP/HTTPS 检测** - 支持自定义请求方法和关键词检测
- 🔌 **TCP 连通性检测** - 端口可用性监控
- 📊 **Komari 面板监控** - 服务器状态监控
- 📱 **Telegram 群组监控** - 监听 TG 群组消息，根据关键词判断服务状态
- 🔔 **Webhook 通知** - 自定义 Webhook 通知（支持 Discord、Slack 等）
- 📡 **SSE 实时推送** - 浏览器插件可实时接收刷新通知
- 🔍 **关键词检测** - 检测页面是否包含/不包含特定关键词
- ⏰ **定时检测** - 可自定义检测间隔

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
cd monitor

# 使用 Docker Compose 构建并启动
docker-compose up -d

# 或使用 Docker 构建
docker build -t uptime-monitor .
docker run -d -p 3000:3000 -v ./data:/app/data uptime-monitor
```

## 📖 使用方法

### 访问界面

打开浏览器访问 `http://localhost:3000`

**默认密码**: `admin123`

⚠️ **首次使用请立即修改密码！**

### 添加监控

1. 点击"添加监控"按钮
2. 填写监控信息：
   - 名称：监控项目名称
   - URL：要监控的网址或服务器地址
   - 检测类型：HTTP、TCP、Komari 或 Telegram
   - 检测间隔：检测频率（分钟）
   - Webhook URL：（可选）故障时触发的通知地址

### Telegram 群组监控

监听 Telegram 群组消息，根据关键词判断服务状态：

1. 在顶栏点击 🤖 按钮配置 Bot Token（从 @BotFather 获取）
2. 将 Bot 加入要监控的群组
3. 在 BotFather 中关闭 Bot 的 **Group Privacy** 模式
4. 创建 Telegram 类型监控，填写：
   - **群组 ID**：负数格式，如 `-1001234567890`
   - **服务器名称**：消息中需包含的服务器名称（支持多个，逗号分隔）
   - **离线关键词**：如 `Offline,down,离线`
   - **上线关键词**：如 `Online,up,上线`

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


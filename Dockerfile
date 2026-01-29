# 构建阶段
FROM node:20-slim AS builder

WORKDIR /app

# 安装构建依赖
RUN apt-get update && apt-get install -y python3 make g++ && rm -rf /var/lib/apt/lists/*

# 复制 package 文件
COPY package*.json ./

# 安装依赖
RUN npm ci

# 复制源代码
COPY . .

# 构建前端和后端
RUN npm run build

# 生产阶段 - 使用更小的基础镜像
FROM node:20-slim

WORKDIR /app

# 复制 package 文件
COPY package*.json ./

# 只安装生产依赖并清理缓存
RUN npm ci --omit=dev && \
    npm cache clean --force && \
    rm -rf /tmp/* /root/.npm

# 复制构建产物
COPY --from=builder /app/dist ./dist

# 创建数据目录
RUN mkdir -p /app/data

# 设置环境变量
ENV NODE_ENV=production
ENV PORT=3000
ENV DATA_DIR=/app/data
ENV NODE_OPTIONS="--no-warnings"

EXPOSE 3000

# 启动服务
CMD ["node", "dist/server/index.js"]

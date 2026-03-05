FROM node:20-alpine

WORKDIR /app

# 安装依赖
COPY package*.json ./
RUN npm install --production

# 复制源码
COPY . .

# 暴露端口 (Fastify 默认是 3000)
EXPOSE 3000

# 启动命令
CMD ["npm", "start"]

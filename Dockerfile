FROM oven/bun:1.3-alpine AS build
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile
COPY . .
ARG BUN_PUBLIC_BASE_PATH=/
ENV BUN_PUBLIC_BASE_PATH=$BUN_PUBLIC_BASE_PATH
RUN bun run build

FROM oven/bun:1.3-alpine
WORKDIR /app
COPY --from=build /app/dist ./dist
COPY server.ts ./
ENV PORT=3000
EXPOSE 3000
CMD ["bun", "server.ts"]

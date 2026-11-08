FROM node:24-alpine AS build
RUN apk add --no-cache curl build-base
RUN curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --profile minimal --target wasm32-unknown-unknown
ENV PATH="/root/.cargo/bin:${PATH}"
RUN cargo install wasm-pack --locked
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build:wasm && npm run build

FROM nginx:alpine
COPY deploy/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80

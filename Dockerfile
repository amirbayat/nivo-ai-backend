FROM node:22-alpine

# کرومیوم سیستمی برای Puppeteer (تولید PDF فاکتور) — روی آلپاین باینری خودِ
# Puppeteer اجرا نمی‌شود، پس دانلودش را غیرفعال و به‌جایش از این استفاده می‌کنیم
RUN apk add --no-cache chromium
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .

RUN npx prisma generate

COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

EXPOSE 3000

ENTRYPOINT ["/entrypoint.sh"]

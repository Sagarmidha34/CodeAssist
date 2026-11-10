FROM node:22-bookworm-slim

WORKDIR /app

# The authenticated agent runner needs Python for its restricted subprocess.
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 ca-certificates \
  && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build && npm prune --omit=dev

RUN useradd --system --uid 10001 --create-home codeassist \
  && chown -R codeassist:codeassist /app
USER codeassist

ENV NODE_ENV=production
ENV PORT=10000
EXPOSE 10000
CMD ["npm", "run", "start"]

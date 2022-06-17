# We specify `bullseye` to avoid problems observed with the default `16` which
# uses `buster`. On Docker for Mac, `buster` occasionally takes 5s to resolve
# `host.docker.internal`, leading to Prisma connection timeouts.
#
# See related issue in Docker for Mac's GitHub repo:
# https://github.com/docker/for-mac/issues/5548#issuecomment-1029204019
#
# NOTE(ptr): Node 18 uses `bullseye` by default, so we can remove the OS version
# spec when we upgrade.
#
# Issue: https://github.com/prisma/prisma/issues/8478
FROM node:16-bullseye-slim

RUN apt-get update && apt-get install -y openssl

WORKDIR /app

# The runner scans this directory, and will fail with `ENOENT` if it doesn't
# exist. That can happen if no plugins are mounted, so we create it ourselves.
RUN mkdir /app/plugins

COPY package.json .
COPY package-lock.json .
COPY packages/glider-connectors/package.json packages/glider-connectors/package.json
COPY packages/glider-runner/package.json packages/glider-runner/package.json
RUN npm ci

COPY tsconfig.json .
COPY tsconfig.build.json .

COPY packages/glider packages/glider
COPY packages/glider-connectors packages/glider-connectors
COPY packages/glider-runner packages/glider-runner

RUN npm run build

ENTRYPOINT ["node", "packages/glider-runner/dist/app.js"]

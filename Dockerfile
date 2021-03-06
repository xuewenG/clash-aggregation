FROM node:16.14.0-stretch AS BUILDER
LABEL maintainer="xuewenG" \
        site="https://github.com/xuewenG/clash-aggregation"

ENV MY_HOME=/root
RUN mkdir -p $MY_HOME
WORKDIR $MY_HOME

COPY package.json $MY_HOME
RUN set -x \
    && yarn install --registry=https://registry.npmmirror.com

COPY . $MY_HOME
RUN set -x \
    && yarn run build

FROM node:16.14.0-stretch

ENV MY_HOME=/root
RUN mkdir -p $MY_HOME
WORKDIR $MY_HOME

COPY package.json $MY_HOME
RUN set -x \
    && yarn install --production --registry=https://registry.npmmirror.com

COPY --from=BUILDER /root/dist .

ENTRYPOINT ["node", "index.js"]

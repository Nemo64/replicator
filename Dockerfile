FROM node:16
WORKDIR /app

COPY package.json /app
RUN npm install --no-update-notifier --ignore-scripts --no-shrinkwrap --no-package-lock

COPY tsconfig.json /app
COPY src /app/src
RUN npm run build --no-update-notifier

# now build the actual image
# with the build js files and without dev dependencies

FROM node:16
WORKDIR /app

COPY package.json /app
RUN npm install --only=prod --no-update-notifier --ignore-scripts --no-shrinkwrap --no-package-lock

COPY --from=0 /app/dist /app/dist
COPY schemas /app/schemas

# docker run --rm -v $PWD:/data replicator /data/replicator.json
ENTRYPOINT ["/app/dist/cli.js"]

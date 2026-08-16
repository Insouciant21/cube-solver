FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/web/package.json apps/web/package.json
RUN npm ci
COPY apps/web ./apps/web
RUN npm run build --workspace @613-cube-solver/web

FROM nginx:1.27-alpine
COPY --from=build /app/apps/web/dist /usr/share/nginx/html
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf
RUN chmod a+r /etc/nginx/conf.d/default.conf
# Make the immutable runtime compatible with the unprivileged nginx user.
RUN sed -i \
    -e 's#^error_log.*#error_log /dev/stderr notice;#' \
    -e 's#^pid.*#pid /tmp/nginx.pid;#' \
    -e 's#^    access_log.*#    access_log /dev/stdout main;#' \
    /etc/nginx/nginx.conf
USER nginx
EXPOSE 8080
CMD ["nginx", "-g", "daemon off;"]

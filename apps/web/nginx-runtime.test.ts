import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const nginxConfig = readFileSync("nginx.conf", "utf8");
const dockerfile = readFileSync("Dockerfile", "utf8");

describe("read-only nginx runtime", () => {
  it("uses an unprivileged writable tmpfs runtime", () => {
    expect(nginxConfig).toContain("listen 8080;");
    expect(dockerfile).toContain("pid /tmp/nginx.pid;");
    expect(dockerfile).toContain("sed -i");
    expect(dockerfile).toContain("chmod a+r /etc/nginx/conf.d/default.conf");
    expect(dockerfile).toContain('CMD ["nginx", "-g", "daemon off;"]');
    expect(nginxConfig).toContain("proxy_temp_path /tmp/proxy_temp;");
    expect(nginxConfig).toContain("fastcgi_temp_path /tmp/fastcgi_temp;");
    expect(nginxConfig).toContain("uwsgi_temp_path /tmp/uwsgi_temp;");
    expect(nginxConfig).toContain("scgi_temp_path /tmp/scgi_temp;");
  });
});

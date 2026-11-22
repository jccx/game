// 本地 CONNECT 中继：让无头 Chrome 经过沙盒的 egress 代理上网。
// 背景：沙盒的 egress 代理要认证、还做 TLS 拦截；Chrome 的 --proxy-server 不支持在 URL 里带认证，
// 所以起一个本地中继：Chrome 连中继（不认证），中继替它向 egress 代理发带认证的 CONNECT。
// 认证只从进程环境变量读，绝不打印、不写日志。只供测试用，不进游戏代码。
import net from 'node:net';

/** 启动中继，返回 { port, close } */
export function startRelay() {
  return new Promise((resolve, reject) => {
    const proxyRaw = process.env.https_proxy || process.env.HTTPS_PROXY || process.env.http_proxy || process.env.HTTP_PROXY;
    if (!proxyRaw) { reject(new Error('no proxy in env')); return; }
    let u;
    try { u = new URL(proxyRaw); } catch { reject(new Error('bad proxy url')); return; }
    const auth = u.username ? 'Basic ' + Buffer.from(`${decodeURIComponent(u.username)}:${decodeURIComponent(u.password)}`).toString('base64') : null;
    const proxyHost = u.hostname, proxyPort = Number(u.port) || 8080;
    const server = net.createServer((client) => {
      let buf = Buffer.alloc(0);
      const onData = (chunk) => {
        buf = Buffer.concat([buf, chunk]);
        const end = buf.indexOf('\r\n\r\n');
        if (end < 0) return;   // 请求头还没收全，继续等
        client.off('data', onData);
        const line = buf.subarray(0, end).toString('ascii').split('\r\n')[0];
        const m = /^CONNECT ([^ ]+) HTTP\/\d/.exec(line);
        if (!m) { client.destroy(); return; }
        const target = m[1];
        const rest = buf.subarray(end + 4);
        const upstream = net.connect(proxyPort, proxyHost, () => {
          let req = `CONNECT ${target} HTTP/1.1\r\nHost: ${target}\r\nProxy-Connection: keep-alive\r\n`;
          if (auth) req += `Proxy-Authorization: ${auth}\r\n`;
          upstream.write(req + '\r\n');
        });
        let ubuf = Buffer.alloc(0), done = false;
        upstream.on('data', (chunk) => {
          if (done) return;
          ubuf = Buffer.concat([ubuf, chunk]);
          const e2 = ubuf.indexOf('\r\n\r\n');
          if (e2 < 0) return;
          const status = Number(ubuf.subarray(0, e2).toString('ascii').split(' ')[1]);
          if (status !== 200) { upstream.destroy(); client.destroy(); return; }
          done = true;
          client.write('HTTP/1.1 200 OK\r\n\r\n');
          const tail = ubuf.subarray(e2 + 4);
          if (tail.length) client.write(tail);
          if (rest.length) upstream.write(rest);
          client.pipe(upstream); upstream.pipe(client);
        });
        upstream.on('error', () => client.destroy());
        client.on('error', () => upstream.destroy());
      };
      client.on('data', onData);
      client.on('error', () => {});
    });
    server.listen(0, '127.0.0.1', () => resolve({ port: server.address().port, close: () => new Promise((r) => server.close(r)) }));
    server.on('error', reject);
  });
}

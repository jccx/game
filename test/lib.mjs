// 浏览器测试公共部分：启动无头 Chrome、打开页面、收集报错、截图。
// 浏览器路径用环境变量 CHROME 指定，默认 /usr/bin/google-chrome。
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startServer } from './serve.mjs';

export const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), 'out');
fs.mkdirSync(OUT, { recursive: true });

/** 常用屏幕尺寸 */
export const VIEW = {
  desktop:   { width: 1280, height: 720, deviceScaleFactor: 1, isMobile: false, hasTouch: false },
  landscape: { width: 844,  height: 390, deviceScaleFactor: 1, isMobile: true,  hasTouch: true },
  portrait:  { width: 390,  height: 844, deviceScaleFactor: 1, isMobile: true,  hasTouch: true },
};

/** 启动浏览器和本地服务器 */
export async function launch() {
  const srv = await startServer(0);
  const browser = await puppeteer.launch({
    executablePath: process.env.CHROME || '/usr/bin/google-chrome',
    headless: true,
    args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
           '--ignore-gpu-blocklist', '--enable-webgl', '--mute-audio', '--disable-dev-shm-usage'],
  });
  return { browser, base: srv.url, async close() { await browser.close(); srv.server.close(); } };
}

/** 打开一个页面；返回 page 和收集到的报错列表 errors */
export async function open(ctx, urlPath, view = VIEW.desktop) {
  const page = await ctx.browser.newPage();
  await page.setViewport(view);
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + (e.stack || e.message)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  page.on('requestfailed', (r) => errors.push('requestfailed: ' + r.url()));
  page.on('response', (r) => { if (r.status() >= 400) errors.push(`http ${r.status()}: ${r.url()}`); });
  await page.goto(ctx.base + urlPath, { waitUntil: 'load' });
  return { page, errors };
}

/** 截图到 test/out/<name>.png */
export async function shot(page, name) {
  const file = path.join(OUT, name + '.png');
  await page.screenshot({ path: file });
  return file;
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 简单断言 */
export function check(cond, msg, list) {
  list.push((cond ? 'PASS ' : 'FAIL ') + msg);
  return !!cond;
}

// 裂谷争锋：用 3D 渲染器给每个英雄拍一张“证件照”，选人界面用。只在进入菜单时执行一次。
import * as THREE from '../../../shared/js/three.js';
import { makeCanvas } from '../../../shared/js/geo.js';
import { buildHero } from './models.js';

/**
 * @param {THREE.WebGLRenderer} renderer
 * @param {object[]} heroes 英雄定义列表
 * @returns {Object<string,string>} 英雄 id → 图片（data URL）
 */
export function renderPortraits(renderer, heroes, w = 220, h = 260) {
  const rt = new THREE.WebGLRenderTarget(w, h, { samples: 4 });
  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xffffff, 0x4a5670, 1.5));
  const sun = new THREE.DirectionalLight(0xfff0dd, 2.2); sun.position.set(-3, 5, 6); scene.add(sun);
  const cam = new THREE.PerspectiveCamera(30, w / h, 0.1, 60);
  cam.position.set(2.6, 3.6, 8.2); cam.lookAt(0, 1.75, 0);
  const buf = new Uint8Array(w * h * 4);
  const [cv, ctx] = makeCanvas(w, h), img = ctx.createImageData(w, h);
  // 渲染到离屏目标时颜色是线性的，这里转回屏幕用的 sRGB
  const lut = new Uint8Array(256);
  for (let i = 0; i < 256; i++) lut[i] = Math.round(255 * Math.pow(i / 255, 1 / 2.2));
  const out = {};
  const prevColor = renderer.getClearColor(new THREE.Color()), prevAlpha = renderer.getClearAlpha();
  renderer.setClearColor(0x000000, 0);
  for (const def of heroes) {
    const m = buildHero(def.id);
    m.group.rotation.y = -0.5;
    m.armR.rotation.x = -0.55; m.armL.rotation.x = -0.25; m.legR.rotation.x = 0.15; m.legL.rotation.x = -0.15;
    scene.add(m.group);
    renderer.setRenderTarget(rt); renderer.clear(); renderer.render(scene, cam);
    renderer.readRenderTargetPixels(rt, 0, 0, w, h, buf);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const s = ((h - 1 - y) * w + x) * 4, d = (y * w + x) * 4;       // 读出来的图是上下颠倒的
      img.data[d] = lut[buf[s]]; img.data[d + 1] = lut[buf[s + 1]]; img.data[d + 2] = lut[buf[s + 2]]; img.data[d + 3] = buf[s + 3];
    }
    ctx.putImageData(img, 0, 0);
    out[def.id] = cv.toDataURL('image/png');
    scene.remove(m.group);
    m.group.traverse((o) => { if (o.isMesh) o.geometry.dispose(); });
  }
  renderer.setRenderTarget(null);
  renderer.setClearColor(prevColor, prevAlpha);
  rt.dispose();
  return out;
}

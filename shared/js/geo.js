// 模型搭建工具：用方块、圆柱、球等基本形体拼出低多边形模型，
// 并把它们合并成一个带顶点颜色的几何体——一个模型部件只占一次绘制调用，不需要贴图文件。
import * as THREE from './three.js';

const _m = new THREE.Matrix4(), _n = new THREE.Matrix3();
const _p = new THREE.Vector3(), _s = new THREE.Vector3(), _q = new THREE.Quaternion(), _e = new THREE.Euler();
const _v = new THREE.Vector3(), _ca = new THREE.Color(), _cb = new THREE.Color();

/** 基本几何体缓存：同样参数只创建一次 */
const cache = new Map();
function cached(key, make) {
  let g = cache.get(key);
  if (!g) { g = make(); if (g.index) g = g.toNonIndexed(); g.computeBoundingBox(); cache.set(key, g); }
  return g;
}

export class Builder {
  constructor() { this.pos = []; this.nor = []; this.col = []; }

  /**
   * 加入一个几何体。
   * @param {THREE.BufferGeometry} geo 非索引几何体
   * @param {number|number[]} color 颜色；给 [下, 上] 两个颜色时按高度渐变
   * @param {number} x,y,z 位置
   * @param {number} rx,ry,rz 旋转（弧度）
   * @param {number} sx,sy,sz 缩放
   */
  add(geo, color, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) {
    _e.set(rx, ry, rz); _q.setFromEuler(_e);
    _m.compose(_p.set(x, y, z), _q, _s.set(sx, sy, sz));
    _n.getNormalMatrix(_m);
    const P = geo.attributes.position, N = geo.attributes.normal;
    const grad = Array.isArray(color);
    if (grad) { _ca.set(color[0]); _cb.set(color[1]); } else _ca.set(color);
    const bb = geo.boundingBox, y0 = bb.min.y, yh = Math.max(1e-6, bb.max.y - bb.min.y);
    for (let i = 0; i < P.count; i++) {
      const ly = P.getY(i);
      _v.set(P.getX(i), ly, P.getZ(i)).applyMatrix4(_m);
      this.pos.push(_v.x, _v.y, _v.z);
      _v.set(N.getX(i), N.getY(i), N.getZ(i)).applyMatrix3(_n).normalize();
      this.nor.push(_v.x, _v.y, _v.z);
      if (grad) {
        const t = (ly - y0) / yh;
        this.col.push(_ca.r + (_cb.r - _ca.r) * t, _ca.g + (_cb.g - _ca.g) * t, _ca.b + (_cb.b - _ca.b) * t);
      } else this.col.push(_ca.r, _ca.g, _ca.b);
    }
    return this;
  }

  /** 方块：宽 w、高 h、深 d，位置为中心 */
  box(w, h, d, color, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) {
    return this.add(cached('box', () => new THREE.BoxGeometry(1, 1, 1)), color, x, y, z, rx, ry, rz, w, h, d);
  }
  /** 圆柱/圆台：上半径 rt、下半径 rb、高 h、边数 seg（rb 为 0 时是尖朝下的锥） */
  cyl(rt, rb, h, color, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, seg = 8) {
    if (rb > 0) {
      // 单位圆台（下半径 1、高 1）按比例缓存，再缩放到实际尺寸
      const k = +(rt / rb).toFixed(3);
      return this.add(cached(`cyl${k}_${seg}`, () => new THREE.CylinderGeometry(k, 1, 1, seg)), color, x, y, z, rx, ry, rz, rb, h, rb);
    }
    return this.add(cached(`cylinv_${seg}`, () => new THREE.CylinderGeometry(1, 0, 1, seg)), color, x, y, z, rx, ry, rz, rt, h, rt);
  }
  /** 圆锥：底半径 r、高 h */
  cone(r, h, color, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, seg = 8) {
    return this.add(cached('cone' + seg, () => new THREE.ConeGeometry(1, 1, seg)), color, x, y, z, rx, ry, rz, r, h, r);
  }
  /** 球：半径 r；sy 可压扁/拉长 */
  sphere(r, color, x = 0, y = 0, z = 0, sx = 1, sy = 1, sz = 1, seg = 8) {
    return this.add(cached('sph' + seg, () => new THREE.SphereGeometry(1, seg, Math.max(4, seg - 2))), color, x, y, z, 0, 0, 0, r * sx, r * sy, r * sz);
  }
  /** 多面体石块：detail 0 为二十面体 */
  rock(r, color, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1, detail = 0) {
    return this.add(cached('ico' + detail, () => new THREE.IcosahedronGeometry(1, detail)), color, x, y, z, rx, ry, rz, r * sx, r * sy, r * sz);
  }
  /** 水平圆盘（朝上），半径 r */
  disc(r, color, x = 0, y = 0, z = 0, seg = 16) {
    return this.add(cached('disc' + seg, () => new THREE.CircleGeometry(1, seg)), color, x, y, z, -Math.PI / 2, 0, 0, r, r, 1);
  }
  /** 环面：半径 r、管粗 t */
  torus(r, t, color, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, seg = 12) {
    return this.add(cached(`tor${(t / r).toFixed(3)}_${seg}`, () => new THREE.TorusGeometry(1, t / r, 6, seg)), color, x, y, z, rx, ry, rz, r, r, r);
  }

  /** 当前顶点数 */
  get count() { return this.pos.length / 3; }

  /** 生成几何体。flat 为 true 时重新计算法线，得到棱角分明的低多边形效果 */
  build(flat = false) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    if (flat) g.computeVertexNormals();
    else g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.computeBoundingSphere();
    return g;
  }

  /** 直接生成网格 */
  mesh(material = MAT.vc, flat = false) {
    return new THREE.Mesh(this.build(flat), material);
  }
}

/** 共用材质。Lambert 是有光照的材质里最省性能的一种 */
export const MAT = {
  vc: new THREE.MeshLambertMaterial({ vertexColors: true }),
  vcFlat: new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }),
  vcBasic: new THREE.MeshBasicMaterial({ vertexColors: true }),
};

/**
 * 脚下的圆形软阴影（“假阴影”）：一张径向渐变贴图贴在地面的小方片上，比实时阴影省得多。
 * 返回共用的几何体和材质，调用方自己建 Mesh 或 InstancedMesh。
 */
let _blob = null;
export function blobShadow() {
  if (_blob) return _blob;
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const x = c.getContext('2d');
  const g = x.createRadialGradient(32, 32, 2, 32, 32, 32);
  g.addColorStop(0, 'rgba(0,0,0,.55)'); g.addColorStop(0.6, 'rgba(0,0,0,.25)'); g.addColorStop(1, 'rgba(0,0,0,0)');
  x.fillStyle = g; x.fillRect(0, 0, 64, 64);
  const tex = new THREE.CanvasTexture(c);
  const geo = new THREE.PlaneGeometry(1, 1); geo.rotateX(-Math.PI / 2);
  const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false });
  _blob = { geo, mat };
  return _blob;
}

/** 把一张 2D 画布做成贴图 */
export function canvasTexture(canvas, o = {}) {
  const t = new THREE.CanvasTexture(canvas);
  t.colorSpace = THREE.SRGBColorSpace;
  if (o.repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(o.repeat[0], o.repeat[1]); }
  t.anisotropy = o.aniso || 2;
  return t;
}

/** 新建一张 2D 画布，返回 [canvas, ctx] */
export function makeCanvas(w, h) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  return [c, c.getContext('2d')];
}

// 雷諾曼原創插畫的共用色票與圖形（v27 階段 2，詳見 doc/v27-lenormand-plan.md 3-3）。
// 每個主圖模組（motifs/NN-slug.js）拿到這裡的 h，在 240×330 的區塊裡畫圖：中心 x=120，地面大約在 y=290。
// 全部回傳 SVG 字串；數字一律取到小數點後一位，控制檔案大小。

// 色調：米白、淡金、灰綠、淡紫，搭配白色花卉
const P = {
  cream: '#f6f0e1',
  paper: '#fbf8f0',
  gold: '#c4a265',
  goldDeep: '#9c7c43',
  goldLight: '#e6d4a6',
  sage: '#a9b8a0',
  sageDeep: '#6f8468',
  sageLight: '#d5ddcc',
  lav: '#c3b5d3',
  lavDeep: '#8b7aa3',
  lavLight: '#e6def0',
  white: '#ffffff',
  petalEdge: '#ded3bd',
  ink: '#5d5763',
  rose: '#c9939a',
  roseLight: '#ecd3d4',
  sky: '#cfdbe0',
  water: '#9fb4bd',
  ochre: '#c9a27a',
  bark: '#9b8670',
}

const f = (n) => {
  const r = Math.round(n * 10) / 10
  return Object.is(r, -0) ? '0' : String(r)
}

// 一片葉子：從 (x, y) 往 angle（度，0 是朝右）長 len
function leaf(x, y, len, angle, fill = P.sage, width = 0.32) {
  const a = (angle * Math.PI) / 180
  const tx = x + len * Math.cos(a)
  const ty = y + len * Math.sin(a)
  const mx = (x + tx) / 2
  const my = (y + ty) / 2
  const nx = -Math.sin(a) * len * width
  const ny = Math.cos(a) * len * width
  return `<path d="M${f(x)} ${f(y)}Q${f(mx + nx)} ${f(my + ny)} ${f(tx)} ${f(ty)}Q${f(mx - nx)} ${f(my - ny)} ${f(x)} ${f(y)}Z" fill="${fill}"/>`
}

// 白色小花：petals 片花瓣、淡金花心；花瓣有一圈很淡的邊，在米白底上才看得見
function flower(x, y, r, { petals = 5, fill = P.white, center = P.gold, rot = 0, edge = P.petalEdge } = {}) {
  let out = `<g fill="${fill}" stroke="${edge}" stroke-width=".6">`
  for (let i = 0; i < petals; i += 1) {
    const deg = rot + (360 / petals) * i
    out += `<ellipse cx="${f(x)}" cy="${f(y - r * 0.55)}" rx="${f(r * 0.4)}" ry="${f(r * 0.58)}" transform="rotate(${f(deg)} ${f(x)} ${f(y)})"/>`
  }
  return `${out}</g><circle cx="${f(x)}" cy="${f(y)}" r="${f(r * 0.26)}" fill="${center}"/>`
}

// 花苞
function bud(x, y, r, angle = -90, fill = P.white) {
  return `<g transform="rotate(${f(angle + 90)} ${f(x)} ${f(y)})"><ellipse cx="${f(x)}" cy="${f(y)}" rx="${f(r * 0.55)}" ry="${f(r)}" fill="${fill}" stroke="${P.petalEdge}" stroke-width=".6"/>${leaf(x, y + r * 0.8, r * 0.9, -60, P.sage)}${leaf(x, y + r * 0.8, r * 0.9, -120, P.sage)}</g>`
}

// 一枝細莖：從 (x, y) 往 angle 彎曲長 len，兩側交錯長葉子，頂端可以開一朵花
function sprig(x, y, len, angle, { leaves = 4, color = P.sageDeep, leafFill = P.sage, bend = 0.18, tip = 'flower', tipSize = 7 } = {}) {
  const a = (angle * Math.PI) / 180
  const tx = x + len * Math.cos(a)
  const ty = y + len * Math.sin(a)
  const cx = (x + tx) / 2 - Math.sin(a) * len * bend
  const cy = (y + ty) / 2 + Math.cos(a) * len * bend
  let out = `<path d="M${f(x)} ${f(y)}Q${f(cx)} ${f(cy)} ${f(tx)} ${f(ty)}" fill="none" stroke="${color}" stroke-width="1.4" stroke-linecap="round"/>`
  for (let i = 1; i <= leaves; i += 1) {
    const t = i / (leaves + 1)
    const px = (1 - t) * (1 - t) * x + 2 * (1 - t) * t * cx + t * t * tx
    const py = (1 - t) * (1 - t) * y + 2 * (1 - t) * t * cy + t * t * ty
    const side = i % 2 ? 1 : -1
    out += leaf(px, py, len * 0.22 * (1 - t * 0.4), angle + side * 48, leafFill)
  }
  if (tip === 'flower') out += flower(tx, ty, tipSize)
  if (tip === 'bud') out += bud(tx, ty, tipSize * 0.8, angle)
  return out
}

// 一小叢白花（主圖底部常用）
function cluster(x, y, s = 1) {
  return (
    leaf(x - 2 * s, y + 2 * s, 18 * s, 200, P.sage) +
    leaf(x + 2 * s, y + 2 * s, 18 * s, -20, P.sage) +
    leaf(x, y, 15 * s, -110, P.sageLight) +
    flower(x - 9 * s, y - 3 * s, 7 * s, { rot: 15 }) +
    flower(x + 9 * s, y - 5 * s, 6 * s, { rot: 40 }) +
    flower(x, y - 13 * s, 7.5 * s) +
    `<circle cx="${f(x + 15 * s)}" cy="${f(y - 15 * s)}" r="${f(1.6 * s)}" fill="${P.gold}"/>` +
    `<circle cx="${f(x - 16 * s)}" cy="${f(y - 14 * s)}" r="${f(1.3 * s)}" fill="${P.gold}"/>`
  )
}

// 柔和的地面
function ground(cx = 120, y = 292, rx = 96, fill = P.sageLight) {
  return `<ellipse cx="${f(cx)}" cy="${f(y)}" rx="${f(rx)}" ry="${f(rx * 0.12)}" fill="${fill}" opacity=".8"/>`
}

// 幾根草
function grass(x, y, w = 30, color = P.sage) {
  let d = ''
  for (let i = 0; i < 5; i += 1) {
    const gx = x - w / 2 + (w / 4) * i
    const h = 8 + ((i * 7) % 6)
    d += `M${f(gx)} ${f(y)}q${f(i % 2 ? 2 : -2)} ${f(-h / 2)} ${f(i % 2 ? 4 : -3)} ${f(-h)}`
  }
  return `<path d="${d}" fill="none" stroke="${color}" stroke-width="1.2" stroke-linecap="round"/>`
}

// n 角星
function star(x, y, r, { points = 5, inner = 0.45, fill = P.gold, rot = -90 } = {}) {
  let d = ''
  for (let i = 0; i < points * 2; i += 1) {
    const rr = i % 2 ? r * inner : r
    const a = ((rot + (180 / points) * i) * Math.PI) / 180
    d += `${i ? 'L' : 'M'}${f(x + rr * Math.cos(a))} ${f(y + rr * Math.sin(a))}`
  }
  return `<path d="${d}Z" fill="${fill}"/>`
}

// 愛心：中心 (x, y)，寬度約 2s
function heart(x, y, s, { fill = P.rose, rot = 0, stroke = '', sw = 1 } = {}) {
  const pts = [
    [0, 1],
    [-0.4, 0.6, -1, 0.25, -1, -0.2],
    [-1, -0.65, -0.45, -0.85, 0, -0.45],
    [0.45, -0.85, 1, -0.65, 1, -0.2],
    [1, 0.25, 0.4, 0.6, 0, 1],
  ]
  const r = (rot * Math.PI) / 180
  const tp = (px, py) => {
    const X = px * s
    const Y = py * s
    return `${f(x + X * Math.cos(r) - Y * Math.sin(r))} ${f(y + X * Math.sin(r) + Y * Math.cos(r))}`
  }
  let d = `M${tp(pts[0][0], pts[0][1])}`
  for (const c of pts.slice(1)) d += `C${tp(c[0], c[1])} ${tp(c[2], c[3])} ${tp(c[4], c[5])}`
  const strokeAttr = stroke ? ` stroke="${stroke}" stroke-width="${sw}"` : ''
  return `<path d="${d}Z" fill="${fill}"${strokeAttr}/>`
}

// 齒輪
function gear(x, y, r, teeth, { fill = P.gold, hole = P.cream, depth = 0.16 } = {}) {
  let d = ''
  const steps = teeth * 4
  for (let i = 0; i < steps; i += 1) {
    const rr = i % 4 < 2 ? r : r * (1 - depth)
    const a = ((360 / steps) * i * Math.PI) / 180
    d += `${i ? 'L' : 'M'}${f(x + rr * Math.cos(a))} ${f(y + rr * Math.sin(a))}`
  }
  return `<path d="${d}Z" fill="${fill}"/><circle cx="${f(x)}" cy="${f(y)}" r="${f(r * 0.32)}" fill="${hole}"/><circle cx="${f(x)}" cy="${f(y)}" r="${f(r * 0.58)}" fill="none" stroke="${hole}" stroke-width="1.2" opacity=".6"/>`
}

// 水波線
function waves(x, y, w, { rows = 3, gap = 9, color = P.water, amp = 3 } = {}) {
  let out = ''
  for (let r = 0; r < rows; r += 1) {
    let d = `M${f(x + (r % 2) * 6)} ${f(y + r * gap)}`
    for (let i = 0; i < w / 16; i += 1) d += `q4 ${-amp} 8 0t8 0`
    out += `<path d="${d}" fill="none" stroke="${color}" stroke-width="1.3" stroke-linecap="round" opacity="${f(0.9 - r * 0.2)}"/>`
  }
  return out
}

// 小光點（裝飾）
function sparkle(x, y, r = 5, fill = P.gold) {
  return `<path d="M${f(x)} ${f(y - r)}Q${f(x + r * 0.18)} ${f(y - r * 0.18)} ${f(x + r)} ${f(y)}Q${f(x + r * 0.18)} ${f(y + r * 0.18)} ${f(x)} ${f(y + r)}Q${f(x - r * 0.18)} ${f(y + r * 0.18)} ${f(x - r)} ${f(y)}Q${f(x - r * 0.18)} ${f(y - r * 0.18)} ${f(x)} ${f(y - r)}Z" fill="${fill}"/>`
}

module.exports = { P, f, leaf, flower, bud, sprig, cluster, ground, grass, star, heart, gear, waves, sparkle }

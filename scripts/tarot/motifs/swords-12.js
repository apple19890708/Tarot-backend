// 寶劍騎士：奔馬側影，前方一柄劍，被風吹斜的雲與羽毛（直接、快速、衝勁十足）
// （不畫衝鋒的騎士）
module.exports = {
  draw: ({ P, court }) =>
    court('swords', 'knight', {
      over: `<path d="M24 120H64M16 140H52M30 160H60" stroke="${P.lav}" stroke-width="1.6" stroke-linecap="round" opacity=".7"/>`,
    }),
}

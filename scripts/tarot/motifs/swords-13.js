// 寶劍皇后：劍尖朝上，上方一頂花冠與新月，旁邊一根羽毛（清醒、獨立、說話直接但公正）
// （不畫舉劍伸手的皇后）
module.exports = {
  draw: ({ court, feather }) =>
    court('swords', 'queen', {
      over: feather(172, 226, 44, -110),
    }),
}

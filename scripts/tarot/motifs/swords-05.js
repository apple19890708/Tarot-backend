// 寶劍五：三柄劍落在地上、兩柄還立著，一面小旗倒在一旁（贏了卻不光彩、爭執後的空虛）
// （不畫撿劍的人與離開的兩人）
module.exports = {
  draw: ({ P, ground, grass, sword, cloud }) =>
    cloud(70, 84, 80, P.lavLight, 0.9) +
    cloud(180, 70, 70, P.lavLight, 0.8) +
    ground(120, 284, 106) +
    // 立著的兩柄
    sword(150, 142, 128, 90) +
    sword(184, 160, 112, 94) +
    // 落在地上的三柄
    sword(26, 262, 120, -6) +
    sword(60, 280, 112, 4) +
    sword(212, 284, 110, 182) +
    // 倒下的小旗
    `<path d="M40 238L112 222" stroke="${P.goldDeep}" stroke-width="2" stroke-linecap="round"/>` +
    `<path d="M108 223L122 202L92 210Z" fill="${P.lav}"/>` +
    grass(30, 284, 20) +
    grass(130, 286, 20),
}

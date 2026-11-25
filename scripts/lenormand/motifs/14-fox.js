// 14 狐狸：坐著、朝左看的狐狸（朝左）
module.exports = {
  facing: 'left',
  draw: ({ P, ground, cluster, grass }) =>
    ground(120, 288, 96) +
    `<path d="M146 272Q210 274 204 222Q200 194 178 204Q194 238 150 250Z" fill="${P.ochre}"/>` +
    `<ellipse cx="200" cy="214" rx="9" ry="12" transform="rotate(20 200 214)" fill="${P.paper}"/>` +
    `<path d="M100 284Q78 232 104 192Q122 176 142 198Q162 244 152 284Z" fill="${P.ochre}"/>` +
    `<path d="M98 190Q90 226 106 256Q114 224 114 194Z" fill="${P.paper}"/>` +
    `<path d="M112 250L110 284M128 252L128 284" stroke="#a8825d" stroke-width="5" stroke-linecap="round"/>` +
    `<path d="M124 162Q106 148 88 164L64 176L88 186Q110 192 126 180Z" fill="${P.ochre}"/>` +
    `<path d="M64 176L88 186Q100 188 108 182Q90 182 74 174Z" fill="${P.paper}"/>` +
    `<path d="M96 158L100 134L111 156ZM110 156L118 134L123 160Z" fill="#a8825d"/>` +
    `<circle cx="91" cy="168" r="2.2" fill="${P.ink}"/><circle cx="64" cy="176" r="2.6" fill="${P.ink}"/>` +
    grass(60, 288, 26) +
    cluster(48, 292, 0.85),
}

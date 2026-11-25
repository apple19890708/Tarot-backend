// 17 鸛鳥：單腳站在水邊、朝右的鸛鳥（朝右）
module.exports = {
  facing: 'right',
  draw: ({ P, sprig, waves, flower }) =>
    `<path d="M24 276Q120 262 222 276V296H24Z" fill="${P.sky}" opacity=".7"/>` +
    waves(30, 284, 180, { rows: 2 }) +
    sprig(40, 290, 120, -96, { leaves: 4, tip: 'bud', tipSize: 9 }) +
    sprig(206, 290, 96, -84, { leaves: 3, tip: 'bud', tipSize: 8 }) +
    `<path d="M112 192L114 282M104 192L96 228L114 236" stroke="${P.rose}" stroke-width="3" fill="none" stroke-linecap="round" stroke-linejoin="round"/>` +
    `<path d="M136 160Q150 132 150 104" stroke="${P.lav}" stroke-width="12" fill="none" stroke-linecap="round"/>` +
    `<path d="M136 160Q150 132 150 104" stroke="${P.paper}" stroke-width="8.5" fill="none" stroke-linecap="round"/>` +
    `<ellipse cx="110" cy="172" rx="42" ry="24" transform="rotate(-14 110 172)" fill="${P.paper}" stroke="${P.lav}" stroke-width="1.6"/>` +
    `<path d="M76 168Q96 150 132 160Q110 176 84 190Q66 196 58 204Q62 186 76 168Z" fill="${P.lavDeep}" opacity=".85"/>` +
    `<path d="M80 176Q100 166 122 168" stroke="${P.paper}" stroke-width="1.2" fill="none" opacity=".7"/>` +
    `<circle cx="152" cy="98" r="11" fill="${P.paper}" stroke="${P.lav}" stroke-width="1.6"/>` +
    `<path d="M160 94L202 106L160 103Z" fill="${P.rose}"/>` +
    `<circle cx="155" cy="96" r="1.8" fill="${P.ink}"/>` +
    flower(190, 248, 6),
}

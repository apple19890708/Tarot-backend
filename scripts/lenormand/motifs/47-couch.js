// 47 沙發：放著靠墊的復古沙發
module.exports = {
  facing: null,
  draw: ({ P, ground, sprig, leaf }) =>
    ground(120, 284, 108) +
    `<path d="M44 206Q46 150 96 158Q120 136 144 158Q194 150 196 206Z" fill="${P.lav}"/>` +
    `<path d="M60 196Q62 166 96 170Q120 152 144 170Q178 166 180 196" fill="none" stroke="${P.lavDeep}" stroke-width="1.2" opacity=".6"/>` +
    `<g fill="${P.lavDeep}" opacity=".5"><circle cx="88" cy="184" r="2"/><circle cx="120" cy="174" r="2"/><circle cx="152" cy="184" r="2"/></g>` +
    `<rect x="40" y="204" width="160" height="34" rx="12" fill="${P.lavLight}" stroke="${P.lav}" stroke-width="1.4"/>` +
    `<rect x="26" y="190" width="30" height="58" rx="14" fill="${P.lav}"/>` +
    `<rect x="184" y="190" width="30" height="58" rx="14" fill="${P.lav}"/>` +
    `<path d="M48 248L44 276M192 248L196 276" stroke="${P.goldDeep}" stroke-width="5" stroke-linecap="round"/>` +
    `<rect x="70" y="182" width="36" height="28" rx="10" transform="rotate(-12 88 196)" fill="${P.roseLight}" stroke="${P.rose}" stroke-width="1.2"/>` +
    `<rect x="134" y="184" width="34" height="26" rx="10" transform="rotate(10 151 197)" fill="${P.sageLight}" stroke="${P.sage}" stroke-width="1.2"/>` +
    `<path d="M210 284V250H226V284Z" fill="${P.goldLight}" stroke="${P.gold}" stroke-width="1"/>` +
    sprig(218, 250, 70, -96, { leaves: 3, tipSize: 7 }) +
    leaf(218, 252, 22, -150, P.sage),
}

// 6 雲：一朵明亮、一朵陰暗的雲，下面有細雨
module.exports = {
  facing: null,
  draw: ({ P, cluster }) =>
    `<g fill="${P.lavLight}" stroke="${P.lav}" stroke-width="1.4"><circle cx="62" cy="128" r="22"/><circle cx="94" cy="108" r="34"/><circle cx="132" cy="118" r="28"/><circle cx="160" cy="134" r="20"/><rect x="50" y="128" width="120" height="26" rx="13"/></g>` +
    `<path d="M58 140H162" stroke="${P.lavLight}" stroke-width="20" stroke-linecap="round"/>` +
    `<g fill="#a99bbd"><circle cx="102" cy="200" r="24"/><circle cx="136" cy="182" r="34"/><circle cx="174" cy="196" r="26"/><circle cx="200" cy="212" r="16"/><rect x="88" y="200" width="122" height="28" rx="14"/></g>` +
    `<g fill="${P.lavDeep}" opacity=".45"><circle cx="150" cy="200" r="20"/><rect x="100" y="214" width="104" height="14" rx="7"/></g>` +
    `<path d="M108 238l-6 16M130 240l-6 16M152 238l-6 16M174 240l-6 16M196 236l-5 14" stroke="${P.lavDeep}" stroke-width="1.6" stroke-linecap="round" opacity=".7"/>` +
    `<path d="M36 80q8-8 16 0M180 70q6-6 12 0" fill="none" stroke="${P.lav}" stroke-width="1.4" stroke-linecap="round"/>` +
    cluster(64, 290, 0.95) +
    cluster(168, 292, 0.8),
}

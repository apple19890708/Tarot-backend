// 43 齒輪：互相咬合的三個齒輪
module.exports = {
  facing: null,
  draw: ({ P, gear, sprig, ground }) =>
    ground(120, 292, 80) +
    gear(98, 142, 50, 12, { fill: P.gold }) +
    gear(166, 206, 36, 9, { fill: P.sageDeep }) +
    gear(90, 240, 28, 8, { fill: P.lavDeep }) +
    sprig(196, 290, 110, -100, { leaves: 4, tipSize: 8 }) +
    sprig(40, 290, 80, -70, { leaves: 3, tip: 'bud', tipSize: 7 }),
}

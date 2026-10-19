# 依 (suit, from, to, slot) 置換單一句子，用來消除跨花色的重複開頭。
# 輸入：{"domain":"love","edits":[[suit, from, to, slot, 新句], ...]}
import io, json, re, sys
spec = json.load(io.open(sys.argv[1], encoding='utf-8'))
cache = {}
for suit, frm, to, slot, new in spec['edits']:
    path = 'scripts/pairs/%s/%s.js' % (spec['domain'], suit)
    if path not in cache:
        cache[path] = io.open(path, encoding='utf-8').read()
    src = cache[path]
    needle = "['%s', '%s', [" % (frm, to)
    i = src.find(needle)
    assert i >= 0, u'找不到列：%s %s -> %s' % (suit, frm, to)
    j = src.index(']],', i)
    texts = re.findall(r"'([^']*)'", src[i + len(needle):j])
    assert len(texts) == 4, u'%s -> %s 不是 4 句' % (frm, to)
    texts[slot] = new
    cache[path] = src[:i] + needle + ', '.join("'" + t + "'" for t in texts) + src[j:]
for path, src in cache.items():
    io.open(path, 'w', encoding='utf-8').write(src)
print(u'置換 %d 句' % len(spec['edits']))

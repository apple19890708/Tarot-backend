# 依 (from, to) 逐列改寫花色檔，不管段落怎麼排版。
# 輸入：{"domain":"love","suit":"wands","rows":[[from,to,[4 句]], ...]}
import io, json, re, sys

spec = json.load(io.open(sys.argv[1], encoding='utf-8'))
path = 'scripts/pairs/%s/%s.js' % (spec['domain'], spec['suit'])
src = io.open(path, encoding='utf-8').read()

done = 0
for frm, to, texts in spec['rows']:
    assert len(texts) == 4, '%s->%s 不是 4 句' % (frm, to)
    needle = "['%s', '%s', [" % (frm, to)
    i = src.find(needle)
    assert i >= 0, '找不到列：%s -> %s' % (frm, to)
    j = src.index(']],', i) + 3
    body = ', '.join("'" + t.replace("'", "\'") + "'" for t in texts)
    src = src[:i] + "['%s', '%s', [%s]]," % (frm, to, body) + src[j:]
    done += 1

io.open(path, 'w', encoding='utf-8').write(src)
print('%s/%s：%d 列已改寫' % (spec['domain'], spec['suit'], done))

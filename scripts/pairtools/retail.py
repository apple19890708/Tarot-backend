# 換掉句尾的最後一個子句（補語寫壞、或和前文重複時用）。
# 輸入：{"domain":"money","suit":"wands","edits":[[from, to, slot, 新句尾], ...]}
import io, json, re, sys
spec = json.load(io.open(sys.argv[1], encoding='utf-8'))
path = 'scripts/pairs/%s/%s.js' % (spec['domain'], spec['suit'])
src = io.open(path, encoding='utf-8').read()
done = 0
for frm, to, slot, tail in spec['edits']:
    needle = "['%s', '%s', [" % (frm, to)
    i = src.find(needle)
    assert i >= 0, u'找不到列：%s -> %s' % (frm, to)
    j = src.index(']],', i)
    texts = re.findall(r"'([^']*)'", src[i + len(needle):j])
    assert len(texts) == 4
    parts = [p for p in re.split(u'(?<=[，。])', texts[slot]) if p]
    assert len(parts) > 1, u'%s -> %s slot%d 只有一個子句' % (frm, to, slot)
    texts[slot] = ''.join(parts[:-1]) + tail
    src = src[:i] + needle + ', '.join("'" + x + "'" for x in texts) + src[j:]
    done += 1
io.open(path, 'w', encoding='utf-8').write(src)
print(u'換句尾 %d 句' % done)

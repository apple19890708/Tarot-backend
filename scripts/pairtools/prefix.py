# 只替換某一句的開頭片段，用來打散「整段都用同一句話起頭」的慣性。
# 輸入：{"domain":"money","suit":"swords","edits":[[from, to, slot, 舊開頭, 新開頭], ...]}
import io, json, re, sys
spec = json.load(io.open(sys.argv[1], encoding='utf-8'))
path = 'scripts/pairs/%s/%s.js' % (spec['domain'], spec['suit'])
src = io.open(path, encoding='utf-8').read()
bad = []
done = 0
for frm, to, slot, old, new in spec['edits']:
    needle = "['%s', '%s', [" % (frm, to)
    i = src.find(needle)
    assert i >= 0, u'找不到列：%s -> %s' % (frm, to)
    j = src.index(']],', i)
    texts = re.findall(r"'([^']*)'", src[i + len(needle):j])
    assert len(texts) == 4, u'%s -> %s 不是 4 句' % (frm, to)
    if not texts[slot].startswith(old):
        bad.append(u'%s -> %s slot%d 實際開頭：%s' % (frm, to, slot, texts[slot][:28]))
        continue
    texts[slot] = new + texts[slot][len(old):]
    done += 1
    src = src[:i] + needle + ', '.join("'" + t + "'" for t in texts) + src[j:]
io.open(path, 'w', encoding='utf-8').write(src)
print(u'改寫 %d 句，略過 %d 句' % (done, len(bad)))
for line in bad:
    print(u'  略過：' + line)

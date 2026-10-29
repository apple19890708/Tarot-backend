# 在指定句子的句尾接上一段補語，用來把偏短的句子補到深度標準的字數。
# 只動句尾，不碰開頭，所以不會製造新的開頭重複。
# 輸入：{"domain":"money","suit":"swords","edits":[[from, to, slot, 補語], ...]}
import io, json, re, sys
spec = json.load(io.open(sys.argv[1], encoding='utf-8'))
path = 'scripts/pairs/%s/%s.js' % (spec['domain'], spec['suit'])
src = io.open(path, encoding='utf-8').read()
done = 0
for frm, to, slot, pad in spec['edits']:
    needle = "['%s', '%s', [" % (frm, to)
    i = src.find(needle)
    assert i >= 0, u'找不到列：%s -> %s' % (frm, to)
    j = src.index(']],', i)
    texts = re.findall(r"'([^']*)'", src[i + len(needle):j])
    assert len(texts) == 4, u'%s -> %s 不是 4 句' % (frm, to)
    texts[slot] = texts[slot] + pad
    src = src[:i] + needle + ', '.join("'" + t + "'" for t in texts) + src[j:]
    done += 1
io.open(path, 'w', encoding='utf-8').write(src)
print(u'補語 %d 句' % done)

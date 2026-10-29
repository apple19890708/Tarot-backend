# 移除句尾和前面重複的子句（補語撞到原句尾時用）。
# 輸入：{"domain":"money","suit":"wands","rows":[[from,to,slot], ...]}
import io, json, re, sys
spec = json.load(io.open(sys.argv[1], encoding='utf-8'))
path = 'scripts/pairs/%s/%s.js' % (spec['domain'], spec['suit'])
src = io.open(path, encoding='utf-8').read()
done = 0
for frm, to, slot in spec['rows']:
    needle = "['%s', '%s', [" % (frm, to)
    i = src.find(needle)
    assert i >= 0, u'找不到列：%s -> %s' % (frm, to)
    j = src.index(']],', i)
    texts = re.findall(r"'([^']*)'", src[i + len(needle):j])
    assert len(texts) == 4
    t = texts[slot]
    parts = [p for p in re.split(u'(?<=[，。])', t) if p]
    # 從句尾往前砍掉和前面重複的子句
    while len(parts) > 1:
        tail = parts[-1].rstrip(u'，。')
        if any(p.rstrip(u'，。') == tail for p in parts[:-1]):
            parts.pop()
        else:
            break
    new = ''.join(parts)
    if not new.endswith(u'。'):
        new = new.rstrip(u'，') + u'。'
    texts[slot] = new
    src = src[:i] + needle + ', '.join("'" + x + "'" for x in texts) + src[j:]
    done += 1
io.open(path, 'w', encoding='utf-8').write(src)
print(u'去重 %d 句' % done)

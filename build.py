# -*- coding: utf-8 -*-
"""index.html + qr.js + app.js 를 파일 하나로 합친다.

축제장에는 와이파이가 없으므로, 폰에 저장해 두고 열 수 있는 단일 파일이 필요하다.
    python build.py
결과: 축제부스.html
"""
import io, os, re

HERE = os.path.dirname(os.path.abspath(__file__))


def read(name):
    return io.open(os.path.join(HERE, name), encoding='utf-8').read()


def main():
    html = read('index.html')
    for src in ('qr.js', 'app.js'):
        tag = '<script src="%s"></script>' % src
        if tag not in html:
            raise SystemExit('index.html 에서 %s 를 못 찾았습니다.' % tag)
        # </script> 가 코드 안에 있으면 조기 종료되므로 끊어 둔다
        code = read(src).replace('</script>', '<\\/script>')
        html = html.replace(tag, '<script>\n' + code + '\n</script>')

    out = os.path.join(HERE, '축제부스.html')
    io.open(out, 'w', encoding='utf-8').write(html)
    size = os.path.getsize(out)
    print('만들었습니다: %s (%.0f KB)' % (out, size / 1024))
    if re.search(r'<script[^>]*\ssrc=', html):
        print('경고: 아직 바깥 파일을 부르는 script 가 남아 있습니다.')


if __name__ == '__main__':
    main()

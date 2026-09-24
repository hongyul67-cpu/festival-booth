# -*- coding: utf-8 -*-
"""축제 부스 3곳 오전 장사(10:00~12:00) 시뮬레이션 → 엑셀 + 앱 백업 파일

    python _sim/simulate.py

- 1분 단위로 손님이 오고(포아송), 부스는 정해진 속도로 만든다(줄을 선다).
- 줄이 너무 길면 그냥 가는 손님, 품절이라 못 사는 손님을 따로 센다.
- 숫자(손님 수·조리 속도·준비 수량·원가)는 모두 '가정'이다. 아래 BOOTHS 만 고치면 다시 돌릴 수 있다.
- 결과: 축제부스_시뮬레이션_vN.xlsx, 앱에 불러올 수 있는 백업 json 3개
"""
import io, json, math, os, random, re, pathlib, sys, time, datetime

HERE = os.path.dirname(os.path.abspath(__file__))
SEED = 2026
OPEN_MIN = 120                      # 10:00 ~ 12:00
START = datetime.datetime(2026, 10, 16, 10, 0)   # 날짜는 예시

# 시간대별 손님 흐름 (1.0 = 가장 붐빌 때). 10분 단위 12칸.
# 10시엔 아직 한산 → 10:40~11:20 본격 → 11:30 잠깐 줄었다가 → 점심 직전 다시 몰림
CURVE = [0.35, 0.55, 0.75, 0.95, 1.10, 1.15, 1.05, 0.95, 0.80, 0.85, 1.05, 1.15]

BOOTHS = [
    {
        'key': 'daepae', 'name': '대패삼겹살', 'theme': 'pocha',
        'orders_per_10min': 8.5,         # 가장 붐빌 때 10분에 들어오는 주문 수
        'make_per_min': 0.9,             # 1분에 만드는 개수 (불판 2개)
        'balk_queue': 12,                # 앞에 이만큼 줄 서 있으면 그냥 간다
        'two_rate': 0.22,                # 한 번에 2개 시키는 비율
        'addon': {'name': '콜라 추가', 'price': 500, 'rate': 0.45, 'ready': 48, 'cost': 460},
        'menu': {'name': '대패삼겹살', 'price': 3000, 'ready': 80, 'cost': 1650},
        'transfer_rate': 0.55,
    },
    {
        'key': 'bingsu', 'name': '빙수', 'theme': 'ocean',
        'orders_per_10min': 8.0, 'make_per_min': 1.0, 'balk_queue': 12, 'two_rate': 0.18,
        'menu': {'name': '빙수', 'price': 3000, 'ready': 90, 'cost': 950},
        'transfer_rate': 0.55,
    },
    {
        'key': 'tako', 'name': '타코야끼', 'theme': 'night',
        'orders_per_10min': 10.0, 'make_per_min': 1.1, 'balk_queue': 12, 'two_rate': 0.25,
        'menu': {'name': '타코야끼', 'price': 2000, 'ready': 150, 'cost': 1100},
        'transfer_rate': 0.5,
    },
]


def poisson(rng, lam):
    L, k, p = math.exp(-lam), 0, 1.0
    while True:
        p *= rng.random()
        if p <= L:
            return k
        k += 1


def hm(minute):
    t = START + datetime.timedelta(minutes=minute)
    return t.strftime('%H:%M')


def run_booth(b, rng):
    m = b['menu']
    ad = b.get('addon')
    left = m['ready']
    cola_left = ad['ready'] if ad else 0
    queue = []           # [남은 작업량, 주문]
    orders, lost_long, lost_soldout = [], 0, 0
    soldout_at = None
    cola_out_at = None
    log = []             # 사건 기록
    work_carry = 0.0
    no = 0
    per_slot = [{'orders': 0, 'qty': 0, 'sales': 0, 'lost': 0, 'queue_end': 0, 'left_end': 0} for _ in CURVE]
    for minute in range(OPEN_MIN):
        slot = minute // 10
        lam = b['orders_per_10min'] * CURVE[slot] / 10.0
        for _ in range(poisson(rng, lam)):
            if len(queue) >= b['balk_queue']:
                lost_long += 1; per_slot[slot]['lost'] += 1
                continue
            qty = 2 if rng.random() < b['two_rate'] else 1
            if left <= 0:
                lost_soldout += 1; per_slot[slot]['lost'] += 1
                continue
            qty = min(qty, left)
            left -= qty
            if left == 0 and soldout_at is None:
                soldout_at = minute
                log.append((minute, '%s 품절 — 준비한 %d개가 다 나갔습니다' % (m['name'], m['ready'])))
            lines = [{'name': m['name'], 'price': m['price'], 'qty': qty, 'no': 1}]
            if ad and cola_left > 0 and rng.random() < ad['rate']:
                cq = min(qty, cola_left)
                cola_left -= cq
                lines.append({'name': ad['name'], 'price': ad['price'], 'qty': cq, 'no': 2})
                if cola_left == 0 and cola_out_at is None:
                    cola_out_at = minute
                    log.append((minute, '콜라 품절 — %d캔 다 나갔습니다 (이후 콜라 추가 불가)' % ad['ready']))
            no += 1
            sec = rng.randint(0, 59)
            o = {
                'no': no, 'min': minute, 'sec': sec, 'lines': lines,
                'total': sum(l['price'] * l['qty'] for l in lines),
                'pay': '이체' if rng.random() < b['transfer_rate'] else '현금',
                'done': None,
            }
            orders.append(o)
            queue.append([float(qty), o])
            per_slot[slot]['orders'] += 1
            per_slot[slot]['qty'] += qty
            per_slot[slot]['sales'] += o['total']
        # 만들기
        work = b['make_per_min'] + work_carry
        while queue and work >= queue[0][0] - 1e-9:
            work -= queue[0][0]
            queue[0][1]['done'] = minute + 1
            queue.pop(0)
        if queue:
            queue[0][0] -= work; work_carry = 0.0
        else:
            work_carry = 0.0
        if minute % 10 == 9:
            per_slot[slot]['queue_end'] = len(queue)
            per_slot[slot]['left_end'] = left
        if len(queue) >= b['balk_queue'] and not any(e[1].startswith('줄이 %d' % b['balk_queue']) for e in log):
            log.append((minute, '줄이 %d팀까지 늘어남 — 이제부터 줄을 보고 그냥 가는 손님이 생깁니다' % b['balk_queue']))
    # 12시에 주문은 닫고, 남은 줄은 마저 만든다
    minute = OPEN_MIN
    while queue:
        work = b['make_per_min'] + work_carry
        while queue and work >= queue[0][0] - 1e-9:
            work -= queue[0][0]
            queue[0][1]['done'] = minute + 1
            queue.pop(0)
        if queue:
            queue[0][0] -= work
        minute += 1
    for o in orders:
        o['wait'] = o['done'] - o['min']
    return {
        'orders': orders, 'lost_long': lost_long, 'lost_soldout': lost_soldout,
        'soldout_at': soldout_at, 'cola_out_at': cola_out_at, 'left': left, 'cola_left': cola_left,
        'log': sorted(log), 'per_slot': per_slot, 'last_done': max([o['done'] for o in orders] or [0]),
    }


# ---------------- 엑셀 ----------------
def next_version_path(path):
    p = pathlib.Path(path)
    stem = re.sub(r'_v\d+$', '', p.stem)
    nums = [int(m.group(1)) for f in p.parent.glob(stem + '_v*' + p.suffix)
            if (m := re.search(r'_v(\d+)$', f.stem))]
    return p.with_name('%s_v%d%s' % (stem, max(nums, default=0) + 1, p.suffix))


def build_excel(results, out_path):
    from openpyxl import Workbook
    from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
    from openpyxl.utils import get_column_letter
    from openpyxl.chart import BarChart, LineChart, Reference
    from openpyxl.worksheet.properties import PageSetupProperties

    wb = Workbook()
    H = Font(bold=True, color='FFFFFF')
    HF = PatternFill('solid', fgColor='3E3733')
    INF = PatternFill('solid', fgColor='FFF2CC')   # 고칠 수 있는 가정 칸
    SUMF = PatternFill('solid', fgColor='FCE4EC')
    thin = Side(style='thin', color='CCCCCC')
    BD = Border(left=thin, right=thin, top=thin, bottom=thin)
    C = Alignment(horizontal='center', vertical='center', wrap_text=True)
    W = Alignment(vertical='top', wrap_text=True)

    def head(ws, row, vals, widths=None):
        for i, v in enumerate(vals, 1):
            c = ws.cell(row=row, column=i, value=v)
            c.font = H; c.fill = HF; c.alignment = C; c.border = BD
        if widths:
            for i, w in enumerate(widths, 1):
                ws.column_dimensions[get_column_letter(i)].width = w

    def title(ws, text, sub=None):
        ws['A1'] = text
        ws['A1'].font = Font(bold=True, size=15)
        if sub:
            ws['A2'] = sub
            ws['A2'].font = Font(color='777777', size=10)

    # ---- 가정 ----
    wsA = wb.active
    wsA.title = '가정'
    title(wsA, '시뮬레이션 가정 (노란 칸은 고치면 요약 시트의 원가·이익이 다시 계산됩니다)',
          '손님 수·조리 속도는 시뮬레이션에 이미 쓰인 값이라, 바꾸려면 simulate.py 를 다시 돌려야 합니다.')
    head(wsA, 4, ['부스', '메뉴', '판매가(원)', '준비 수량(개)', '1개 원가(원, 추정)', '붐빌 때 10분 주문(건)',
                  '1분에 만드는 개수', '줄 포기 기준(팀)', '2개 주문 비율', '계좌이체 비율'],
         [14, 14, 12, 13, 16, 18, 16, 14, 13, 13])
    r = 5
    cost_cell = {}   # (부스, 메뉴) -> 셀 주소
    price_cell = {}
    for b in BOOTHS:
        items = [b['menu']] + ([b['addon']] if b.get('addon') else [])
        for k, it in enumerate(items):
            vals = [b['name'], it['name'], it['price'], it['ready'], it['cost'],
                    b['orders_per_10min'] if k == 0 else '(대패 주문의 %d%%)' % round(it['rate'] * 100),
                    b['make_per_min'] if k == 0 else '', b['balk_queue'] if k == 0 else '',
                    b['two_rate'] if k == 0 else '', b['transfer_rate'] if k == 0 else '']
            for j, v in enumerate(vals, 1):
                c = wsA.cell(row=r, column=j, value=v); c.border = BD; c.alignment = C
            wsA.cell(row=r, column=5).fill = INF
            wsA.cell(row=r, column=9).number_format = '0%'
            wsA.cell(row=r, column=10).number_format = '0%'
            wsA.cell(row=r, column=3).number_format = '#,##0'
            wsA.cell(row=r, column=5).number_format = '#,##0'
            cost_cell[(b['name'], it['name'])] = "가정!$E$%d" % r
            price_cell[(b['name'], it['name'])] = "가정!$C$%d" % r
            r += 1
    r += 1
    notes = [
        '장사 시간: 10:00 ~ 12:00 (오전만, 120분). 12시에 주문을 닫고, 이미 받은 주문은 마저 만들어 내줍니다.',
        '손님 흐름(10분 단위, 1.0=가장 붐빌 때): ' + ' · '.join('%s %.2f' % (hm(i * 10), v) for i, v in enumerate(CURVE)),
        '줄에 이미 기준 이상 서 있으면 손님이 그냥 갑니다(줄 포기). 준비한 수량이 다 나가면 품절로 못 삽니다.',
        '원가는 시장 어림값입니다. 대패삼겹살 1kg 약 13,000원 × 120g + 접시·젓가락, 콜라는 24캔 묶음 약 11,000원 기준.',
        '같은 조건이라도 손님은 운에 따라 달라집니다. 이 결과는 "그럴듯한 하루 하나"이지 예언이 아닙니다 (난수 씨앗 %d).' % SEED,
    ]
    wsA.cell(row=r, column=1, value='설명').font = Font(bold=True)
    for n in notes:
        r += 1
        wsA.cell(row=r, column=1, value='• ' + n)
        wsA.merge_cells(start_row=r, start_column=1, end_row=r, end_column=10)
        wsA.cell(row=r, column=1).alignment = W
        wsA.row_dimensions[r].height = 30

    # ---- 주문기록 ----
    wsO = wb.create_sheet('주문기록')
    title(wsO, '주문 기록 (앱의 판매 기록과 같은 모양)')
    head(wsO, 3, ['부스', '주문번호', '주문 시각', '나온 시각', '기다린 시간(분)', '메뉴', '번호', '수량',
                  '단가(원)', '금액(원)', '결제', '1개 원가(원)', '원가 합(원)'],
         [12, 9, 10, 10, 13, 12, 7, 7, 10, 11, 8, 12, 12])
    r = 4
    first_row = r
    for b, res in results:
        for o in res['orders']:
            for k, l in enumerate(o['lines']):
                vals = [b['name'], o['no'], hm(o['min']), hm(o['done']), o['wait'] if k == 0 else None,
                        l['name'], '%d번' % l['no'], l['qty'], l['price'], None, o['pay'], None, None]
                for j, v in enumerate(vals, 1):
                    c = wsO.cell(row=r, column=j, value=v); c.border = BD; c.alignment = C
                wsO.cell(row=r, column=10, value='=H%d*I%d' % (r, r))
                wsO.cell(row=r, column=12, value='=%s' % cost_cell[(b['name'], l['name'])])
                wsO.cell(row=r, column=13, value='=H%d*L%d' % (r, r))
                for col in (9, 10, 12, 13):
                    wsO.cell(row=r, column=col).number_format = '#,##0'
                r += 1
    last_row = r - 1
    wsO.freeze_panes = 'A4'
    wsO.auto_filter.ref = 'A3:M%d' % last_row
    rng = lambda col: '주문기록!$%s$%d:$%s$%d' % (col, first_row, col, last_row)

    # ---- 요약 ----
    wsS = wb.create_sheet('요약', 0)
    title(wsS, '축제 부스 3곳 · 오전 장사(10:00~12:00) 시뮬레이션 결과',
          '숫자는 주문기록 시트에서 수식으로 계산합니다. 가정 시트의 원가를 고치면 이익이 다시 계산됩니다.')
    cols = ['부스', '주문 건수', '판매 수량(주메뉴)', '콜라 추가', '매출(원)', '현금(원)', '계좌이체(원)',
            '재료비(준비분 전부, 추정)', '남는 돈(원, 추정)', '품절 시각', '줄 보고 포기(명)', '품절로 못 삼(명)',
            '평균 대기(분)', '최장 대기(분)', '남은 수량', '마지막 음식 나온 시각']
    head(wsS, 4, cols, [12, 10, 13, 10, 12, 12, 12, 16, 14, 10, 13, 13, 11, 11, 10, 15])
    r = 5
    for b, res in results:
        n = b['name']
        cond = '%s,"%s"' % (rng('A'), n)
        vals = [
            n,
            '=COUNTIFS(%s,"%s",%s,"1번")' % (rng('A'), n, rng('G')),
            '=SUMIFS(%s,%s,"%s",%s,"1번")' % (rng('H'), rng('A'), n, rng('G')),
            '=SUMIFS(%s,%s,"%s",%s,"2번")' % (rng('H'), rng('A'), n, rng('G')) if b.get('addon') else '-',
            '=SUMIFS(%s,%s)' % (rng('J'), cond),
            '=SUMIFS(%s,%s,%s,"현금")' % (rng('J'), cond, rng('K')),
            '=SUMIFS(%s,%s,%s,"이체")' % (rng('J'), cond, rng('K')),
            '=' + '+'.join('%s*%s' % (cost_cell[(n, it['name'])].replace('$E$', '$D$'), cost_cell[(n, it['name'])])
                           for it in [b['menu']] + ([b['addon']] if b.get('addon') else [])),
            '=E%d-H%d' % (r, r),
            hm(res['soldout_at']) if res['soldout_at'] is not None else '안 남',
            res['lost_long'], res['lost_soldout'],
            '=ROUND(AVERAGEIFS(%s,%s,%s,"1번"),1)' % (rng('E'), cond, rng('G')),
            max(o['wait'] for o in res['orders']),
            '%s %d개' % (b['menu']['name'], res['left']) + (' · 콜라 %d캔' % res['cola_left'] if b.get('addon') else ''),
            hm(res['last_done']),
        ]
        for j, v in enumerate(vals, 1):
            c = wsS.cell(row=r, column=j, value=v); c.border = BD; c.alignment = C
        for col in (5, 6, 7, 8, 9):
            wsS.cell(row=r, column=col).number_format = '#,##0'
        if res['soldout_at'] is None:
            wsS.cell(row=r, column=10).value = '품절 없음'
        r += 1
    # 합계
    wsS.cell(row=r, column=1, value='3곳 합계')
    for col in (2, 3, 5, 6, 7, 8, 9, 11, 12):
        L = get_column_letter(col)
        wsS.cell(row=r, column=col, value='=SUM(%s5:%s%d)' % (L, L, r - 1))
    for col in range(1, 17):
        c = wsS.cell(row=r, column=col); c.fill = SUMF; c.font = Font(bold=True); c.border = BD; c.alignment = C
        if col in (5, 6, 7, 8, 9):
            c.number_format = '#,##0'
    sum_row = r

    # 진행 이야기
    r += 2
    wsS.cell(row=r, column=1, value='오전은 이렇게 흘러갑니다').font = Font(bold=True, size=13)
    story = []
    for b, res in results:
        for minute, text in res['log']:
            story.append((minute, b['name'], text))
    for b, res in results:
        # 가장 붐빈 10분
        ps = res['per_slot']
        k = max(range(len(ps)), key=lambda i: ps[i]['orders'])
        story.append((k * 10 + 5, b['name'], '가장 바쁜 10분(%s~%s): 주문 %d건, 매출 %s원' % (
            hm(k * 10), hm(k * 10 + 10), ps[k]['orders'], format(ps[k]['sales'], ','))))
    story.sort()
    story.insert(0, (0, '전체', '10:00 문 엶 — 아직 한산. 첫 20분은 주문이 드문드문 들어옵니다.'))
    story.append((OPEN_MIN, '전체', '12:00 주문 마감 — 이미 받은 주문은 마저 만들어 내줍니다.'))
    head(wsS, r + 1, ['시각', '부스', '무슨 일'])
    r += 2
    for minute, who, text in story:
        wsS.cell(row=r, column=1, value=hm(minute)).alignment = C
        wsS.cell(row=r, column=2, value=who).alignment = C
        wsS.cell(row=r, column=3, value=text)
        wsS.merge_cells(start_row=r, start_column=3, end_row=r, end_column=16)
        for col in (1, 2, 3):
            wsS.cell(row=r, column=col).border = BD
        r += 1

    # 한 줄 교훈
    r += 1
    wsS.cell(row=r, column=1, value='이 결과에서 보이는 것').font = Font(bold=True, size=13)
    tips = make_tips(results)
    for t in tips:
        r += 1
        wsS.cell(row=r, column=1, value='• ' + t)
        wsS.merge_cells(start_row=r, start_column=1, end_row=r, end_column=16)
    wsS.freeze_panes = 'A5'

    # ---- 시간대별 ----
    wsT = wb.create_sheet('시간대별', 1)
    title(wsT, '10분 단위 흐름 — 주문 건수 · 매출 · 줄 길이 · 남은 수량')
    hdr = ['시간대']
    for b, _ in results:
        hdr += [b['name'] + ' 주문', b['name'] + ' 매출', b['name'] + ' 줄(팀)', b['name'] + ' 남은 수량', b['name'] + ' 포기']
    head(wsT, 3, hdr, [13] + [11] * (len(hdr) - 1))
    for i in range(len(CURVE)):
        rr = 4 + i
        wsT.cell(row=rr, column=1, value='%s~%s' % (hm(i * 10), hm(i * 10 + 10)))
        col = 2
        for b, res in results:
            p = res['per_slot'][i]
            for v in (p['orders'], p['sales'], p['queue_end'], p['left_end'], p['lost']):
                wsT.cell(row=rr, column=col, value=v)
                col += 1
        for c in range(1, len(hdr) + 1):
            wsT.cell(row=rr, column=c).border = BD
            wsT.cell(row=rr, column=c).alignment = C
            if (c - 2) % 5 == 1:
                wsT.cell(row=rr, column=c).number_format = '#,##0'
    last = 3 + len(CURVE)
    ch = BarChart()
    ch.title = '10분마다 매출(원)'
    ch.y_axis.title = '원'
    ch.height, ch.width = 8, 22
    for k in range(len(results)):
        data = Reference(wsT, min_col=3 + k * 5, min_row=3, max_row=last)
        ch.add_data(data, titles_from_data=True)
    ch.set_categories(Reference(wsT, min_col=1, min_row=4, max_row=last))
    wsT.add_chart(ch, 'B%d' % (last + 3))
    lc = LineChart()
    lc.title = '남은 수량(개)'
    lc.height, lc.width = 8, 22
    for k in range(len(results)):
        lc.add_data(Reference(wsT, min_col=5 + k * 5, min_row=3, max_row=last), titles_from_data=True)
    lc.set_categories(Reference(wsT, min_col=1, min_row=4, max_row=last))
    wsT.add_chart(lc, 'B%d' % (last + 21))

    # 인쇄 설정
    for ws in wb.worksheets:
        ws.page_setup.orientation = 'landscape'
        ws.page_setup.paperSize = ws.PAPERSIZE_A4
        ws.sheet_properties.pageSetUpPr = PageSetupProperties(fitToPage=True)
        ws.page_setup.fitToWidth = 1
        ws.page_setup.fitToHeight = 0
        ws.print_options.horizontalCentered = True
        ws.page_margins.left = ws.page_margins.right = 0.3
        ws.page_margins.top = ws.page_margins.bottom = 0.4
    wsO.print_title_rows = '3:3'
    wb.save(out_path)
    return sum_row


def make_tips(results):
    tips = []
    for b, res in results:
        n = b['name']
        waits = [o['wait'] for o in res['orders']]
        avg = sum(waits) / len(waits)
        if res['soldout_at'] is not None:
            tips.append('%s: %s에 품절. 그 뒤 온 손님 %d명이 못 샀습니다. 준비를 더 하면 그만큼 더 팔 수 있었습니다(재료가 남는 위험과 맞바꿈).'
                        % (n, hm(res['soldout_at']), res['lost_soldout']))
        else:
            tips.append('%s: 품절 없이 %d개가 남았습니다(재료비 약 %s원이 그대로 손해). 준비를 줄이거나, 11시 반쯤 값을 내려 떨이하는 방법이 있습니다.'
                        % (n, res['left'], format(res['left'] * b['menu']['cost'], ',')))
        if res['lost_long']:
            tips.append('%s: 줄이 길어 그냥 간 손님 %d명, 평균 대기 %.1f분. 만드는 속도(조리 기구·일손)가 매출을 막고 있습니다.'
                        % (n, res['lost_long'], avg))
        if b.get('addon'):
            ad = b['addon']
            tips.append('콜라 추가(500원)는 캔 원가 약 %d원이라 한 캔에 약 %d원 남습니다. 매출은 늘지만 이익은 거의 없는 "서비스용" 메뉴입니다.'
                        % (ad['cost'], ad['price'] - ad['cost']))
    return tips


# ---------------- 앱 백업(json) ----------------
def app_backup(b, res):
    """앱의 [설정 → 백업 불러오기]로 넣으면 이 시뮬레이션 결과가 그대로 앱 화면에 뜬다."""
    menus = [{'id': 'm1', 'name': b['menu']['name'], 'price': b['menu']['price'], 'photo': '', 'recipe': [],
              'ready': b['menu']['ready']}]
    if b.get('addon'):
        menus.append({'id': 'm2', 'name': b['addon']['name'], 'price': b['addon']['price'], 'photo': '', 'recipe': [],
                      'ready': b['addon']['ready']})
    ids = {m['name']: m['id'] for m in menus}
    base = time.mktime(START.timetuple()) * 1000
    sales = []
    for o in res['orders']:
        lines = [{'menuId': ids[l['name']], 'no': l['no'], 'name': l['name'], 'price': l['price'], 'qty': l['qty']}
                 for l in o['lines']]
        sales.append({'id': 'sim%03d' % o['no'], 'no': o['no'], 't': int(base + (o['min'] * 60 + o['sec']) * 1000),
                      'lines': lines, 'total': o['total'], 'pay': o['pay'],
                      'received': o['total'], 'change': 0, 'by': '손님'})
    log = [{'id': 'l' + m['id'], 't': int(base) - 1800000, 'menuId': m['id'], 'name': m['name'],
            'kind': '처음 준비', 'qty': m['ready'], 'note': ''} for m in menus]
    return {
        'boothName': b['name'] + ' (시뮬레이션)', 'preset': '', 'theme': b['theme'],
        'account': {'bank': '', 'number': '', 'holder': '', 'link': ''},
        'items': [], 'menus': menus, 'plan': {}, 'purchases': [], 'sales': sales, 'adjusts': [],
        'counted': {}, 'menuLog': log, 'cash0': 0, 'ledgerMode': 'simple', 'soldout': {},
    }


def main():
    rng = random.Random(SEED)
    results = [(b, run_booth(b, rng)) for b in BOOTHS]
    out = next_version_path(os.path.join(HERE, '축제부스_시뮬레이션_v1.xlsx'))
    build_excel(results, str(out))
    for b, res in results:
        p = os.path.join(HERE, '앱백업_%s.json' % b['name'])
        io.open(p, 'w', encoding='utf-8').write(json.dumps(app_backup(b, res), ensure_ascii=False))
    print('엑셀:', out)
    for b, res in results:
        n = len(res['orders'])
        q = sum(l['qty'] for o in res['orders'] for l in o['lines'] if l['no'] == 1)
        sales = sum(o['total'] for o in res['orders'])
        waits = [o['wait'] for o in res['orders']]
        print('%s: 주문 %d건 · %d개 · 매출 %s원 · 품절 %s · 줄포기 %d · 품절못삼 %d · 평균대기 %.1f분 · 최장 %d분 · 남음 %d%s' % (
            b['name'], n, q, format(sales, ','), hm(res['soldout_at']) if res['soldout_at'] is not None else '없음',
            res['lost_long'], res['lost_soldout'], sum(waits) / len(waits), max(waits), res['left'],
            (' · 콜라 %d캔 남음(품절 %s)' % (res['cola_left'], hm(res['cola_out_at']) if res['cola_out_at'] is not None else '없음')) if b.get('addon') else ''))
        for m, t in res['log']:
            print('   ', hm(m), t)


if __name__ == '__main__':
    main()

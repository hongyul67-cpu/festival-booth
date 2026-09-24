/* app.js — 축제 부스 장부
 *
 * 원칙 세 가지
 *  1) 파는 사람은 메뉴를 누르고 결제 방법만 고른다. 나머지는 앱이 알아서 한다.
 *  2) 재고는 값을 직접 고쳐 쓰지 않고 사건 목록에서 매번 계산한다.
 *     재고 = Σ입고 − Σ판매(레시피 소모) − Σ폐기
 *     그래야 판매 취소가 안전하고, 숫자가 어긋나도 원인을 되짚을 수 있다.
 *  3) 사진·가격은 축제 당일 아침에 그 자리에서 바꿀 수 있어야 한다.
 */
(function () {
  'use strict';

  var KEY = 'festival_booth_v1';
  var PAYS = [['현금', ''], ['이체', 'b2'], ['쿠폰', 'b3']];

  /* ================= 메뉴 꾸러미 ================= */
  // 매입가는 장을 봐야 아는 값이라 0으로 둔다. 판매가는 고치기 쉽게 어림값만 넣어 둔다.
  var PRESETS = {
    ours: {
      name: '대패삼겹살',
      items: [
        { id: 'i1', name: '대패삼겹살', unit: 'g', packQty: 1000, packPrice: 0 },
        { id: 'i2', name: '콜라(캔)', unit: '개', packQty: 24, packPrice: 0 },
        { id: 'i3', name: '접시', unit: '개', packQty: 50, packPrice: 0 },
        { id: 'i4', name: '젓가락', unit: '개', packQty: 100, packPrice: 0 }
      ],
      menus: [
        { id: 'm1', name: '대패삼겹살', price: 3000, photo: '', recipe: [
          { itemId: 'i1', qty: 120 }, { itemId: 'i3', qty: 1 }, { itemId: 'i4', qty: 1 }] },
        { id: 'm2', name: '콜라 추가', price: 500, photo: '', recipe: [{ itemId: 'i2', qty: 1 }] }
      ]
    },
    bingsu: {
      name: '빙수',
      items: [
        { id: 'i1', name: '얼음', unit: 'g', packQty: 1000, packPrice: 0 },
        { id: 'i2', name: '연유', unit: 'ml', packQty: 500, packPrice: 0 },
        { id: 'i3', name: '팥', unit: 'g', packQty: 500, packPrice: 0 },
        { id: 'i4', name: '떡', unit: '개', packQty: 30, packPrice: 0 },
        { id: 'i5', name: '빙수 컵', unit: '개', packQty: 50, packPrice: 0 },
        { id: 'i6', name: '숟가락', unit: '개', packQty: 100, packPrice: 0 }
      ],
      menus: [
        { id: 'm1', name: '빙수', price: 3000, photo: '', recipe: [
          { itemId: 'i1', qty: 200 }, { itemId: 'i2', qty: 30 }, { itemId: 'i3', qty: 50 },
          { itemId: 'i4', qty: 3 }, { itemId: 'i5', qty: 1 }, { itemId: 'i6', qty: 1 }] }
      ]
    },
    takoyaki: {
      name: '타코야끼',
      items: [
        { id: 'i1', name: '타코야끼(냉동)', unit: '알', packQty: 50, packPrice: 0 },
        { id: 'i2', name: '소스', unit: 'ml', packQty: 500, packPrice: 0 },
        { id: 'i3', name: '가쓰오부시', unit: 'g', packQty: 100, packPrice: 0 },
        { id: 'i4', name: '종이 용기', unit: '개', packQty: 50, packPrice: 0 },
        { id: 'i5', name: '이쑤시개', unit: '개', packQty: 100, packPrice: 0 }
      ],
      menus: [
        { id: 'm1', name: '타코야끼', price: 2000, photo: '', recipe: [
          { itemId: 'i1', qty: 5 }, { itemId: 'i2', qty: 15 }, { itemId: 'i3', qty: 2 },
          { itemId: 'i4', qty: 1 }, { itemId: 'i5', qty: 1 }] }
      ]
    }
  };

  /* ================= 상태 ================= */
  var S = null;

  function blank() {
    return {
      boothName: '', preset: '',
      account: { bank: '', number: '', holder: '', link: '' },  // 학생들에게 받아 나중에 채운다
      items: [], menus: [],
      plan: {}, purchases: [], sales: [], adjusts: [], counted: {}, menuLog: [],
      cash0: 0, ledgerMode: 'simple', soldout: {}
    };
  }

  /* ---- 부스 여러 개: 부스마다 메뉴·사진·재고·판매 기록을 따로 저장한다 ----
   * 목록은 LIST_KEY 에, 부스 하나의 장부는 keyOf(id) 에 둔다.
   * 첫 부스(b1)는 예전 저장 자리(KEY)를 그대로 써서, 이미 쓰던 기록이 사라지지 않게 한다. */
  var LIST_KEY = 'festival_booth_list';
  var BL = null;   // { cur: 'b1', booths: [{ id, name }] }

  function keyOf(id) { return id === 'b1' ? KEY : KEY + '_' + id; }

  function loadList() {
    try { BL = JSON.parse(localStorage.getItem(LIST_KEY) || 'null'); } catch (e) { BL = null; }
    if (!BL || !BL.booths || !BL.booths.length) BL = { cur: 'b1', booths: [{ id: 'b1', name: '' }] };
    if (!boothInfo(BL.cur)) BL.cur = BL.booths[0].id;
  }
  function saveList() { try { localStorage.setItem(LIST_KEY, JSON.stringify(BL)); } catch (e) { } }
  function boothInfo(id) {
    for (var i = 0; i < BL.booths.length; i++) if (BL.booths[i].id === id) return BL.booths[i];
    return null;
  }

  function load() {
    loadList();
    try {
      var raw = localStorage.getItem(keyOf(BL.cur));
      if (raw) {
        S = Object.assign(blank(), JSON.parse(raw));
        if (!S.account) S.account = { bank: '', number: '', holder: '', link: '' };
        if (!S.soldout) S.soldout = {};
        if (!S.menuLog) S.menuLog = [];
        return;
      }
    } catch (e) { /* 못 읽으면 새로 시작 */ }
    S = blank();
  }

  var saveWarned = false;
  function save() {
    var bi = boothInfo(BL.cur);
    if (bi && bi.name !== S.boothName) { bi.name = S.boothName; saveList(); }
    try { localStorage.setItem(keyOf(BL.cur), JSON.stringify(S)); }
    catch (e) {
      if (!saveWarned) {
        saveWarned = true;
        alert('저장 공간이 가득 찼습니다.\n메뉴 사진을 몇 장 지우면 됩니다.\n\n종이 기록도 꼭 함께 해 주세요.');
      }
    }
  }

  /* ================= 계산 ================= */
  function uid() { return Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-4); }
  function won(n) { return (Math.round(n) || 0).toLocaleString('ko-KR'); }
  function num(v) { var n = parseFloat(v); return isFinite(n) ? n : 0; }
  function round1(n) { return Math.round(n * 10) / 10; }

  function item(id) { for (var i = 0; i < S.items.length; i++) if (S.items[i].id === id) return S.items[i]; return null; }
  function menu(id) { for (var i = 0; i < S.menus.length; i++) if (S.menus[i].id === id) return S.menus[i]; return null; }
  function unitCost(it) { return (!it || !it.packQty) ? 0 : num(it.packPrice) / num(it.packQty); }

  function stockIn(id) {
    var it = item(id), s = 0;
    if (!it) return 0;
    for (var i = 0; i < S.purchases.length; i++) {
      if (S.purchases[i].itemId === id) s += num(S.purchases[i].packs) * num(it.packQty);
    }
    return s;
  }
  function usedBySales(id) {
    var s = 0;
    for (var i = 0; i < S.sales.length; i++) {
      for (var j = 0; j < S.sales[i].lines.length; j++) {
        var ln = S.sales[i].lines[j], mn = menu(ln.menuId);
        if (!mn) continue;
        for (var k = 0; k < mn.recipe.length; k++) {
          if (mn.recipe[k].itemId === id) s += num(mn.recipe[k].qty) * num(ln.qty);
        }
      }
    }
    return s;
  }
  function adjusted(id) {
    var s = 0;
    for (var i = 0; i < S.adjusts.length; i++) if (S.adjusts[i].itemId === id) s += num(S.adjusts[i].qty);
    return s;
  }
  function stock(id) { return stockIn(id) - usedBySales(id) - adjusted(id); }

  function menuCost(mn) {
    var c = 0;
    for (var i = 0; i < mn.recipe.length; i++) c += unitCost(item(mn.recipe[i].itemId)) * num(mn.recipe[i].qty);
    return c;
  }

  // 지금 재고로 몇 개까지 만들 수 있나. 재료를 하나도 안 산 상태면 제한하지 않는다.
  function makeable(mn) {
    if (!mn.recipe.length) return Infinity;
    if (!S.purchases.length) return Infinity;
    var min = Infinity;
    for (var i = 0; i < mn.recipe.length; i++) {
      var need = num(mn.recipe[i].qty);
      if (need <= 0) continue;
      min = Math.min(min, Math.floor(stock(mn.recipe[i].itemId) / need));
    }
    return min === Infinity ? Infinity : Math.max(0, min);
  }
  // 메뉴별 수량 — 재료 계산과 별개로 "오늘 몇 개 준비했나"를 직접 적어 두는 방식.
  // 준비(누적) − 팔림 = 남음. 준비를 안 적은 메뉴는 재료 재고로만 판단한다.
  function hasReady(mn) { return mn.ready !== undefined && mn.ready !== null && mn.ready !== ''; }
  function left(mn) {
    var m = makeable(mn);
    if (!hasReady(mn)) return m;
    return Math.max(0, Math.min(num(mn.ready) - soldQty(mn.id), m));
  }
  function leftText(mn) { var n = left(mn); return n === Infinity ? '' : '남은 ' + n + '개'; }
  function isSoldout(mn) { return !!S.soldout[mn.id] || left(mn) <= 0; }

  function salesTotal(pay) {
    var s = 0;
    for (var i = 0; i < S.sales.length; i++) if (!pay || S.sales[i].pay === pay) s += num(S.sales[i].total);
    return s;
  }
  function soldQty(menuId) {
    var s = 0;
    for (var i = 0; i < S.sales.length; i++) {
      for (var j = 0; j < S.sales[i].lines.length; j++) {
        if (S.sales[i].lines[j].menuId === menuId) s += num(S.sales[i].lines[j].qty);
      }
    }
    return s;
  }
  function spentTotal() {
    var s = 0;
    for (var i = 0; i < S.purchases.length; i++) s += num(S.purchases[i].cost);
    return s;
  }
  function cogs() {
    var s = 0;
    for (var i = 0; i < S.sales.length; i++) {
      for (var j = 0; j < S.sales[i].lines.length; j++) {
        var mn = menu(S.sales[i].lines[j].menuId);
        if (mn) s += menuCost(mn) * num(S.sales[i].lines[j].qty);
      }
    }
    return s;
  }
  function lossCost() {
    var s = 0;
    for (var i = 0; i < S.adjusts.length; i++) s += unitCost(item(S.adjusts[i].itemId)) * num(S.adjusts[i].qty);
    return s;
  }

  /* ================= 화면 도우미 ================= */
  var cart = [];
  var view = 'sell';

  function $(s) { return document.querySelector(s); }
  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined && text !== null) e.textContent = text;
    return e;
  }
  function go(v) { view = v; render(); }

  function toast(msg) {
    var t = el('div', 'toast', msg);
    document.body.appendChild(t);
    setTimeout(function () { if (t.parentNode) t.parentNode.removeChild(t); }, 1600);
  }

  function modal(build) {
    var back = el('div', 'modalBack');
    var box = el('div', 'modal');
    build(box, function () { if (back.parentNode) document.body.removeChild(back); });
    back.appendChild(box);
    back.onclick = function (e) { if (e.target === back) document.body.removeChild(back); };
    document.body.appendChild(back);
  }

  function render() {
    var root = $('#screen');
    root.innerHTML = '';
    applyTheme();
    if (!S.menus.length) mode = 'admin';
    document.body.classList.toggle('guest', mode === 'guest');
    if (mode === 'guest') { viewGuest(root); return; }
    if (!S.menus.length && view !== 'setup') view = 'setup';
    ({ sell: viewSell, board: viewBoard, stock: viewStock, close: viewClose, setup: viewSetup }[view] || viewSell)(root);

    var tabs = document.querySelectorAll('#tabs button');
    for (var i = 0; i < tabs.length; i++) tabs[i].classList.toggle('on', tabs[i].dataset.v === view);
    $('#boothName').textContent = (S.boothName || '축제 부스') + ' ▾';
    $('#headSum').textContent = S.sales.length ? (won(salesTotal()) + '원 · ' + S.sales.length + '건') : '';
  }

  /* ================= 판매 ================= */
  function cartTotal() {
    var t = 0;
    for (var i = 0; i < cart.length; i++) {
      var mn = menu(cart[i].menuId);
      if (mn) t += mn.price * cart[i].qty;
    }
    return t;
  }
  function addCart(id) {
    for (var i = 0; i < cart.length; i++) if (cart[i].menuId === id) { cart[i].qty++; render(); return; }
    cart.push({ menuId: id, qty: 1 });
    render();
  }

  function viewSell(root) {
    var grid = el('div', 'grid');
    S.menus.forEach(function (mn, idx) {
      var can = left(mn), out = isSoldout(mn);
      var b = el('button', 'menuBtn' + (out ? ' out' : (can <= 5 ? ' low' : '')));
      b.appendChild(el('span', 'noBadge', (idx + 1) + '번'));
      if (mn.photo) {
        var im = document.createElement('img');
        im.className = 'thumb';
        im.src = mn.photo;
        im.alt = '';
        b.appendChild(im);
      }
      b.appendChild(el('span', 'mName', mn.name));
      b.appendChild(el('span', 'mPrice', won(mn.price) + '원'));
      b.appendChild(el('span', 'mLeft',
        out ? '품절' : (can === Infinity ? ' ' : '남은 ' + can + '개')));
      b.onclick = function () {
        if (out && !confirm(mn.name + '은(는) 품절 표시 상태입니다. 그래도 팔까요?')) return;
        addCart(mn.id);
      };
      grid.appendChild(b);
    });
    root.appendChild(grid);

    var box = el('div', 'card');
    if (!cart.length) {
      box.appendChild(el('p', 'muted', '메뉴를 눌러 담으세요.'));
      var qb = el('button', 'miniBtn', '📱 금액 직접 넣어 송금 QR');
      qb.onclick = askQR;
      box.appendChild(qb);
    } else {
      cart.forEach(function (line, idx) {
        var mn = menu(line.menuId);
        var row = el('div', 'cartRow');
        row.appendChild(el('span', 'cName', mn.name));
        var minus = el('button', 'qtyBtn', '−');
        minus.onclick = function () {
          cart[idx].qty--;
          if (cart[idx].qty <= 0) cart.splice(idx, 1);
          render();
        };
        var plus = el('button', 'qtyBtn', '+');
        plus.onclick = function () { cart[idx].qty++; render(); };
        row.appendChild(minus);
        row.appendChild(el('span', 'cQty', String(line.qty)));
        row.appendChild(plus);
        row.appendChild(el('span', 'cSum', won(mn.price * line.qty)));
        box.appendChild(row);
      });
      var tot = el('div', 'total');
      tot.appendChild(el('span', null, '합계'));
      tot.appendChild(el('strong', null, won(cartTotal()) + '원'));
      box.appendChild(tot);

      var pays = el('div', 'payRow');
      PAYS.forEach(function (p) {
        var b = el('button', 'payBtn ' + p[1], p[0]);
        b.onclick = function () { startPay(p[0]); };
        pays.appendChild(b);
      });
      box.appendChild(pays);

      var clr = el('button', 'linkBtn', '비우기');
      clr.onclick = function () { cart = []; render(); };
      box.appendChild(clr);
    }
    root.appendChild(box);

    if (S.sales.length) {
      var last = S.sales[S.sales.length - 1];
      var c = el('div', 'card');
      c.appendChild(el('div', 'muted', '마지막 판매 · ' + won(last.total) + '원 (' + last.pay + ')'));
      var u = el('button', 'warnBtn', '↩ 방금 판매 취소');
      u.onclick = function () {
        if (confirm(won(last.total) + '원 판매를 취소합니다.\n재고도 함께 되돌아갑니다.')) {
          S.sales.pop(); save(); render(); toast('취소했습니다');
        }
      };
      c.appendChild(u);
      root.appendChild(c);
    }
  }

  function startPay(pay) {
    var total = cartTotal();
    if (total <= 0) return;
    if (pay === '현금') return payCash(total);
    if (pay === '이체') return payTransfer(total);
    finishSale(pay, 0, 0);
  }

  function payCash(total) {
    modal(function (box, close) {
      box.appendChild(el('h3', null, '현금 ' + won(total) + '원'));
      var got = el('input', 'bigInput');
      got.type = 'number'; got.inputMode = 'numeric'; got.placeholder = '받은 돈';
      box.appendChild(got);
      var chg = el('div', 'change', '거스름돈 —');
      box.appendChild(chg);
      function upd() {
        var r = num(got.value);
        chg.textContent = (got.value === '' || r < total) ? '거스름돈 —' : '거스름돈 ' + won(r - total) + '원';
      }
      got.oninput = upd;

      var quick = el('div', 'quickRow');
      var seen = {};
      [total, Math.ceil(total / 1000) * 1000, 5000, 10000, 20000, 50000].forEach(function (v) {
        if (v < total || seen[v]) return;
        seen[v] = 1;
        var b = el('button', 'quickBtn', v === total ? '딱 맞게' : won(v));
        b.onclick = function () { got.value = v; upd(); };
        quick.appendChild(b);
      });
      box.appendChild(quick);

      var ok = el('button', 'bigBtn', '완료');
      ok.onclick = function () {
        var r = num(got.value);
        if (got.value === '' || r < total) { alert('받은 돈이 합계보다 적습니다.'); return; }
        close();
        finishSale('현금', r, r - total);
      };
      box.appendChild(ok);
      setTimeout(function () { got.focus(); }, 60);
    });
  }

  function payTransfer(total) {
    modal(function (box, close) {
      box.appendChild(el('h3', null, '이체'));
      if (hasAccount()) box.appendChild(accountBox(total));
      else { var wrap = el('div', 'qrWrap'); box.appendChild(wrap); drawQR(wrap, total); }
      var ok = el('button', 'bigBtn', '입금 확인함 · 완료');
      ok.onclick = function () { close(); finishSale('이체', total, 0); };
      box.appendChild(ok);
      var no = el('button', 'linkBtn', '취소');
      no.onclick = close;
      box.appendChild(no);
    });
  }

  function finishSale(pay, received, change, by) {
    var lines = cart.map(function (l) {
      var mn = menu(l.menuId);
      return { menuId: l.menuId, no: menuNo(l.menuId), name: mn.name, price: mn.price, qty: l.qty };
    });
    var last = S.sales.length ? S.sales[S.sales.length - 1] : null;
    var sale = {
      id: uid(), no: (last && last.no ? last.no : S.sales.length) + 1, t: Date.now(),
      lines: lines, total: cartTotal(), pay: pay, received: received, change: change, by: by || '관리자'
    };
    S.sales.push(sale);
    cart = [];
    save();
    render();
    announce(sale);
  }

  /* ================= 송금 QR ================= */
  // amount 가 null 이면 금액 없는 계좌 안내만 만든다 (메뉴판에 걸어 두는 용도)
  function payString(amount) {
    var a = S.account;
    var noAmount = (amount === null || amount === undefined);
    if (a.link) {
      if (a.link.indexOf('{금액}') >= 0) return a.link.replace(/\{금액\}/g, noAmount ? '' : String(amount));
      return noAmount ? a.link : a.link.replace(/\/+$/, '') + '/' + amount;
    }
    if (a.bank || a.number) {
      var base = (a.bank + ' ' + a.number + ' ' + a.holder).trim();
      return noAmount ? base : base + ' ' + won(amount) + '원';
    }
    return '';
  }

  function drawQR(wrap, amount, label) {
    wrap.innerHTML = '';
    var text = payString(amount);
    if (!text) {
      var n = el('div', 'notice');
      n.appendChild(el('p', null, '계좌가 아직 비어 있어요'));
      n.appendChild(el('p', 'muted', '⚙️ 설정에서 계좌나 송금 링크를 넣으면 여기에 QR이 생깁니다.'));
      wrap.appendChild(n);
      return;
    }
    var q;
    try { q = QR.encode(text, 'M'); }
    catch (e) { wrap.appendChild(el('p', 'muted', '내용이 너무 길어 QR로 만들 수 없습니다.')); return; }

    // 여백 5칸. 규격 최소는 4칸이지만 넉넉해야 잘 읽힌다.
    var quiet = 5, n2 = q.size + quiet * 2;
    var scale = Math.max(3, Math.floor(Math.min(290, window.innerWidth - 96) / n2));
    var cv = el('canvas');
    cv.width = cv.height = n2 * scale;
    cv.style.width = cv.style.height = (n2 * scale) + 'px';
    var g = cv.getContext('2d');
    g.fillStyle = '#fff'; g.fillRect(0, 0, cv.width, cv.height);
    g.fillStyle = '#000';
    for (var r = 0; r < q.size; r++) {
      for (var c = 0; c < q.size; c++) {
        if (q.get(r, c)) g.fillRect((c + quiet) * scale, (r + quiet) * scale, scale, scale);
      }
    }
    wrap.appendChild(cv);
    wrap.appendChild(el('div', 'qrAmt', label !== undefined ? label : won(amount) + '원'));
    wrap.appendChild(el('div', 'qrText', text));
  }

  // 계좌 안내 — 은행 앱은 계좌 글자 QR을 못 읽으므로, 손님에게는 크게 적힌 계좌 + [복사] 단추를 보여 준다.
  // 송금 링크(토스·카카오페이 등)를 넣어 둔 부스만 QR을 함께 띄운다.
  function hasAccount() { var a = S.account; return !!(a.number || a.link); }
  function copyText(t) {
    function ok() { toast('복사했습니다. 은행 앱에 붙여 넣으세요'); }
    function old() {
      var ta = el('textarea'); ta.value = t; ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy'); ok(); } catch (e) { alert(t); }
      document.body.removeChild(ta);
    }
    if (navigator.clipboard && window.isSecureContext) navigator.clipboard.writeText(t).then(ok, old);
    else old();
  }
  function accountBox(amount) {
    var a = S.account;
    var box = el('div', 'acct');
    if (amount) box.appendChild(el('div', 'acctAmt', won(amount) + '원'));
    if (a.number) {
      box.appendChild(el('div', 'acctBank', (a.bank || '') + (a.holder ? ' · 예금주 ' + a.holder : '')));
      box.appendChild(el('div', 'acctNo', a.number));
      var cp = el('button', 'miniBtn go', '📋 계좌번호 복사');
      cp.onclick = function (e) { e.stopPropagation(); copyText(((a.bank || '') + ' ' + a.number).trim()); };
      box.appendChild(cp);
    }
    if (a.link) {
      var w = el('div', 'qrWrap');
      box.appendChild(w);
      drawQR(w, amount || null, amount ? won(amount) + '원' : '폰 카메라로 찍으면 송금 화면이 열립니다');
    }
    return box;
  }

  function askQR() {
    modal(function (box) {
      box.appendChild(el('h3', null, '송금 QR'));
      var inp = el('input', 'bigInput');
      inp.type = 'number'; inp.inputMode = 'numeric'; inp.placeholder = '금액';
      box.appendChild(inp);
      var wrap = el('div', 'qrWrap');
      box.appendChild(wrap);
      inp.oninput = function () {
        var v = num(inp.value);
        if (v > 0) drawQR(wrap, v); else wrap.innerHTML = '';
      };
      setTimeout(function () { inp.focus(); }, 60);
    });
  }

  /* ================= 메뉴판 ================= */
  function shrinkPhoto(file, cb) {
    var rd = new FileReader();
    rd.onload = function () {
      var img = new Image();
      img.onload = function () {
        var max = 640;
        var w = img.width, h = img.height;
        if (w > h && w > max) { h = Math.round(h * max / w); w = max; }
        else if (h >= w && h > max) { w = Math.round(w * max / h); h = max; }
        var cv = document.createElement('canvas');
        cv.width = w; cv.height = h;
        cv.getContext('2d').drawImage(img, 0, 0, w, h);
        cb(cv.toDataURL('image/jpeg', 0.72));
      };
      img.onerror = function () { alert('사진을 읽지 못했습니다.'); };
      img.src = rd.result;
    };
    rd.readAsDataURL(file);
  }

  function pickPhoto(mn, after) {
    var f = document.createElement('input');
    f.type = 'file';
    f.accept = 'image/*';
    f.onchange = function () {
      if (!f.files || !f.files[0]) return;
      shrinkPhoto(f.files[0], function (data) {
        mn.photo = data;
        save();
        after ? after() : render();
        toast('사진을 넣었습니다');
      });
    };
    f.click();
  }

  function boardCard(mn, editable) {
    var card = el('div', 'boardCard' + (!mn.photo && !editable ? ' noPh' : ''));
    card.appendChild(el('span', 'noBadge', menuNo(mn.id) + '번'));
    if (mn.photo) {
      var im = document.createElement('img');
      im.className = 'ph';
      im.src = mn.photo;
      im.alt = mn.name;
      if (editable) { im.style.cursor = 'pointer'; im.onclick = function () { pickPhoto(mn); }; }
      card.appendChild(im);
    } else if (editable) {
      var ph = el('div', 'ph empty', '📷 사진 넣기');
      ph.onclick = function () { pickPhoto(mn); };
      card.appendChild(ph);
    }
    // 손님용 화면에서는 사진이 없으면 빈 칸을 만들지 않는다

    var bd = el('div', 'bd');
    if (editable) {
      var nm = el('input', 'bn');
      nm.value = mn.name;
      nm.onchange = function () { mn.name = nm.value || '메뉴'; save(); render(); };
      bd.appendChild(nm);
      var pz = el('input', 'bp');
      pz.type = 'text';
      pz.inputMode = 'numeric';
      pz.value = won(mn.price) + '원';
      pz.onfocus = function () { pz.value = mn.price || ''; pz.select(); };
      pz.onblur = function () {
        mn.price = num(pz.value);
        pz.value = won(mn.price) + '원';
        save(); render();
      };
      bd.appendChild(pz);
      var cnt = el('div', 'bLeft', (leftText(mn) || '수량 제한 없음') + ' · 팔림 ' + soldQty(mn.id) + '개');
      bd.appendChild(cnt);
      // 사진은 메뉴마다 따로 넣고 뺀다
      var pr = el('div', 'phRow');
      var pBtn = el('button', 'miniBtn', mn.photo ? '📷 사진 바꾸기' : '📷 사진 넣기');
      pBtn.onclick = function () { pickPhoto(mn); };
      pr.appendChild(pBtn);
      if (mn.photo) {
        var pDel = el('button', 'miniBtn warn', '빼기');
        pDel.onclick = function () { if (!confirm(mn.name + ' 사진을 뺄까요?')) return; mn.photo = ''; save(); render(); };
        pr.appendChild(pDel);
      }
      var qBtn = el('button', 'miniBtn go', '🔢 수량');
      qBtn.onclick = function () { askReady(mn); };
      pr.appendChild(qBtn);
      bd.appendChild(pr);
    } else {
      bd.appendChild(el('div', 'bn', mn.name));
      bd.appendChild(el('div', 'bp', won(mn.price) + '원'));
      var lt = leftText(mn);
      if (lt && !isSoldout(mn)) bd.appendChild(el('div', 'bLeft', lt));
    }
    card.appendChild(bd);

    if (isSoldout(mn)) card.appendChild(el('div', 'soldout', '품 절'));
    return card;
  }

  function viewBoard(root) {
    var c = el('div', 'card');
    var head = el('div', 'rowBetween');
    head.appendChild(el('h3', null, '메뉴판'));
    var showBtn = el('button', 'miniBtn go', '👥 손님 화면으로');
    showBtn.onclick = enterGuest;
    head.appendChild(showBtn);
    c.appendChild(head);
    c.appendChild(el('p', 'muted', '메뉴마다 [📷 사진 넣기]로 사진을 따로 넣고, 가격을 누르면 그 자리에서 고칠 수 있습니다. [🔢 수량]으로 준비한 개수를 적으면 손님 메뉴판에 남은 개수가 보입니다.'));
    root.appendChild(c);

    var grid = el('div', 'boardGrid');
    S.menus.forEach(function (mn) { grid.appendChild(boardCard(mn, true)); });
    root.appendChild(grid);
    root.appendChild(accountCard());
    root.appendChild(themeCard());

    var c2 = el('div', 'card');
    c2.appendChild(el('h3', null, '품절 표시'));
    c2.appendChild(el('p', 'muted', '재료가 남아 있어도 손으로 품절을 걸 수 있습니다. 재료가 떨어지면 저절로 품절이 됩니다.'));
    S.menus.forEach(function (mn) {
      var r = el('div', 'formRow');
      r.appendChild(el('label', null, mn.name));
      var b = el('button', 'miniBtn' + (S.soldout[mn.id] ? ' warn' : ''), S.soldout[mn.id] ? '품절 해제' : '품절로');
      b.onclick = function () { S.soldout[mn.id] = !S.soldout[mn.id]; save(); render(); };
      r.appendChild(b);
      c2.appendChild(r);
    });
    var add = el('button', 'miniBtn', '+ 메뉴 추가');
    add.onclick = function () {
      S.menus.push({ id: uid(), name: '새 메뉴', price: 0, photo: '', recipe: [] });
      save(); render();
    };
    c2.appendChild(add);
    root.appendChild(c2);
  }

  /* ================= 손님 화면 / 관리자 잠금 ================= */
  // 손님 화면: 메뉴를 눌러 담고 [주문하기]만 할 수 있다. 가격·수량·기록은 못 건드린다.
  // 관리자 화면(판매·메뉴판 편집·재고·마감·설정)은 비밀번호를 넣어야 들어간다.
  var MODE_KEY = 'festival_booth_mode', PW_KEY = 'festival_booth_pw';
  var mode = 'admin';
  try { mode = localStorage.getItem(MODE_KEY) === 'guest' ? 'guest' : 'admin'; } catch (e) { }
  function adminPw() { try { return localStorage.getItem(PW_KEY) || '1234'; } catch (e) { return '1234'; } }  // 임시 비밀번호 1234

  function setMode(m) {
    mode = m;
    try { localStorage.setItem(MODE_KEY, m); } catch (e) { }
    cart = [];
    render();
    window.scrollTo(0, 0);
  }
  function enterGuest() {
    if (!S.menus.length) { alert('메뉴부터 만들어 주세요.'); return; }
    setMode('guest');
  }
  function askAdmin() {
    modal(function (box, close) {
      box.appendChild(el('h3', null, '🔒 관리자'));
      var inp = el('input', 'bigInput');
      inp.type = 'password'; inp.inputMode = 'numeric'; inp.placeholder = '비밀번호';
      box.appendChild(inp);
      var ok = el('button', 'bigBtn', '들어가기');
      function tryIt() {
        if (inp.value === adminPw()) { close(); setMode('admin'); toast('관리자 화면입니다'); }
        else { inp.value = ''; inp.focus(); toast('비밀번호가 틀렸습니다'); }
      }
      ok.onclick = tryIt;
      inp.onkeydown = function (e) { if (e.key === 'Enter') tryIt(); };
      box.appendChild(ok);
      var no = el('button', 'linkBtn', '닫기');
      no.onclick = close;
      box.appendChild(no);
      setTimeout(function () { inp.focus(); }, 60);
    });
  }

  function viewGuest(root) {
    var top = el('div', 'gHead');
    top.appendChild(el('h2', null, S.boothName || '메뉴'));
    var lock = el('button', 'lockBtn', '🔒');
    lock.setAttribute('aria-label', '관리자');
    lock.onclick = askAdmin;
    top.appendChild(lock);
    root.appendChild(top);
    root.appendChild(el('p', 'gHint', '먹고 싶은 메뉴를 누르고 [주문하기]를 눌러 주세요.'));

    var grid = el('div', 'boardGrid');
    S.menus.forEach(function (mn) {
      var c = boardCard(mn, false);
      var out = isSoldout(mn);
      c.classList.add('tap');
      var inCart = 0;
      cart.forEach(function (l) { if (l.menuId === mn.id) inCart = l.qty; });
      if (inCart) c.appendChild(el('span', 'inCart', inCart));
      c.onclick = function () {
        if (out) { toast('품절입니다'); return; }
        if (inCart + 1 > left(mn)) { toast('남은 수량이 ' + left(mn) + '개입니다'); return; }
        addCart(mn.id);
      };
      grid.appendChild(c);
    });
    root.appendChild(grid);

    if (cart.length) {
      var bar = el('div', 'gCart');
      cart.forEach(function (line, idx) {
        var mn = menu(line.menuId);
        var row = el('div', 'cartRow');
        row.appendChild(el('span', 'cName', menuNo(mn.id) + '번 ' + mn.name));
        var minus = el('button', 'qtyBtn', '−');
        minus.onclick = function () { cart[idx].qty--; if (cart[idx].qty <= 0) cart.splice(idx, 1); render(); };
        var plus = el('button', 'qtyBtn', '+');
        plus.onclick = function () {
          if (cart[idx].qty + 1 > left(mn)) { toast('남은 수량이 ' + left(mn) + '개입니다'); return; }
          cart[idx].qty++; render();
        };
        row.appendChild(minus);
        row.appendChild(el('span', 'cQty', String(line.qty)));
        row.appendChild(plus);
        row.appendChild(el('span', 'cSum', won(mn.price * line.qty)));
        bar.appendChild(row);
      });
      var tot = el('div', 'total');
      tot.appendChild(el('span', null, '합계'));
      tot.appendChild(el('strong', null, won(cartTotal()) + '원'));
      bar.appendChild(tot);
      var go2 = el('button', 'bigBtn orderBtn', '🔔 주문하기');
      go2.onclick = guestPay;
      bar.appendChild(go2);
      var clr = el('button', 'linkBtn', '다시 고르기');
      clr.onclick = function () { cart = []; render(); };
      bar.appendChild(clr);
      root.appendChild(bar);
    } else if (hasAccount()) {
      var qc = el('div', 'card');
      qc.appendChild(el('h3', null, '💳 계좌이체도 됩니다'));
      qc.appendChild(accountBox(null));
      root.appendChild(qc);
    }
  }

  // 손님이 [주문하기]를 누르면 계산 방법만 고르게 한다. 돈은 부스 사람이 받는다.
  function guestPay() {
    var total = cartTotal();
    if (total <= 0) return;
    modal(function (box, close) {
      box.appendChild(el('h3', null, '합계 ' + won(total) + '원'));
      box.appendChild(el('p', 'muted', '어떻게 계산하시겠어요?'));
      var cash = el('button', 'bigBtn', '💵 현금으로 낼게요');
      cash.onclick = function () { close(); finishSale('현금', total, 0, '손님'); };
      box.appendChild(cash);
      if (hasAccount()) {
        var tr = el('button', 'bigBtn blueBtn', '📱 계좌이체');
        tr.onclick = function () {
          box.innerHTML = '';
          box.appendChild(el('h3', null, '계좌이체'));
          box.appendChild(accountBox(total));
          box.appendChild(el('p', 'muted', '보낸 뒤 부스 사람에게 이체 화면을 보여 주세요.'));
          var ok = el('button', 'bigBtn', '보냈어요 · 주문하기');
          ok.onclick = function () { close(); finishSale('이체', total, 0, '손님'); };
          box.appendChild(ok);
          var no2 = el('button', 'linkBtn', '취소');
          no2.onclick = close;
          box.appendChild(no2);
        };
        box.appendChild(tr);
      }
      var no = el('button', 'linkBtn', '취소');
      no.onclick = close;
      box.appendChild(no);
    });
  }

  /* ================= 메뉴별 수량 (준비·팔림·남음) ================= */
  function logMenu(mn, kind, qty, note) {
    S.menuLog.push({ id: uid(), t: Date.now(), menuId: mn.id, name: mn.name, kind: kind, qty: qty, note: note || '' });
  }

  function askReady(mn) {
    modal(function (box, close) {
      var sold = soldQty(mn.id);
      box.appendChild(el('h3', null, menuNo(mn.id) + '번 ' + mn.name + ' 수량'));
      var info = el('div', 'qtyInfo');
      [['준비', hasReady(mn) ? num(mn.ready) + '개' : '안 적음'], ['팔림', sold + '개'],
       ['남음', hasReady(mn) ? Math.max(0, num(mn.ready) - sold) + '개' : '—']].forEach(function (p) {
        var d = el('div');
        d.appendChild(el('small', null, p[0]));
        d.appendChild(el('strong', null, p[1]));
        info.appendChild(d);
      });
      box.appendChild(info);

      box.appendChild(el('p', 'muted', hasReady(mn) ? '더 만들었으면 추가한 개수를 적으세요.' : '오늘 처음 준비한 개수를 적으세요.'));
      var add = el('input', 'bigInput');
      add.type = 'number'; add.inputMode = 'numeric'; add.placeholder = hasReady(mn) ? '추가 개수' : '준비 개수';
      box.appendChild(add);
      var ok = el('button', 'bigBtn', hasReady(mn) ? '+ 추가하기' : '준비 수량 저장');
      ok.onclick = function () {
        var v = Math.round(num(add.value));
        if (v <= 0) { alert('1 이상의 개수를 적어 주세요.'); return; }
        var first = !hasReady(mn);
        mn.ready = (first ? 0 : num(mn.ready)) + v;
        logMenu(mn, first ? '처음 준비' : '추가 준비', v);
        save(); close(); render(); toast(mn.name + ' ' + v + '개 ' + (first ? '준비' : '추가'));
      };
      box.appendChild(ok);

      if (hasReady(mn)) {
        box.appendChild(el('p', 'muted', '실제로 세어 보니 남은 개수가 다르면 여기서 고치세요. (폐기·서비스 등)'));
        var fix = el('input');
        fix.type = 'number'; fix.inputMode = 'numeric'; fix.placeholder = '실제 남은 개수';
        box.appendChild(fix);
        var fb = el('button', 'miniBtn', '남은 개수 고치기');
        fb.onclick = function () {
          if (fix.value === '') { alert('남은 개수를 적어 주세요.'); return; }
          var want = Math.max(0, Math.round(num(fix.value)));
          var before = Math.max(0, num(mn.ready) - sold);
          mn.ready = sold + want;
          logMenu(mn, '남은 개수 수정', want - before, before + '개 → ' + want + '개');
          save(); close(); render(); toast('남은 개수를 ' + want + '개로 고쳤습니다');
        };
        box.appendChild(fb);
        var rm = el('button', 'linkBtn', '수량 관리 끄기 (제한 없이 팔기)');
        rm.onclick = function () {
          if (!confirm('이 메뉴의 준비 수량을 지웁니다. 판매 기록은 그대로 남습니다.')) return;
          delete mn.ready;
          logMenu(mn, '수량 관리 끔', 0);
          save(); close(); render();
        };
        box.appendChild(rm);
      }
      var no = el('button', 'linkBtn', '닫기');
      no.onclick = close;
      box.appendChild(no);
      setTimeout(function () { add.focus(); }, 60);
    });
  }

  function menuQtyCard() {
    var c = el('div', 'card');
    c.appendChild(el('h3', null, '🔢 메뉴별 수량'));
    c.appendChild(el('p', 'muted', '준비한 개수를 적어 두면 팔 때마다 남은 개수가 줄고, 손님 메뉴판에도 보입니다. [수정]으로 언제든 추가하거나 고칠 수 있습니다.'));
    var t = el('table', 'tbl');
    var h = el('tr');
    ['메뉴', '준비', '팔림', '남음', ''].forEach(function (x, i) { h.appendChild(el('th', i && i < 4 ? 'r' : null, x)); });
    t.appendChild(h);
    S.menus.forEach(function (mn) {
      var tr = el('tr');
      var sold = soldQty(mn.id);
      var lf = left(mn);
      if (lf <= 0) tr.className = 'zero';
      tr.appendChild(el('td', null, menuNo(mn.id) + '번 ' + mn.name));
      tr.appendChild(el('td', 'r', hasReady(mn) ? String(num(mn.ready)) : '—'));
      tr.appendChild(el('td', 'r', String(sold)));
      tr.appendChild(el('td', 'r big', lf === Infinity ? '—' : String(lf)));
      var td = el('td', 'r');
      var b = el('button', 'miniBtn go', '수정');
      b.onclick = function () { askReady(mn); };
      td.appendChild(b);
      tr.appendChild(td);
      t.appendChild(tr);
    });
    c.appendChild(t);

    if (S.menuLog.length) {
      var f = el('p', 'muted fold', '▸ 수량 기록 ' + S.menuLog.length + '건 보기');
      var list = el('div');
      list.style.display = 'none';
      f.onclick = function () {
        var open = list.style.display === 'none';
        list.style.display = open ? '' : 'none';
        f.textContent = (open ? '▾' : '▸') + ' 수량 기록 ' + S.menuLog.length + '건 ' + (open ? '접기' : '보기');
      };
      S.menuLog.slice().reverse().forEach(function (g) {
        var d = new Date(g.t);
        var hm = ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2);
        list.appendChild(el('div', 'muted', hm + ' · ' + g.name + ' · ' + g.kind +
          (g.qty ? ' ' + (g.qty > 0 ? '+' : '') + g.qty + '개' : '') + (g.note ? ' (' + g.note + ')' : '')));
      });
      c.appendChild(f);
      c.appendChild(list);
    }
    return c;
  }

  /* ================= 재고 (장보기 포함) ================= */
  function viewStock(root) {
    root.appendChild(menuQtyCard());

    // 장보기 계산기
    var c0 = el('div', 'card');
    var h0 = el('div', 'rowBetween fold');
    h0.appendChild(el('h3', null, '🛒 장보기 계산기'));
    var arrow = el('span', 'muted', S.shopOpen ? '접기 ▾' : '펼치기 ▸');
    h0.appendChild(arrow);
    h0.onclick = function () { S.shopOpen = !S.shopOpen; save(); render(); };
    c0.appendChild(h0);
    if (S.shopOpen) {
      c0.appendChild(el('p', 'muted', '몇 개나 팔 것 같은지 넣으면 살 재료와 예상 지출이 계산됩니다.'));
      S.menus.forEach(function (mn) {
        var r = el('div', 'formRow');
        r.appendChild(el('label', null, mn.name));
        var i = el('input');
        i.type = 'number'; i.inputMode = 'numeric';
        i.value = S.plan[mn.id] || ''; i.placeholder = '0';
        i.oninput = function () { S.plan[mn.id] = num(i.value); save(); renderShopResult(); };
        r.appendChild(i);
        c0.appendChild(r);
      });
      var res = el('div');
      res.id = 'shopResult';
      c0.appendChild(res);
    }
    root.appendChild(c0);
    if (S.shopOpen) renderShopResult();

    // 남은 재료
    var c = el('div', 'card');
    c.appendChild(el('h3', null, '📦 남은 재료'));
    if (!S.items.length) {
      c.appendChild(el('p', 'muted', '재료가 없습니다. 설정에서 추가하세요.'));
    } else {
      var tbl = el('table', 'tbl');
      var head = el('tr');
      ['재료', '남음', '', ''].forEach(function (h) { head.appendChild(el('th', null, h)); });
      tbl.appendChild(head);
      S.items.forEach(function (it) {
        var s = stock(it.id);
        var tr = el('tr', s <= 0 && S.purchases.length ? 'zero' : '');
        tr.appendChild(el('td', null, it.name));
        tr.appendChild(el('td', null, round1(s) + it.unit));
        var t1 = el('td');
        var bi = el('button', 'miniBtn go', '입고');
        bi.onclick = function () { askPurchase(it); };
        t1.appendChild(bi);
        tr.appendChild(t1);
        var t2 = el('td');
        var bo = el('button', 'miniBtn warn', '폐기');
        bo.onclick = function () { askAdjust(it); };
        t2.appendChild(bo);
        tr.appendChild(t2);
        tbl.appendChild(tr);
      });
      c.appendChild(tbl);
    }
    root.appendChild(c);

    var c2 = el('div', 'card');
    c2.appendChild(el('h3', null, '지금 만들 수 있는 개수'));
    S.menus.forEach(function (mn) {
      var r = el('div', 'formRow');
      r.appendChild(el('label', null, mn.name));
      var m = makeable(mn);
      r.appendChild(el('span', 'big', m === Infinity ? '—' : m + '개'));
      c2.appendChild(r);
    });
    if (!S.purchases.length) c2.appendChild(el('p', 'muted', '아직 입고 기록이 없어 재고를 세지 않습니다.'));
    root.appendChild(c2);

    if (S.adjusts.length) {
      var c3 = el('div', 'card');
      c3.appendChild(el('h3', null, '폐기 · 서비스'));
      S.adjusts.slice().reverse().forEach(function (a) {
        var it = item(a.itemId);
        c3.appendChild(el('div', 'muted', (it ? it.name : '?') + ' ' + a.qty + (it ? it.unit : '') + ' — ' + a.reason));
      });
      root.appendChild(c3);
    }
  }

  function shopNeeds() {
    var need = {};
    S.menus.forEach(function (mn) {
      var q = num(S.plan[mn.id]);
      if (q <= 0) return;
      mn.recipe.forEach(function (r) { need[r.itemId] = (need[r.itemId] || 0) + num(r.qty) * q; });
    });
    return need;
  }

  function renderShopResult() {
    var box = document.getElementById('shopResult');
    if (!box) return;
    box.innerHTML = '';
    var need = shopNeeds();
    var ids = Object.keys(need);
    if (!ids.length) { box.appendChild(el('p', 'muted', '위에 예상 수량을 넣어 주세요.')); return; }

    var tbl = el('table', 'tbl');
    var head = el('tr');
    ['재료', '필요', '살 묶음', '금액'].forEach(function (h) { head.appendChild(el('th', null, h)); });
    tbl.appendChild(head);

    var total = 0, noPrice = [];
    ids.forEach(function (id) {
      var it = item(id);
      if (!it) return;
      var short = Math.max(0, need[id] - stock(id));
      var packs = it.packQty > 0 ? Math.ceil(short / it.packQty) : 0;
      var cost = packs * num(it.packPrice);
      total += cost;
      if (!num(it.packPrice)) noPrice.push(it.name);
      var tr = el('tr');
      tr.appendChild(el('td', null, it.name));
      tr.appendChild(el('td', null, round1(need[id]) + it.unit));
      tr.appendChild(el('td', null, packs + '묶음'));
      tr.appendChild(el('td', 'r', num(it.packPrice) ? won(cost) : '단가?'));
      tbl.appendChild(tr);
    });
    box.appendChild(tbl);

    var sum = el('div', 'total');
    sum.appendChild(el('span', null, '예상 지출'));
    sum.appendChild(el('strong', null, won(total) + '원'));
    box.appendChild(sum);

    if (noPrice.length) box.appendChild(el('p', 'warn', '단가 없음: ' + noPrice.join(', ')));
    box.appendChild(el('p', 'muted', '묶음 단위로만 살 수 있어서 필요량보다 늘 조금 더 사게 됩니다. 남는 만큼은 그대로 손실입니다.'));

    var btn = el('button', 'bigBtn', '장 봤음 → 재고에 넣기');
    btn.onclick = function () {
      if (!confirm('위 묶음 수량대로 재고에 넣습니다.')) return;
      ids.forEach(function (id) {
        var it = item(id);
        if (!it) return;
        var short = Math.max(0, need[id] - stock(id));
        var packs = it.packQty > 0 ? Math.ceil(short / it.packQty) : 0;
        if (packs > 0) S.purchases.push({ id: uid(), t: Date.now(), itemId: id, packs: packs, cost: packs * num(it.packPrice) });
      });
      save(); toast('재고에 넣었습니다'); render();
    };
    box.appendChild(btn);
  }

  function askPurchase(it) {
    modal(function (box, close) {
      box.appendChild(el('h3', null, it.name + ' 입고'));
      box.appendChild(el('p', 'muted', '1묶음 = ' + it.packQty + it.unit));
      var packs = el('input', 'bigInput');
      packs.type = 'number'; packs.inputMode = 'numeric'; packs.placeholder = '묶음 수';
      box.appendChild(packs);
      var cost = el('input', 'bigInput');
      cost.type = 'number'; cost.inputMode = 'numeric'; cost.placeholder = '쓴 돈 (원)';
      box.appendChild(cost);
      var ok = el('button', 'bigBtn', '넣기');
      ok.onclick = function () {
        var p = num(packs.value);
        if (p <= 0) { alert('묶음 수를 넣어 주세요.'); return; }
        var c = num(cost.value) || p * num(it.packPrice);
        S.purchases.push({ id: uid(), t: Date.now(), itemId: it.id, packs: p, cost: c });
        if (!num(it.packPrice) && c > 0) it.packPrice = c / p;   // 단가를 몰랐으면 이번 매입가로 채운다
        save(); close(); render();
      };
      box.appendChild(ok);
      setTimeout(function () { packs.focus(); }, 60);
    });
  }

  function askAdjust(it) {
    modal(function (box, close) {
      box.appendChild(el('h3', null, it.name + ' 빼기'));
      var qty = el('input', 'bigInput');
      qty.type = 'number'; qty.inputMode = 'decimal'; qty.placeholder = '수량 (' + it.unit + ')';
      box.appendChild(qty);
      var chosen = { v: '폐기' };
      var row = el('div', 'quickRow');
      ['폐기', '서비스', '시식', '떨어뜨림', '계량 오차'].forEach(function (r) {
        var b = el('button', 'quickBtn' + (r === '폐기' ? ' on' : ''), r);
        b.onclick = function () {
          chosen.v = r;
          var all = row.querySelectorAll('button');
          for (var i = 0; i < all.length; i++) all[i].classList.remove('on');
          b.classList.add('on');
        };
        row.appendChild(b);
      });
      box.appendChild(row);
      var ok = el('button', 'bigBtn', '빼기');
      ok.onclick = function () {
        var q = num(qty.value);
        if (q <= 0) { alert('수량을 넣어 주세요.'); return; }
        S.adjusts.push({ id: uid(), t: Date.now(), itemId: it.id, qty: q, reason: chosen.v });
        save(); close(); render();
      };
      box.appendChild(ok);
      setTimeout(function () { qty.focus(); }, 60);
    });
  }

  /* ================= 마감 ================= */
  function viewClose(root) {
    var c1 = el('div', 'card');
    c1.appendChild(el('h3', null, '오늘 판 것'));
    if (!S.sales.length) c1.appendChild(el('p', 'muted', '아직 판매 기록이 없습니다.'));
    else {
      var t1 = el('table', 'tbl');
      var h1 = el('tr');
      ['메뉴', '개수', '매출'].forEach(function (h) { h1.appendChild(el('th', null, h)); });
      t1.appendChild(h1);
      S.menus.forEach(function (mn) {
        var q = soldQty(mn.id);
        if (!q) return;
        var tr = el('tr');
        tr.appendChild(el('td', null, mn.name));
        tr.appendChild(el('td', null, q + '개'));
        tr.appendChild(el('td', 'r', won(q * mn.price)));
        t1.appendChild(tr);
      });
      c1.appendChild(t1);
    }
    var tot = el('div', 'total');
    tot.appendChild(el('span', null, '총매출'));
    tot.appendChild(el('strong', null, won(salesTotal()) + '원'));
    c1.appendChild(tot);
    PAYS.forEach(function (p) {
      var r = el('div', 'formRow');
      r.appendChild(el('label', null, p[0]));
      r.appendChild(el('span', null, won(salesTotal(p[0])) + '원'));
      c1.appendChild(r);
    });
    root.appendChild(c1);

    var c2 = el('div', 'card');
    c2.appendChild(el('h3', null, '💵 현금 맞춰보기'));
    var r0 = el('div', 'formRow');
    r0.appendChild(el('label', null, '준비한 거스름돈'));
    var i0 = el('input');
    i0.type = 'number'; i0.inputMode = 'numeric'; i0.value = S.cash0 || '';
    i0.oninput = function () { S.cash0 = num(i0.value); save(); r1v.textContent = won(num(S.cash0) + salesTotal('현금')) + '원'; };
    r0.appendChild(i0);
    c2.appendChild(r0);
    var r1 = el('div', 'formRow');
    r1.appendChild(el('label', null, '통에 있어야 할 현금'));
    var r1v = el('span', 'big', won(num(S.cash0) + salesTotal('현금')) + '원');
    r1.appendChild(r1v);
    c2.appendChild(r1);
    root.appendChild(c2);

    var c3 = el('div', 'card');
    c3.appendChild(el('h3', null, '⚖️ 재료 세어보기'));
    var t3 = el('table', 'tbl');
    var h3 = el('tr');
    ['재료', '장부', '실제', '차이'].forEach(function (h) { h3.appendChild(el('th', null, h)); });
    t3.appendChild(h3);
    S.items.forEach(function (it) {
      var book = round1(stock(it.id));
      var tr = el('tr');
      tr.appendChild(el('td', null, it.name));
      tr.appendChild(el('td', null, book + it.unit));
      var td = el('td');
      var inp = el('input', 'sm');
      inp.type = 'number'; inp.inputMode = 'decimal';
      inp.value = (S.counted[it.id] === undefined || S.counted[it.id] === '') ? '' : S.counted[it.id];
      td.appendChild(inp);
      tr.appendChild(td);
      var d0 = inp.value === '' ? null : num(inp.value) - book;
      var diff = el('td', 'r' + (d0 !== null && Math.abs(d0) >= 0.05 ? ' warn' : ''),
        d0 === null ? '—' : (d0 > 0 ? '+' : '') + round1(d0));
      tr.appendChild(diff);
      inp.oninput = function () {
        S.counted[it.id] = inp.value === '' ? '' : num(inp.value);
        save();
        var d = inp.value === '' ? null : num(inp.value) - book;
        diff.textContent = d === null ? '—' : (d > 0 ? '+' : '') + round1(d);
        diff.className = 'r' + (d !== null && Math.abs(d) >= 0.05 ? ' warn' : '');
      };
      t3.appendChild(tr);
    });
    c3.appendChild(t3);
    c3.appendChild(el('p', 'muted', '개수로 세는 재료는 대개 딱 맞고, 무게로 재는 재료는 잘 안 맞습니다. 그 차이가 오늘의 손실입니다.'));
    root.appendChild(c3);

    var sales = salesTotal(), cost = cogs(), loss = lossCost(), spent = spentTotal();
    var c4 = el('div', 'card');
    var head = el('div', 'rowBetween');
    head.appendChild(el('h3', null, '💰 남은 돈'));
    var tg = el('button', 'miniBtn', S.ledgerMode === 'simple' ? '회계부로 보기' : '간단히 보기');
    tg.onclick = function () { S.ledgerMode = S.ledgerMode === 'simple' ? 'double' : 'simple'; save(); render(); };
    head.appendChild(tg);
    c4.appendChild(head);

    if (S.ledgerMode === 'simple') {
      [['판 돈', sales], ['판 만큼 나간 재료값', -cost], ['버린 재료값', -loss]].forEach(function (p) {
        var r = el('div', 'formRow');
        r.appendChild(el('label', null, p[0]));
        r.appendChild(el('span', null, won(p[1]) + '원'));
        c4.appendChild(r);
      });
      var t = el('div', 'total');
      t.appendChild(el('span', null, '남은 돈'));
      t.appendChild(el('strong', null, won(sales - cost - loss) + '원'));
      c4.appendChild(t);
      var r2 = el('div', 'formRow');
      r2.appendChild(el('label', null, '(참고) 장 보는 데 쓴 돈'));
      r2.appendChild(el('span', 'muted', won(spent) + '원'));
      c4.appendChild(r2);
      c4.appendChild(el('p', 'muted', '사 왔지만 안 판 재료는 아직 남아 있으니 비용에 넣지 않았습니다.'));
    } else {
      c4.appendChild(el('p', 'muted', '같은 하루를 회계부 방식으로 적으면 이렇게 됩니다.'));
      var t2 = el('table', 'tbl');
      var h2 = el('tr');
      ['차변 (들어옴)', '금액', '대변 (나감)', '금액'].forEach(function (h) { h2.appendChild(el('th', null, h)); });
      t2.appendChild(h2);
      function je(dr, drv, cr, crv) {
        var tr = el('tr');
        tr.appendChild(el('td', null, dr));
        tr.appendChild(el('td', 'r', won(drv)));
        tr.appendChild(el('td', null, cr));
        tr.appendChild(el('td', 'r', won(crv)));
        t2.appendChild(tr);
      }
      if (salesTotal('현금')) je('현금', salesTotal('현금'), '매출', salesTotal('현금'));
      if (salesTotal('이체')) je('보통예금', salesTotal('이체'), '매출', salesTotal('이체'));
      if (salesTotal('쿠폰')) je('미수금', salesTotal('쿠폰'), '매출', salesTotal('쿠폰'));
      if (cost) je('매출원가', cost, '재료', cost);
      if (loss) je('재고감모손실', loss, '재료', loss);
      c4.appendChild(t2);
      c4.appendChild(el('p', 'muted', '왼쪽과 오른쪽 합이 항상 같습니다. 한 건을 두 번 적어 서로 검산되게 하는 방식이라 복식부기라고 합니다.'));
    }
    root.appendChild(c4);

    var c5 = el('div', 'card');
    var ex = el('button', 'bigBtn', '📄 엑셀로 내보내기');
    ex.onclick = exportCSV;
    c5.appendChild(ex);
    c5.appendChild(el('p', 'muted', '판매 기록·재료·마감이 한 파일로 저장됩니다.'));
    root.appendChild(c5);
  }

  function exportCSV() {
    var rows = [];
    function push(a) {
      rows.push((a || []).map(function (v) {
        var s = String(v === undefined || v === null ? '' : v);
        return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
      }).join(','));
    }
    push([(S.boothName || '부스') + ' 마감']);
    push([]);
    push(['■ 판매 기록']);
    push(['시각', '메뉴', '단가', '수량', '금액', '결제']);
    S.sales.forEach(function (s) {
      var d = new Date(s.t);
      var hm = ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2);
      s.lines.forEach(function (l) { push([hm, l.name, l.price, l.qty, l.price * l.qty, s.pay]); });
    });
    push([]);
    push(['■ 메뉴별 합계']);
    push(['메뉴', '판매가', '개수', '매출', '개당원가', '이익']);
    S.menus.forEach(function (mn) {
      var q = soldQty(mn.id);
      push([mn.name, mn.price, q, q * mn.price, Math.round(menuCost(mn)), Math.round(q * (mn.price - menuCost(mn)))]);
    });
    push([]);
    push(['■ 재료']);
    push(['재료', '단위', '묶음크기', '묶음가격', '입고', '판매소모', '폐기', '장부재고', '실제재고', '차이']);
    S.items.forEach(function (it) {
      var inQ = stockIn(it.id), used = usedBySales(it.id), adj = adjusted(it.id), book = inQ - used - adj;
      var real = (S.counted[it.id] === undefined || S.counted[it.id] === '') ? '' : num(S.counted[it.id]);
      push([it.name, it.unit, it.packQty, it.packPrice, inQ, used, adj, round1(book), real,
        real === '' ? '' : round1(real - book)]);
    });
    push([]);
    push(['■ 마감']);
    push(['총매출', salesTotal()]);
    PAYS.forEach(function (p) { push([p[0], salesTotal(p[0])]); });
    push(['매출원가', Math.round(cogs())]);
    push(['폐기손실', Math.round(lossCost())]);
    push(['남은 돈', Math.round(salesTotal() - cogs() - lossCost())]);
    push(['장 보는 데 쓴 돈', spentTotal()]);
    push(['준비한 거스름돈', S.cash0]);
    push(['있어야 할 현금', num(S.cash0) + salesTotal('현금')]);

    var blob = new Blob(['﻿' + rows.join('\r\n')], { type: 'text/csv;charset=utf-8;' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = (S.boothName || '부스') + '_마감.csv';
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
  }

  /* ================= 테마 ================= */
  // [키, 이름, 바탕, 카드, 글자, 강조, 보조] — 색 견본은 고르는 단추에만 쓰고, 실제 색은 index.html 의 CSS 가 정한다
  var THEMES = [
    ['pastel', '🍓 파스텔', '#FFF6EE', '#FFFFFF', '#3E3733', '#F76B84', '#FFCF5C'],
    ['pocha', '🏮 포장마차', '#FFF3D6', '#FFFFFF', '#3A1F14', '#D9431E', '#FFC93C'],
    ['ocean', '🌊 바다', '#EAF6FF', '#FFFFFF', '#16324A', '#1F7FD0', '#2FC2AE'],
    ['forest', '🌿 숲', '#F0F7EC', '#FFFFFF', '#23361F', '#3E8E3A', '#F2C94C'],
    ['night', '🌙 밤 축제', '#17142B', '#241F3F', '#F3EEFF', '#FF3D8B', '#FFD84D'],
    ['mono', '⬛ 흑백 크게', '#FFFFFF', '#FFFFFF', '#000000', '#000000', '#FFD400']
  ];
  function applyTheme() {
    var t = S.theme || 'pastel';
    document.documentElement.setAttribute('data-theme', t);
    var m = document.querySelector('meta[name=theme-color]');
    for (var i = 0; i < THEMES.length; i++) if (THEMES[i][0] === t && m) m.setAttribute('content', THEMES[i][2]);
  }
  function accountCard() {
    var c = el('div', 'card');
    c.appendChild(el('h3', null, '💳 우리 부스 입금 계좌'));
    c.appendChild(el('p', 'muted', '부스마다 따로 적습니다. 적어 두면 손님 화면에 계좌와 [복사] 단추가 뜹니다. 비워 두면 현금만 받습니다.'));
    [['bank', '은행', '예: 국민'], ['number', '계좌번호', '예: 123-45-67890'], ['holder', '예금주', '이름']].forEach(function (f) {
      var r = el('div', 'formRow');
      r.appendChild(el('label', null, f[1]));
      var i = el('input');
      i.value = S.account[f[0]] || '';
      i.placeholder = f[2];
      i.style.width = '170px';
      // 화면 전체를 다시 그리면 다음 칸으로 옮겨 갈 때 입력이 끊기므로, 아래 미리보기만 바꾼다
      i.oninput = function () { S.account[f[0]] = i.value; save(); preview(); };
      r.appendChild(i);
      c.appendChild(r);
    });
    var pv = el('div');
    c.appendChild(pv);
    function preview() {
      pv.innerHTML = '';
      if (hasAccount()) {
        pv.appendChild(el('p', 'muted', '손님 화면에는 이렇게 보입니다'));
        pv.appendChild(accountBox(null));
      }
    }
    preview();
    return c;
  }

  function themeCard() {
    var c = el('div', 'card');
    c.appendChild(el('h3', null, '🎨 디자인 테마'));
    c.appendChild(el('p', 'muted', '부스마다 따로 고를 수 있습니다. 손님 화면에도 같은 테마가 쓰입니다.'));
    var row = el('div', 'themeRow');
    THEMES.forEach(function (t) {
      var b = el('button', 'themeBtn' + ((S.theme || 'pastel') === t[0] ? ' on' : ''));
      b.style.background = t[2];
      b.style.color = t[4];
      b.style.boxShadow = '0 0 0 1px ' + (t[0] === 'night' ? '#3A3360' : 'rgba(0,0,0,.1)');
      var sw = el('span', 'sw');
      [t[3], t[5], t[6]].forEach(function (col) { var i = el('i'); i.style.background = col; sw.appendChild(i); });
      b.appendChild(sw);
      b.appendChild(el('span', null, t[1]));
      b.onclick = function () { S.theme = t[0]; save(); render(); toast(t[1] + ' 테마'); };
      row.appendChild(b);
    });
    c.appendChild(row);
    return c;
  }

  /* ================= 부스 고르기 ================= */
  function switchBooth(id) {
    save();
    BL.cur = id;
    saveList();
    cart = [];
    load();
    view = S.menus.length ? 'board' : 'setup';
    render();
  }

  function boothPicker() {
    modal(function (box, close) {
      box.appendChild(el('h3', null, '부스 고르기'));
      box.appendChild(el('p', 'muted', '부스마다 메뉴판·사진·재고·판매 기록이 따로 저장됩니다.'));
      BL.booths.forEach(function (b, i) {
        var row = el('div', 'boothRow' + (b.id === BL.cur ? ' on' : ''));
        var pick = el('button', 'boothPick', (b.name || '이름 없는 부스 ' + (i + 1)) + (b.id === BL.cur ? '  ✓ 지금' : ''));
        pick.onclick = function () { close(); if (b.id !== BL.cur) { switchBooth(b.id); toast((b.name || '부스') + '(으)로 바꿨습니다'); } };
        row.appendChild(pick);
        if (BL.booths.length > 1) {
          var del = el('button', 'miniBtn warn', '지우기');
          del.onclick = function () {
            if (!confirm((b.name || '이 부스') + ' 의 메뉴·사진·판매 기록을 모두 지웁니다.\n되돌릴 수 없습니다. 지울까요?')) return;
            try { localStorage.removeItem(keyOf(b.id)); } catch (e) { }
            BL.booths.splice(i, 1);
            close();
            if (b.id === BL.cur) { BL.cur = BL.booths[0].id; saveList(); load(); view = S.menus.length ? 'board' : 'setup'; render(); }
            else saveList();
            toast('지웠습니다');
          };
          row.appendChild(del);
        }
        box.appendChild(row);
      });
      var nm = el('input');
      nm.placeholder = '새 부스 이름 (예: 2학년 3반 빙수)';
      nm.style.marginTop = '12px';
      box.appendChild(nm);
      var add = el('button', 'bigBtn', '+ 새 부스 만들기');
      add.onclick = function () {
        var name = nm.value.trim();
        if (!name) { alert('부스 이름을 적어 주세요.'); nm.focus(); return; }
        save();
        var id = 'b' + uid();
        BL.booths.push({ id: id, name: name });
        BL.cur = id;
        saveList();
        S = blank();
        S.boothName = name;
        cart = [];
        save();
        close();
        view = 'setup';
        render();
        toast('새 부스를 만들었습니다. 메뉴 꾸러미를 고르거나 메뉴를 넣으세요.');
      };
      box.appendChild(add);
      var no = el('button', 'linkBtn', '닫기');
      no.onclick = close;
      box.appendChild(no);
    });
  }

  /* ================= 주문 알림 (큰 글씨 + 소리) ================= */
  var soundOn = true;
  try { soundOn = localStorage.getItem('festival_booth_sound') !== 'off'; } catch (e) { }

  function menuNo(id) {
    for (var i = 0; i < S.menus.length; i++) if (S.menus[i].id === id) return i + 1;
    return 0;
  }

  // 띵동 — 떠들썩한 부스에서도 들리게 음성 앞에 짧은 종소리를 낸다
  var actx = null;
  function chime() {
    try {
      actx = actx || new (window.AudioContext || window.webkitAudioContext)();
      if (actx.state === 'suspended') actx.resume();
      [[880, 0], [660, 0.28]].forEach(function (n) {
        var o = actx.createOscillator(), g = actx.createGain();
        var t = actx.currentTime + n[1];
        o.type = 'triangle';
        o.frequency.value = n[0];
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(0.9, t + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 0.5);
        o.connect(g); g.connect(actx.destination);
        o.start(t); o.stop(t + 0.55);
      });
    } catch (e) { }
  }

  function speak(text) {
    if (!('speechSynthesis' in window)) return;
    try {
      speechSynthesis.cancel();
      var u = new SpeechSynthesisUtterance(text);
      u.lang = 'ko-KR'; u.rate = 0.95; u.pitch = 1; u.volume = 1;
      var vs = speechSynthesis.getVoices();
      for (var i = 0; i < vs.length; i++) if (/^ko/i.test(vs[i].lang)) { u.voice = vs[i]; break; }
      speechSynthesis.speak(u);
    } catch (e) { }
  }

  function orderSpeech(sale) {
    var parts = sale.lines.map(function (l) { return l.no + '번 ' + l.name + ' ' + l.qty + '개'; });
    return '주문 ' + sale.no + '번. ' + parts.join(', ') + ' 주문되었습니다.';
  }

  function announce(sale) {
    var text = orderSpeech(sale);
    if (soundOn) { chime(); setTimeout(function () { speak(text); }, 700); }

    var ov = el('div', 'orderPop');
    var inner = el('div', 'orderBox');
    inner.appendChild(el('div', 'oTitle', '🔔 주문 ' + sale.no + '번'));
    sale.lines.forEach(function (l) {
      var r = el('div', 'oLine');
      r.appendChild(el('span', 'oNo', l.no + '번'));
      r.appendChild(el('span', 'oName', l.name));
      r.appendChild(el('span', 'oQty', l.qty + '개'));
      inner.appendChild(r);
    });
    inner.appendChild(el('div', 'oSub', '주문되었습니다'));
    if (sale.change > 0) inner.appendChild(el('div', 'oChange', '거스름돈 ' + won(sale.change) + '원'));
    var btns = el('div', 'oBtns');
    var again = el('button', 'miniBtn', '🔊 다시 듣기');
    again.onclick = function (e) { e.stopPropagation(); chime(); setTimeout(function () { speak(text); }, 700); };
    btns.appendChild(again);
    var ok = el('button', 'miniBtn go', '확인');
    btns.appendChild(ok);
    inner.appendChild(btns);
    ov.appendChild(inner);
    function shut() { clearTimeout(timer); if (ov.parentNode) ov.parentNode.removeChild(ov); }
    ov.onclick = shut;
    ok.onclick = shut;
    document.body.appendChild(ov);
    var timer = setTimeout(shut, 8000);
  }

  /* ================= 설정 ================= */
  function viewSetup(root) {
    var cb = el('div', 'card');
    var hb = el('div', 'rowBetween');
    hb.appendChild(el('h3', null, '🏪 지금 부스: ' + (S.boothName || '이름 없음')));
    var pb = el('button', 'miniBtn go', '부스 바꾸기 · 추가');
    pb.onclick = boothPicker;
    hb.appendChild(pb);
    cb.appendChild(hb);
    cb.appendChild(el('p', 'muted', '이 기기에 만든 부스 ' + BL.booths.length + '개. 부스마다 메뉴판·사진·기록이 따로입니다.'));
    root.appendChild(cb);
    root.appendChild(themeCard());

    var cs = el('div', 'card');
    var hs = el('div', 'rowBetween');
    hs.appendChild(el('h3', null, '🔊 주문 알림 소리'));
    var tgS = el('button', 'miniBtn' + (soundOn ? ' go' : ' warn'), soundOn ? '켜짐' : '꺼짐');
    tgS.onclick = function () {
      soundOn = !soundOn;
      try { localStorage.setItem('festival_booth_sound', soundOn ? 'on' : 'off'); } catch (e) { }
      render();
    };
    hs.appendChild(tgS);
    cs.appendChild(hs);
    cs.appendChild(el('p', 'muted', '결제를 마치면 "주문 1번. 1번 세트 2개 주문되었습니다"처럼 소리로 읽어 줍니다. 폰 미디어 소리를 크게 올려 두세요. 무음 모드면 안 들립니다.'));
    var tst = el('button', 'miniBtn', '▶ 소리 시험');
    tst.onclick = function () {
      var m = S.menus[0];
      var t = '주문 1번. 1번 ' + (m ? m.name : '메뉴') + ' 2개 주문되었습니다.';
      chime(); setTimeout(function () { speak(t); }, 700);
    };
    cs.appendChild(tst);
    root.appendChild(cs);

    var cp = el('div', 'card');
    cp.appendChild(el('h3', null, '🔒 관리자 비밀번호'));
    cp.appendChild(el('p', 'muted', '손님 화면에서 관리자 화면으로 돌아올 때 씁니다. 처음 비밀번호는 1234 입니다. 이 기기의 모든 부스에 같이 적용됩니다.'));
    var pwR = el('div', 'formRow');
    pwR.appendChild(el('label', null, '새 비밀번호'));
    var pwI = el('input');
    pwI.type = 'text'; pwI.inputMode = 'numeric'; pwI.placeholder = '숫자 4자리 이상';
    pwR.appendChild(pwI);
    cp.appendChild(pwR);
    var pwB = el('button', 'miniBtn', '비밀번호 바꾸기');
    pwB.onclick = function () {
      if (pwI.value.length < 4) { alert('4자리 이상으로 적어 주세요.'); return; }
      try { localStorage.setItem(PW_KEY, pwI.value); } catch (e) { }
      pwI.value = '';
      toast('비밀번호를 바꿨습니다');
    };
    cp.appendChild(pwB);
    root.appendChild(cp);

    var c0 = el('div', 'card');
    c0.appendChild(el('h3', null, '부스 이름'));
    var n0 = el('input');
    n0.value = S.boothName || '';
    n0.placeholder = '예: 3학년 1반 비빔면';
    n0.oninput = function () { S.boothName = n0.value; save(); $('#boothName').textContent = (S.boothName || '축제 부스') + ' ▾'; };
    c0.appendChild(n0);
    c0.appendChild(el('p', 'muted', '메뉴 꾸러미 불러오기'));
    var pr = el('div', 'quickRow');
    Object.keys(PRESETS).forEach(function (k) {
      var b = el('button', 'quickBtn' + (S.preset === k ? ' on' : ''), PRESETS[k].name);
      b.onclick = function () {
        if (S.sales.length && !confirm('판매 기록이 이미 있습니다. 메뉴를 바꾸면 기록이 어긋납니다. 계속할까요?')) return;
        var p = PRESETS[k];
        S.preset = k;
        if (!S.boothName) S.boothName = p.name;
        S.items = JSON.parse(JSON.stringify(p.items));
        S.menus = JSON.parse(JSON.stringify(p.menus));
        save(); go('board');
      };
      pr.appendChild(b);
    });
    c0.appendChild(pr);
    root.appendChild(c0);

    var c1 = el('div', 'card');
    c1.appendChild(el('h3', null, '💳 입금 계좌'));
    c1.appendChild(el('p', 'muted', '아직 안 정해졌으면 비워 두세요. 채우는 순간 송금 QR이 만들어집니다.'));
    [['bank', '은행', '예: 국민'], ['number', '계좌번호', '숫자만'], ['holder', '예금주', '이름']].forEach(function (f) {
      var r = el('div', 'formRow');
      r.appendChild(el('label', null, f[1]));
      var i = el('input');
      i.value = S.account[f[0]] || '';
      i.placeholder = f[2];
      i.oninput = function () { S.account[f[0]] = i.value; save(); };
      r.appendChild(i);
      c1.appendChild(r);
    });
    var rl = el('div', 'formRow');
    rl.appendChild(el('label', null, '송금 링크'));
    var il = el('input');
    il.value = S.account.link || '';
    il.placeholder = 'https://.../{금액}';
    il.oninput = function () { S.account.link = il.value; save(); };
    rl.appendChild(il);
    c1.appendChild(rl);
    c1.appendChild(el('p', 'muted',
      '송금 링크를 넣으면 계좌번호 대신 그 링크로 QR을 만듭니다. 링크 안에 {금액}이라고 적어 두면 그 자리에 결제 금액이 들어갑니다. 행사 전에 실제 휴대폰으로 한 번 찍어 보세요.'));
    root.appendChild(c1);

    var c2 = el('div', 'card');
    c2.appendChild(el('h3', null, '🥕 재료'));
    var t2 = el('table', 'tbl');
    var h2 = el('tr');
    ['이름', '단위', '1묶음', '묶음값', ''].forEach(function (h) { h2.appendChild(el('th', null, h)); });
    t2.appendChild(h2);
    S.items.forEach(function (it, idx) {
      var tr = el('tr');
      [['name', 'text'], ['unit', 'text'], ['packQty', 'number'], ['packPrice', 'number']].forEach(function (f) {
        var td = el('td');
        var i = el('input', 'sm');
        i.type = f[1];
        i.value = it[f[0]];
        i.oninput = function () { it[f[0]] = f[1] === 'number' ? num(i.value) : i.value; save(); };
        td.appendChild(i);
        tr.appendChild(td);
      });
      var td = el('td');
      var d = el('button', 'miniBtn warn', '×');
      d.onclick = function () {
        if (!confirm(it.name + ' 을(를) 지웁니다. 레시피에서도 빠집니다.')) return;
        S.items.splice(idx, 1);
        S.menus.forEach(function (mn) { mn.recipe = mn.recipe.filter(function (r) { return r.itemId !== it.id; }); });
        save(); render();
      };
      td.appendChild(d);
      tr.appendChild(td);
      t2.appendChild(tr);
    });
    c2.appendChild(t2);
    var add2 = el('button', 'miniBtn', '+ 재료 추가');
    add2.onclick = function () { S.items.push({ id: uid(), name: '새 재료', unit: '개', packQty: 1, packPrice: 0 }); save(); render(); };
    c2.appendChild(add2);
    root.appendChild(c2);

    var c3 = el('div', 'card');
    c3.appendChild(el('h3', null, '🍜 레시피'));
    c3.appendChild(el('p', 'muted', '한 개 팔면 재료가 얼마나 빠지는지 적어 두면, 팔 때마다 재고가 저절로 줄어듭니다.'));
    S.menus.forEach(function (mn) {
      var box = el('div', 'menuEdit');
      box.appendChild(el('div', 'rowBetween', ''));
      box.lastChild.appendChild(el('strong', null, mn.name));
      box.lastChild.appendChild(el('span', 'muted', won(mn.price) + '원'));
      S.items.forEach(function (it) {
        var cur = null;
        for (var i = 0; i < mn.recipe.length; i++) if (mn.recipe[i].itemId === it.id) cur = mn.recipe[i];
        var r = el('div', 'recipeRow');
        r.appendChild(el('label', null, it.name));
        var i2 = el('input');
        i2.type = 'number'; i2.inputMode = 'decimal';
        i2.value = cur ? cur.qty : ''; i2.placeholder = '0';
        i2.oninput = function () {
          var v = num(i2.value);
          mn.recipe = mn.recipe.filter(function (x) { return x.itemId !== it.id; });
          if (v > 0) mn.recipe.push({ itemId: it.id, qty: v });
          save();
        };
        r.appendChild(i2);
        r.appendChild(el('span', null, it.unit));
        box.appendChild(r);
      });
      box.appendChild(el('p', 'muted', '원가 ' + won(menuCost(mn)) + '원 · 이익 ' + won(mn.price - menuCost(mn)) + '원'));
      c3.appendChild(box);
    });
    root.appendChild(c3);

    var c4 = el('div', 'card');
    c4.appendChild(el('h3', null, '💾 데이터'));
    var bk = el('button', 'miniBtn', '백업 내려받기');
    bk.onclick = function () {
      var blob = new Blob([JSON.stringify(S)], { type: 'application/json' });
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = (S.boothName || '부스') + '_백업.json';
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
    };
    c4.appendChild(bk);
    var file = el('input');
    file.type = 'file'; file.accept = '.json'; file.style.display = 'none';
    file.onchange = function () {
      var f = file.files[0];
      if (!f) return;
      var rd = new FileReader();
      rd.onload = function () {
        try { S = Object.assign(blank(), JSON.parse(rd.result)); save(); render(); toast('불러왔습니다'); }
        catch (e) { alert('파일을 읽지 못했습니다.'); }
      };
      rd.readAsText(f);
    };
    var rs = el('button', 'miniBtn', '백업 불러오기');
    rs.onclick = function () { file.click(); };
    c4.appendChild(rs);
    c4.appendChild(file);
    var cl = el('button', 'miniBtn warn', '오늘 기록 지우기');
    cl.onclick = function () {
      if (!confirm('판매·입고·폐기 기록을 지웁니다.\n메뉴와 재료 설정은 그대로 남습니다.')) return;
      S.sales = []; S.purchases = []; S.adjusts = []; S.counted = {}; S.menuLog = [];
      save(); render(); toast('기록을 비웠습니다');
    };
    c4.appendChild(cl);
    c4.appendChild(el('p', 'warn', '이 앱은 이 기기의 브라우저에만 저장됩니다. 축제 당일에는 종이에도 함께 적어 두세요.'));
    root.appendChild(c4);
  }

  /* ================= 시작 ================= */
  function init() {
    load();
    var bar = document.getElementById('tabs');
    [['sell', '💰', '판매'], ['board', '📋', '메뉴판'], ['stock', '📦', '재고'], ['close', '📊', '마감']]
      .forEach(function (t) {
        var b = document.createElement('button');
        b.dataset.v = t[0];
        b.innerHTML = '<span class="ic">' + t[1] + '</span><span class="lb">' + t[2] + '</span>';
        b.onclick = function () { go(t[0]); };
        bar.appendChild(b);
      });
    document.getElementById('gear').onclick = function () { go('setup'); };
    document.getElementById('boothName').onclick = boothPicker;
    document.getElementById('toGuest').onclick = enterGuest;
    // 폰 브라우저는 목소리 목록을 늦게 준다 — 미리 한 번 불러 둔다
    if ('speechSynthesis' in window) { try { speechSynthesis.getVoices(); } catch (e) { } }
    if (!S.menus.length) view = 'setup';
    render();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

  window.__booth = {
    state: function () { return S; },
    go: go, stock: stock, makeable: makeable, payString: payString,
    reset: function () { S = blank(); save(); render(); }
  };
})();

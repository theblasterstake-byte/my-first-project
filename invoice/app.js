/* =========================================================
   請求書メーカー  — AI Consultant / 伊藤 剛
   固定：発行者情報・振込先・消費税10%
   自動：支払期限（発行月の25日）／金額・小計・消費税・合計
   ========================================================= */

const TAX_RATE = 0.10;
const STORAGE_KEY = 'invoice-maker-v1';

const $  = (s) => document.querySelector(s);
const $$ = (s) => Array.from(document.querySelectorAll(s));

/* ---------------------------------------------------------
   実印風の印影（SVG）— 二重外枠・界線・雷紋・朱肉のカスレを再現
   --------------------------------------------------------- */
function buildSeal() {
  const INK = '#c8102e';
  const cx = 100, cy = 100;
  const parts = [];

  // 外枠リングの間に刻む放射状の刻み（36本）
  let ticks = '';
  for (let i = 0; i < 36; i++) {
    const a = (Math.PI * 2 * i) / 36;
    const r1 = 84.5, r2 = 90.5;
    ticks += `<line x1="${(cx + Math.cos(a) * r1).toFixed(2)}" y1="${(cy + Math.sin(a) * r1).toFixed(2)}"
                    x2="${(cx + Math.cos(a) * r2).toFixed(2)}" y2="${(cy + Math.sin(a) * r2).toFixed(2)}"
                    stroke="${INK}" stroke-width="${i % 3 === 0 ? 2.6 : 1.2}" stroke-linecap="butt"/>`;
  }

  // 四隅の雷紋（回り込む渦巻き装飾）
  const fret = (x, y, rot) => `
    <path d="M0,0 h13 v13 h-9 v-9 h5 v5"
          fill="none" stroke="${INK}" stroke-width="2.4" stroke-linejoin="miter"
          transform="translate(${x},${y}) rotate(${rot})"/>`;

  // 朱肉のカスレ（決定的な擬似乱数で毎回同じ模様）
  let seed = 20260831;
  const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  let speckle = '';
  for (let i = 0; i < 110; i++) {
    const a = rnd() * Math.PI * 2, r = Math.sqrt(rnd()) * 92;
    speckle += `<circle cx="${(cx + Math.cos(a) * r).toFixed(1)}" cy="${(cy + Math.sin(a) * r).toFixed(1)}"
                        r="${(rnd() * 1.5 + 0.35).toFixed(2)}" fill="#000"/>`;
  }

  parts.push(`
<svg viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="伊藤 印">
  <defs>
    <filter id="sealRough" x="-15%" y="-15%" width="130%" height="130%">
      <feTurbulence type="fractalNoise" baseFrequency="0.09" numOctaves="4" seed="7" result="n"/>
      <feDisplacementMap in="SourceGraphic" in2="n" scale="2.4" xChannelSelector="R" yChannelSelector="G"/>
    </filter>
    <mask id="sealWear">
      <rect width="200" height="200" fill="#fff"/>
      ${speckle}
    </mask>
  </defs>

  <g filter="url(#sealRough)" mask="url(#sealWear)" opacity="0.92">
    <!-- 二重外枠 -->
    <circle cx="${cx}" cy="${cy}" r="94" fill="none" stroke="${INK}" stroke-width="7"/>
    <circle cx="${cx}" cy="${cy}" r="83" fill="none" stroke="${INK}" stroke-width="2.2"/>
    ${ticks}

    <!-- 内側の界線（篆刻の枠取り） -->
    <rect x="27" y="27" width="146" height="146" rx="7" fill="none" stroke="${INK}" stroke-width="3.4"/>
    <rect x="34" y="34" width="132" height="132" rx="4" fill="none" stroke="${INK}" stroke-width="1.1"/>
    

    <!-- 四隅の雷紋 -->
    ${fret(39, 39, 0)}${fret(161, 39, 90)}${fret(161, 161, 180)}${fret(39, 161, 270)}

    <!-- 姓「伊藤」を縦二文字、篆書風の長体で配置 -->
    <g fill="${INK}" font-family="'Yu Mincho','Hiragino Mincho ProN','MS Mincho',serif"
       font-weight="700" text-anchor="middle" dominant-baseline="central" font-size="58">
      <text transform="translate(100,69) scale(1.3,1.0)">伊</text>
      <text transform="translate(100,131) scale(1.3,1.0)">藤</text>
    </g>
  </g>
</svg>`);

  return parts.join('');
}

/* ---------------------------------------------------------
   ユーティリティ
   --------------------------------------------------------- */
const yen = (n) => '¥' + Math.round(n).toLocaleString('ja-JP');
const num = (v) => {
  const n = parseFloat(String(v).replace(/[,，\s]/g, ''));
  return Number.isFinite(n) ? n : 0;
};
const jpDate = (iso) => {
  if (!iso) return '—';
  const [y, m, d] = iso.split('-').map(Number);
  return `${y}年${m}月${d}日`;
};
/** 支払期限＝発行日と同じ月の25日 */
const dueDateOf = (iso) => (iso ? `${iso.slice(0, 7)}-25` : '');

/* ---------------------------------------------------------
   明細行
   --------------------------------------------------------- */
function addRow(data = {}) {
  const row = document.createElement('div');
  row.className = 'item-row';
  row.innerHTML = `
    <input type="text"   class="i-name"  placeholder="AIコンサルティング業務" value="${data.name || ''}">
    <input type="number" class="i-qty"   placeholder="1"   step="any" min="0" value="${data.qty ?? ''}">
    <input type="text"   class="i-unit"  placeholder="式"  value="${data.unit || ''}">
    <input type="number" class="i-price" placeholder="0"   step="any" min="0" value="${data.price ?? ''}">
    <button type="button" class="del" title="この行を削除">×</button>`;
  row.querySelector('.del').addEventListener('click', () => {
    row.remove();
    if (!$('#items').children.length) addRow();
    render();
  });
  $('#items').appendChild(row);
}

function readItems() {
  return $$('#items .item-row').map((r) => ({
    name:  r.querySelector('.i-name').value.trim(),
    qty:   r.querySelector('.i-qty').value,
    unit:  r.querySelector('.i-unit').value.trim(),
    price: r.querySelector('.i-price').value,
  }));
}

/* ---------------------------------------------------------
   描画（プレビュー＝そのまま印刷される紙面）
   --------------------------------------------------------- */
function render() {
  const issue = $('#issueDate').value;
  const due   = dueDateOf(issue);
  $('#dueDateView').value = due ? jpDate(due) : '';

  const client = $('#clientName').value.trim();
  $('#pvClient').textContent = client
    ? client + ($('#clientHonorific').checked ? '　御中' : '')
    : '　';

  $('#pvSubject').textContent = $('#subject').value.trim() || '—';
  $('#pvIssue').textContent   = jpDate(issue);
  $('#pvDue').textContent     = due ? jpDate(due) : '—';
  $('#pvNo').textContent      = $('#invoiceNo').value.trim() || '—';
  $('#pvNotes').textContent   = $('#notes').value;

  // 明細と金額計算
  const items = readItems().filter((i) => i.name || num(i.qty) || num(i.price));
  const tbody = $('#pvItems');
  tbody.innerHTML = '';
  let subtotal = 0;

  items.forEach((i) => {
    const amount = num(i.qty) * num(i.price);
    subtotal += amount;
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${escapeHtml(i.name)}</td>
      <td>${i.qty === '' ? '' : num(i.qty).toLocaleString('ja-JP')}</td>
      <td>${escapeHtml(i.unit)}</td>
      <td>${i.price === '' ? '' : yen(num(i.price))}</td>
      <td>${amount ? yen(amount) : ''}</td>`;
    tbody.appendChild(tr);
  });

  // 体裁を整えるための空行（最低8行）
  for (let i = items.length; i < 8; i++) {
    const tr = document.createElement('tr');
    tr.className = 'blank';
    tr.innerHTML = '<td></td><td></td><td></td><td></td><td></td>';
    tbody.appendChild(tr);
  }

  const tax   = Math.floor(subtotal * TAX_RATE);
  const total = subtotal + tax;
  $('#pvSub').textContent   = yen(subtotal);
  $('#pvTax').textContent   = yen(tax);
  $('#pvTotal').textContent = yen(total);
  $('#pvGrand').textContent = yen(total) + '-';

  save();
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/* ---------------------------------------------------------
   保存・復元
   --------------------------------------------------------- */
function save() {
  const data = {
    issueDate: $('#issueDate').value,
    invoiceNo: $('#invoiceNo').value,
    subject:   $('#subject').value,
    clientName:$('#clientName').value,
    honorific: $('#clientHonorific').checked,
    notes:     $('#notes').value,
    items:     readItems(),
  };
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(data)); } catch (e) {}
}

function load() {
  let data = null;
  try { data = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null'); } catch (e) {}
  const today = new Date();
  const iso = new Date(today.getTime() - today.getTimezoneOffset() * 60000)
    .toISOString().slice(0, 10);

  $('#issueDate').value  = data?.issueDate || iso;
  $('#invoiceNo').value  = data?.invoiceNo || `IAI-${$('#issueDate').value.slice(0, 4)}-001`;
  $('#subject').value    = data?.subject    || '';
  $('#clientName').value = data?.clientName || '';
  $('#clientHonorific').checked = data?.honorific !== false;
  $('#notes').value      = data?.notes ?? 'お振込手数料は貴社にてご負担くださいますようお願い申し上げます。';

  const items = data?.items?.length ? data.items : [{ name: '', qty: 1, unit: '式', price: '' }];
  items.forEach(addRow);
}

/* ---------------------------------------------------------
   起動
   --------------------------------------------------------- */
$('#sealMount').innerHTML = buildSeal();
load();
render();

document.addEventListener('input', (e) => {
  if (e.target.closest('.panel')) render();
});
$('#clientHonorific').addEventListener('change', render);
$('#btn-add').addEventListener('click', () => { addRow(); render(); });
$('#btn-pdf').addEventListener('click', () => window.print());
$('#btn-reset').addEventListener('click', () => {
  if (!confirm('入力内容をクリアします。よろしいですか？')) return;
  try { localStorage.removeItem(STORAGE_KEY); } catch (e) {}
  location.reload();
});

// 発行日を変えたら請求書番号の年も追従（連番部分は保持）
$('#issueDate').addEventListener('change', () => {
  const y = $('#issueDate').value.slice(0, 4);
  const m = $('#invoiceNo').value.match(/^IAI-(\d{4})-(\d+)$/);
  if (y && m) $('#invoiceNo').value = `IAI-${y}-${m[2]}`;
  render();
});

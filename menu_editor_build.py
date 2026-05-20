import fitz, re, json, base64, html, os

SRC = r"C:\Users\yilma\Desktop\sakura\Blank(3)(1)(1)(1).pdf"
OUT_HTML = r"C:\Users\yilma\Desktop\sakura\menu_fiyat_duzenleyici.html"
SCALE = 3.0  # render crispness

doc = fitz.open(SRC)
page = doc[0]
pw, ph = page.rect.width, page.rect.height

price_re = re.compile(r'^\d{1,4}([.,]\d{1,2})?$')

words = page.get_text("words")  # x0,y0,x1,y1,word,block,line,wordno
# group by (block, line)
lines = {}
for w in words:
    x0, y0, x1, y1, txt, b, l, n = w
    lines.setdefault((b, l), []).append(w)

prices = []
for key, ws in lines.items():
    ws.sort(key=lambda w: w[5])  # wordno
    for i, w in enumerate(ws):
        x0, y0, x1, y1, txt, b, l, n = w
        nxt = ws[i + 1][4] if i + 1 < len(ws) else ""
        # single-word "360.00TL"
        m_single = re.match(r'^(\d{1,4}([.,]\d{1,2})?)TL$', txt)
        if price_re.match(txt) and nxt.upper() == "TL":
            prices.append({"x0": x0, "y0": y0, "x1": x1, "y1": y1, "text": txt})
        elif m_single:
            prices.append({"x0": x0, "y0": y0, "x1": x1, "y1": y1,
                            "text": m_single.group(1)})

# redact only the numeric price tokens so the background image has blanks there
for p in prices:
    r = fitz.Rect(p["x0"], p["y0"], p["x1"], p["y1"])
    page.add_redact_annot(r, fill=(1, 1, 1))
page.apply_redactions(images=fitz.PDF_REDACT_IMAGE_NONE)

pix = page.get_pixmap(matrix=fitz.Matrix(SCALE, SCALE), alpha=False)
img_b64 = base64.b64encode(pix.tobytes("png")).decode()
IMW, IMH = pix.width, pix.height

# build price boxes in image pixel coords
boxes = []
for idx, p in enumerate(prices):
    bx = p["x0"] * SCALE
    by = p["y0"] * SCALE
    bw = (p["x1"] - p["x0"]) * SCALE
    bh = (p["y1"] - p["y0"]) * SCALE
    boxes.append({
        "id": idx,
        "left": round(bx, 2),
        "top": round(by, 2),
        "width": round(bw, 2),
        "height": round(bh, 2),
        "fs": round(bh * 0.78, 2),
        "val": p["text"],
    })

boxes_json = json.dumps(boxes, ensure_ascii=False)

HTML = """<!DOCTYPE html>
<html lang="tr">
<head>
<meta charset="utf-8">
<title>Sakura Menu - Fiyat Duzenleyici</title>
<style>
  * { box-sizing: border-box; }
  body { margin:0; background:#444; font-family:Arial,Helvetica,sans-serif; }
  #toolbar {
    position:sticky; top:0; z-index:1000; background:#1c1c1c; color:#fff;
    padding:10px 16px; display:flex; gap:12px; align-items:center; flex-wrap:wrap;
  }
  #toolbar button {
    background:#c0392b; color:#fff; border:0; padding:9px 18px; border-radius:6px;
    font-size:14px; cursor:pointer; font-weight:bold;
  }
  #toolbar button.sec { background:#555; }
  #toolbar button:hover { opacity:.9; }
  #toolbar span { font-size:12px; color:#bbb; }
  #stage {
    position:relative; margin:18px auto; width:__IMW__px; height:__IMH__px;
    background-image:url('data:image/png;base64,__IMG__');
    background-size:__IMW__px __IMH__px; box-shadow:0 0 22px rgba(0,0,0,.6);
  }
  .price {
    position:absolute; border:1px dashed rgba(192,57,43,.55); background:rgba(255,255,255,.65);
    text-align:right; font-weight:bold; color:#000; padding:0; margin:0;
    font-family:Arial,Helvetica,sans-serif; line-height:1; outline:none;
  }
  .price:focus { background:#fff7d6; border:1px solid #c0392b; }
  @media print {
    #toolbar { display:none; }
    body { background:#fff; }
    #stage { margin:0; box-shadow:none; }
    .price { border:0 !important; background:transparent !important; }
  }
  @page { size:__IMW__px __IMH__px; margin:0; }
</style>
</head>
<body>
<div id="toolbar">
  <button onclick="window.print()">PDF olarak kaydet / Yazdir</button>
  <button class="sec" onclick="saveLocal()">Degisiklikleri kaydet</button>
  <button class="sec" onclick="resetAll()">Orijinale don</button>
  <span>Fiyat kutularina tiklayip yeni fiyati yazin. "PDF olarak kaydet" deyip hedef olarak "PDF" secin.</span>
</div>
<div id="stage"></div>
<script>
const BOXES = __BOXES__;
const KEY = "sakura_menu_prices_v1";
const stage = document.getElementById('stage');

function build(values) {
  stage.innerHTML = '';
  BOXES.forEach(b => {
    const inp = document.createElement('input');
    inp.type = 'text';
    inp.className = 'price';
    inp.dataset.id = b.id;
    inp.style.left = b.left + 'px';
    inp.style.top = b.top + 'px';
    inp.style.width = b.width + 'px';
    inp.style.height = b.height + 'px';
    inp.style.fontSize = b.fs + 'px';
    inp.value = (values && values[b.id] != null) ? values[b.id] : b.val;
    inp.addEventListener('input', () => { inp.style.background = '#fff7d6'; });
    stage.appendChild(inp);
  });
}
function collect() {
  const o = {};
  document.querySelectorAll('.price').forEach(i => o[i.dataset.id] = i.value);
  return o;
}
function saveLocal() {
  localStorage.setItem(KEY, JSON.stringify(collect()));
  alert('Fiyatlar bu tarayicida kaydedildi. Dosyayi tekrar actiginizda korunur.');
}
function resetAll() {
  if (!confirm('Tum fiyatlar orijinal haline donsun mu?')) return;
  localStorage.removeItem(KEY);
  build(null);
}
let saved = null;
try { saved = JSON.parse(localStorage.getItem(KEY)); } catch(e) {}
build(saved);
</script>
</body>
</html>"""

HTML = (HTML.replace("__IMG__", img_b64)
            .replace("__IMW__", str(IMW))
            .replace("__IMH__", str(IMH))
            .replace("__BOXES__", boxes_json))

with open(OUT_HTML, "w", encoding="utf-8") as f:
    f.write(HTML)

print("PRICES:", len(prices))
print("IMG:", IMW, "x", IMH)
print("OUT:", OUT_HTML, round(os.path.getsize(OUT_HTML) / 1024), "KB")

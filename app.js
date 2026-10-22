(() => {
  "use strict";
  const CSV_URL = "data/products.csv";
  const $ = (id) => document.getElementById(id);
  const input = $("barcodeInput");
  const status = $("scanStatus");
  const video = $("video");
  const cameraBox = $("cameraBox");
  const placeholder = $("cameraPlaceholder");
  const startButton = $("startScan");
  const stopButton = $("stopScan");
  const emptyState = $("emptyState");
  const result = $("productResult");
  const notFound = $("notFound");
  let products = new Map();
  let reader = null;
  let controls = null;
  let active = false;

  function setStatus(message, type = "") {
    status.textContent = message;
    status.className = "status" + (type ? " " + type : "");
  }
  function clean(value) { return String(value ?? "").trim(); }
  function normalizeBarcode(value) { return clean(value).replace(/\s+/g, ""); }

  // CSV parser supporting quoted fields, commas and escaped quotes.
  function parseCSV(text) {
    const rows = [];
    let row = [], field = "", quoted = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (quoted) {
        if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
        else if (c === '"') quoted = false;
        else field += c;
      } else {
        if (c === '"' && field.length === 0) quoted = true;
        else if (c === ",") { row.push(field); field = ""; }
        else if (c === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
        else if (c !== "\r") field += c;
      }
    }
    if (field.length || row.length) { row.push(field); rows.push(row); }
    if (!rows.length) return [];
    const headers = rows.shift().map(h => clean(h).replace(/^\uFEFF/, "").toLowerCase());
    return rows.filter(r => r.some(v => clean(v))).map(r => {
      const obj = {};
      headers.forEach((h, i) => obj[h] = clean(r[i]));
      return obj;
    });
  }

  function showProduct(product, barcode) {
    emptyState.hidden = true; notFound.hidden = true; result.hidden = false;
    $("productName").textContent = product.name || "منتج بدون اسم";
    $("productBrand").textContent = product.brand || "";
    $("productBarcode").textContent = barcode;
    const imageUrl = product.image_url || "";
    const imageWrap = $("productImageWrap");
    const image = $("productImage");
    if (imageUrl && /^https?:\/\//i.test(imageUrl)) {
      image.src = imageUrl;
      image.alt = product.name ? "صورة " + product.name : "صورة المنتج";
      imageWrap.hidden = false;
      image.onerror = () => { imageWrap.hidden = true; };
    } else {
      image.removeAttribute("src");
      imageWrap.hidden = true;
    }
    const detailFields = [
      ["category", "التصنيف"],
      ["size", "الحجم / الوزن"],
      ["price", "السعر"],
      ["quantity", "الكمية"],
      ["location", "مكان التخزين"],
      ["supplier", "المورد"]
    ];
    const details = $("productDetails");
    details.replaceChildren();
    detailFields.forEach(([key, label]) => {
      if (!product[key]) return;
      const card = document.createElement("div");
      card.className = "detail";
      const caption = document.createElement("span");
      caption.textContent = label;
      const value = document.createElement("strong");
      value.textContent = product[key];
      card.append(caption, value);
      details.append(card);
    });
    const description = $("productDescriptionWrap");
    if (product.description) {
      $("productDescription").textContent = product.description;
      description.hidden = false;
    } else description.hidden = true;
    setStatus("تم العثور على المنتج.", "success");
  }

  function searchBarcode(value) {
    const barcode = normalizeBarcode(value);
    if (!barcode) { setStatus("اكتب رقم الباركود أولًا.", "error"); return; }
    input.value = barcode;
    const product = products.get(barcode);
    if (product) showProduct(product, barcode);
    else {
      result.hidden = true; emptyState.hidden = true; notFound.hidden = false;
      setStatus("لم يتم العثور على هذا الرقم في قاعدة البيانات.", "error");
    }
  }

  async function loadProducts() {
    try {
      const response = await fetch(CSV_URL + "?v=" + encodeURIComponent(document.lastModified || "1"), { cache: "no-store" });
      if (!response.ok) throw new Error("HTTP " + response.status);
      const text = await response.text();
      const rows = parseCSV(text);
      products = new Map();
      rows.forEach(row => {
        const barcode = normalizeBarcode(row.barcode);
        if (!barcode) return;
        products.set(barcode, row);
      });
      $("databaseCount").textContent = `${products.size} منتج في قاعدة البيانات`;
      setStatus(`تم تحميل ${products.size} منتج. جاهز للبحث.`, "success");
    } catch (error) {
      $("databaseCount").textContent = "تعذر تحميل قاعدة البيانات";
      setStatus("مش قادر أقرأ data/products.csv. تأكد إن الملف مرفوع في المسار الصحيح.", "error");
      console.error(error);
    }
  }

  async function startScanner() {
    if (!window.ZXingBrowser) {
      setStatus("مكتبة قارئ الباركود لم يتم تحميلها. تأكد من الإنترنت ثم أعد تحميل الصفحة.", "error");
      return;
    }
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      setStatus("المتصفح لا يدعم الكاميرا هنا. افتح الموقع عبر HTTPS وجرب متصفحًا حديثًا.", "error");
      return;
    }
    try {
      startButton.disabled = true;
      setStatus("جاري تشغيل الكاميرا…");
      reader = new ZXingBrowser.BrowserMultiFormatReader();
      controls = await reader.decodeFromVideoDevice(undefined, video, (scanResult, error) => {
        if (scanResult) {
          const text = scanResult.getText();
          searchBarcode(text);
          setStatus("تمت قراءة الباركود: " + text, "success");
          stopScanner();
        }
      });
      active = true;
      cameraBox.classList.add("is-active");
      placeholder.hidden = true;
      stopButton.disabled = false;
      setStatus("وجّه الكاميرا للباركود داخل الإطار.");
    } catch (error) {
      console.error(error);
      setStatus("تعذر تشغيل الكاميرا. اسمح للموقع باستخدام الكاميرا وتأكد أنك تستخدم HTTPS.", "error");
      startButton.disabled = false;
      stopButton.disabled = true;
    }
  }

  function stopScanner() {
    try { if (controls) controls.stop(); } catch (_) {}
    try {
      if (video.srcObject) video.srcObject.getTracks().forEach(track => track.stop());
      video.pause();
      video.srcObject = null;
    } catch (_) {}
    controls = null; reader = null; active = false;
    cameraBox.classList.remove("is-active");
    placeholder.hidden = false;
    startButton.disabled = false;
    stopButton.disabled = true;
  }

  $("searchForm").addEventListener("submit", event => {
    event.preventDefault();
    searchBarcode(input.value);
  });
  startButton.addEventListener("click", startScanner);
  stopButton.addEventListener("click", () => {
    stopScanner();
    setStatus("تم إيقاف الكاميرا.");
  });
  window.addEventListener("pagehide", () => { if (active) stopScanner(); });
  loadProducts();
})();
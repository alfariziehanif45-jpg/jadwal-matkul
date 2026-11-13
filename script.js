// =====================================================
// 1. STATE & KONSTANTA
// =====================================================
const STORAGE_KEY = 'jadwal_kuliah_v1';
const AUDIO_STORAGE_KEY = 'jadwal_audio_v1';
const HARI_SORT = ['Senin','Selasa','Rabu','Kamis','Jumat','Sabtu','Minggu', 'Belum diatur'];
const HARI_MAP  = ['Minggu','Senin','Selasa','Rabu','Kamis','Jumat','Sabtu'];

let daftarMatkul = [];
let bannerAktifId = null;
let audioCtx = null;
let editingId = null;
let customAudioSrc = null;
let customAudioObj = null;

// State Alarm
let ringInterval = null;
let isRinging = false;
let peringatanAktifId = null;

if (typeof pdfjsLib !== 'undefined') {
  pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
}

// =====================================================
// FIX 1: AUTO-UNLOCK AUDIO SAAT KLIK DI MANA SAJA
// =====================================================
// Browser memblokir suara jika belum ada interaksi. 
// Kode ini memastikan setiap klik di layar akan "membangunkan" sistem suara.
document.body.addEventListener('click', () => {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
  if (audioCtx.state === 'suspended') {
    audioCtx.resume();
  }
});

// =====================================================
// 2. UTIL
// =====================================================
function loadData() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    daftarMatkul = raw ? JSON.parse(raw) : [];
  } catch { daftarMatkul = []; }
  
  try {
    customAudioSrc = localStorage.getItem(AUDIO_STORAGE_KEY);
    if (customAudioSrc) {
      customAudioObj = new Audio(customAudioSrc);
      document.getElementById('audio-status').textContent = '✅ Suara kustom aktif.';
    }
  } catch(e) {}
}
function saveData() { localStorage.setItem(STORAGE_KEY, JSON.stringify(daftarMatkul)); }
function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }
function todayKey() {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}
function hariIni() { return HARI_MAP[new Date().getDay()]; }
function nowHHMM() {
  const d = new Date();
  return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
}
function timeToMinutes(hhmm) {
  if (!hhmm) return -1;
  const parts = hhmm.split(':');
  return parseInt(parts[0], 10) * 60 + parseInt(parts[1], 10);
}
function isNowBetween(start, end) {
  if (!start || !end) return false;
  const n = nowHHMM();
  return n >= start && n <= end;
}
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
function capitalize(s) { if (!s) return ''; s = String(s).toLowerCase().trim(); return s.charAt(0).toUpperCase() + s.slice(1); }
function normalizeTime(s) {
  if (!s) return '';
  if (typeof s === 'number' && s >= 0 && s < 1) {
    const totalMin = Math.round(s * 24 * 60);
    return String(Math.floor(totalMin / 60) % 24).padStart(2, '0') + ':' + String(totalMin % 60).padStart(2, '0');
  }
  const m = String(s).match(/(\d{1,2})\s*[:.]\s*(\d{2})/);
  if (!m) return '';
  const h = parseInt(m[1], 10); const mi = parseInt(m[2], 10);
  if (h < 0 || h > 23 || mi < 0 || mi > 59) return '';
  return String(h).padStart(2, '0') + ':' + String(mi).padStart(2, '0');
}

// =====================================================
// 3. AUDIO LOGIC
// =====================================================
function beepDefault() {
  try {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === 'suspended') audioCtx.resume();
    const playTone = (freq, start, dur) => {
      const o = audioCtx.createOscillator(); const g = audioCtx.createGain();
      o.type = 'sine'; o.frequency.value = freq;
      g.gain.setValueAtTime(0.15, start); g.gain.exponentialRampToValueAtTime(0.001, start + dur);
      o.connect(g); g.connect(audioCtx.destination); o.start(start); o.stop(start + dur);
    };
    const t = audioCtx.currentTime; playTone(880, t, 0.2); playTone(1100, t + 0.3, 0.2);
  } catch (e) { console.log('AudioContext error:', e); }
}

function playSingleSound() {
  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  if (audioCtx.state === 'suspended') audioCtx.resume();

  if (customAudioObj) {
    customAudioObj.loop = false; customAudioObj.currentTime = 0;
    customAudioObj.play().catch(() => beepDefault());
  } else beepDefault();
}

function startRinging() {
  if (isRinging) return; 
  isRinging = true;
  
  if (customAudioObj) {
    customAudioObj.loop = true; customAudioObj.currentTime = 0;
    customAudioObj.play().catch(() => { ringInterval = setInterval(beepDefault, 1200); });
  } else {
    ringInterval = setInterval(beepDefault, 1200);
  }
}

function stopRinging() {
  if (!isRinging) return; 
  isRinging = false;
  if (customAudioObj) { customAudioObj.pause(); customAudioObj.currentTime = 0; customAudioObj.loop = false; }
  if (ringInterval) { clearInterval(ringInterval); ringInterval = null; }
}

// Audio Upload & Reset
document.getElementById('audio-input').addEventListener('change', (e) => {
  const file = e.target.files[0]; if (!file) return;
  const statusEl = document.getElementById('audio-status');
  if (file.size > 2 * 1024 * 1024) {
    statusEl.textContent = '❌ File terlalu besar (Maks 2MB).'; statusEl.style.color = '#ef4444';
    e.target.value = ''; return;
  }
  const reader = new FileReader();
  reader.onload = (ev) => {
    try {
      customAudioSrc = ev.target.result;
      localStorage.setItem(AUDIO_STORAGE_KEY, customAudioSrc);
      customAudioObj = new Audio(customAudioSrc);
      statusEl.textContent = `✅ Suara "${file.name}" aktif.`; statusEl.style.color = '#10b981';
      playSingleSound();
    } catch (err) {
      statusEl.textContent = '❌ Gagal simpan audio. Memori penuh.'; statusEl.style.color = '#ef4444';
    }
  };
  reader.readAsDataURL(file); e.target.value = '';
});

document.getElementById('btn-reset-audio').addEventListener('click', () => {
  if (!confirm('Kembalikan ke suara default (Beep)?')) return;
  localStorage.removeItem(AUDIO_STORAGE_KEY); customAudioSrc = null; customAudioObj = null;
  const statusEl = document.getElementById('audio-status');
  statusEl.textContent = '🔄 Menggunakan suara default.'; statusEl.style.color = '#6366f1';
});

// =====================================================
// FIX 2: FITUR TEST ALARM 20 MENIT
// =====================================================
document.getElementById('btn-test-alarm').addEventListener('click', () => {
  if (daftarMatkul.length === 0) {
    alert('Silakan tambahkan 1 matkul terlebih dahulu untuk melakukan test.');
    return;
  }
  
  // Ambil matkul pertama sebagai contoh
  const m = daftarMatkul[0];
  peringatanAktifId = m.id;
  
  // Tampilkan banner
  tampilkanBannerPeringatan(m);
  
  // Bunyikan suara
  startRinging();
  
  // Coba tembakkan Notifikasi Browser
  if ("Notification" in window && Notification.permission === "granted") {
    new Notification("⏰ Test Peringatan", {
      body: `Matkul ${m.nama} akan segera dimulai! (Ini hanya test)`,
      icon: "https://cdn-icons-png.flaticon.com/512/3233/3233pojok.png" // optional icon
    });
  }
});

// =====================================================
// 4. RENDER & LIST
// =====================================================
function getFilteredData() {
  const filterSem = document.getElementById('filter-semester-tampil').value;
  let displayData = daftarMatkul;
  if (filterSem) displayData = displayData.filter(m => String(m.semester) === String(filterSem));
  return [...displayData].sort((a, b) => {
    const d = HARI_SORT.indexOf(a.hari) - HARI_SORT.indexOf(b.hari);
    return d !== 0 ? d : (a.mulai || '').localeCompare(b.mulai || '');
  });
}

function renderSemuaMatkul() {
  const el = document.getElementById('list-matkul');
  const filterSem = document.getElementById('filter-semester-tampil').value;
  const displayData = getFilteredData();
  
  document.getElementById('total-matkul-badge').textContent = `${displayData.length} Matkul`;

  if (displayData.length === 0) {
    el.innerHTML = filterSem 
      ? `<p class="hint" style="text-align:center; padding:2rem;">Tidak ada matkul untuk Semester ${filterSem}.</p>` 
      : '<p class="hint" style="text-align:center; padding:2rem;">Belum ada data. Silakan tambah atau upload file.</p>';
    return;
  }
  
  el.innerHTML = displayData.map(m => `
    <div class="matkul-item">
      <div class="matkul-info">
        <strong>${escapeHtml(m.nama)}</strong>
        <div class="matkul-meta">
          <span class="badge">📅 ${escapeHtml(m.hari)}</span>
          <span class="badge">⏰ ${m.mulai && m.selesai ? `${m.mulai} - ${m.selesai}` : 'Belum diatur'}</span>
          <span class="badge">🚪 ${escapeHtml(m.kelas || '-')}</span>
          <span class="badge">📖 Sem ${m.semester}</span>
        </div>
      </div>
      <div class="matkul-actions">
        <button class="btn-icon btn-edit" data-id="${m.id}">✏️ Edit</button>
        <button class="btn-icon btn-hapus" data-id="${m.id}">🗑️ Hapus</button>
      </div>
    </div>
  `).join('');
  
  el.querySelectorAll('.btn-hapus').forEach(b => b.addEventListener('click', () => hapusMatkul(b.dataset.id)));
  el.querySelectorAll('.btn-edit').forEach(b => b.addEventListener('click', () => mulaiEdit(b.dataset.id)));
}

document.getElementById('filter-semester-tampil').addEventListener('change', renderSemuaMatkul);

// Download
document.getElementById('btn-download').addEventListener('click', () => {
  const filterSem = document.getElementById('filter-semester-tampil').value;
  const dataToDownload = getFilteredData();
  if (dataToDownload.length === 0) { alert('Tidak ada data untuk diunduh.'); return; }
  
  const excelData = dataToDownload.map(m => ({
    'Nama Mata Kuliah': m.nama, 'Hari': m.hari,
    'Jam Mulai': m.mulai || '-', 'Jam Selesai': m.selesai || '-',
    'Kelas / Ruang': m.kelas || '-', 'Semester': m.semester
  }));

  const ws = XLSX.utils.json_to_sheet(excelData);
  const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, 'Jadwal Kuliah');
  XLSX.writeFile(wb, filterSem ? `Jadwal_Semester_${filterSem}.xlsx` : `Jadwal_Semua.xlsx`);
});

// =====================================================
// 5. CRUD
// =====================================================
function _pushMatkul(data) {
  daftarMatkul.push({
    id: uid(), nama: String(data.nama).trim(), hari: capitalize(data.hari) || 'Belum diatur',
    mulai: data.mulai || '', selesai: data.selesai || '',
    kelas: String(data.kelas || '-').trim() || '-', semester: Number(data.semester) || 1,
    konfirmasi: {}
  });
}
function tambahMatkul(data) { _pushMatkul(data); saveData(); renderSemuaMatkul(); }
function hapusMatkul(id) {
  if (!confirm('Hapus matkul ini?')) return;
  daftarMatkul = daftarMatkul.filter(m => m.id !== id);
  saveData(); renderSemuaMatkul(); if (bannerAktifId === id) sembunyikanBanner();
}

// =====================================================
// 6. FORM
// =====================================================
function mulaiEdit(id) {
  const m = daftarMatkul.find(x => x.id === id); if (!m) return;
  editingId = id;
  document.getElementById('form-title').textContent = '✏️ Edit Matkul';
  document.getElementById('nama').value = m.nama;
  document.getElementById('hari').value = m.hari === 'Belum diatur' ? '' : m.hari;
  document.getElementById('mulai').value = m.mulai || '';
  document.getElementById('selesai').value = m.selesai || '';
  document.getElementById('kelas').value = m.kelas === '-' ? '' : m.kelas;
  document.getElementById('semester').value = m.semester;
  document.getElementById('btn-submit-matkul').textContent = 'Simpan Perubahan';
  document.getElementById('btn-batal-edit').classList.remove('hidden');
  window.scrollTo({ top: 0, behavior: 'smooth' });
}
function batalEdit() {
  editingId = null;
  document.getElementById('form-title').textContent = '➕ Tambah Matkul';
  document.getElementById('form-matkul').reset();
  document.getElementById('btn-submit-matkul').textContent = 'Tambah Matkul';
  document.getElementById('btn-batal-edit').classList.add('hidden');
}
document.getElementById('btn-batal-edit').addEventListener('click', batalEdit);

document.getElementById('form-matkul').addEventListener('submit', e => {
  e.preventDefault();
  const data = {
    nama: document.getElementById('nama').value,
    hari: document.getElementById('hari').value || 'Belum diatur',
    mulai: document.getElementById('mulai').value,
    selesai: document.getElementById('selesai').value,
    kelas: document.getElementById('kelas').value || '-',
    semester: document.getElementById('semester').value,
  };
  if (!data.nama || !data.semester) { alert('Nama dan Semester wajib diisi.'); return; }
  if (data.mulai && data.selesai && data.mulai >= data.selesai) { alert('Jam selesai harus setelah jam mulai.'); return; }
  
  if (editingId) {
    const m = daftarMatkul.find(x => x.id === editingId);
    if (m) {
      m.nama = data.nama.trim(); m.hari = capitalize(data.hari) || 'Belum diatur';
      m.mulai = data.mulai; m.selesai = data.selesai;
      m.kelas = data.kelas.trim() || '-'; m.semester = Number(data.semester);
    }
    batalEdit(); saveData(); renderSemuaMatkul();
  } else { tambahMatkul(data); e.target.reset(); }
});

// =====================================================
// 7. IMPORT FILE
// =====================================================
document.getElementById('upload-semester').addEventListener('change', (e) => {
  document.getElementById('filter-semester-tampil').value = e.target.value;
  renderSemuaMatkul();
});

document.getElementById('file-input').addEventListener('change', async e => {
  const file = e.target.files[0]; if (!file) return;
  const statusEl = document.getElementById('upload-status');
  statusEl.textContent = '⏳ Membaca file...'; statusEl.style.color = '#9ca3af';

  try {
    const lname = file.name.toLowerCase();
    let entries = [];

    if (lname.endsWith('.xlsx') || lname.endsWith('.xls')) {
      const csvText = await extractExcel(file); entries = parseCSV(csvText);
      if (!entries.length) entries = parseFreeText(csvText);
    } else {
      const text = await extractText(file);
      if (lname.endsWith('.json')) entries = parseJSON(text);
      else if (lname.endsWith('.csv') || lname.endsWith('.txt') || lname.endsWith('.rtf')) {
        const csv = parseCSV(text); entries = csv.length > 0 ? csv : parseFreeText(text);
      } else entries = parseFreeText(text);
    }

    if (!entries.length) throw new Error('Tidak ada data valid.');

    const overrideSem = document.getElementById('upload-semester').value;
    let n = 0;
    
    entries.forEach(entry => {
      if (!entry.nama) return;
      if (overrideSem && entry.semester) {
          const fileSem = String(entry.semester).replace(/\D/g, '');
          if (fileSem && fileSem !== String(overrideSem)) return; 
      }
      _pushMatkul({
        nama: entry.nama, hari: entry.hari || 'Belum diatur', mulai: entry.mulai || '',
        selesai: entry.selesai || '', kelas: entry.kelas || '-', semester: overrideSem || entry.semester || 1
      });
      n++;
    });

    if (n === 0) throw new Error('Data tidak sesuai filter semester.');
    saveData();
    if (overrideSem) document.getElementById('filter-semester-tampil').value = overrideSem;
    renderSemuaMatkul();
    
    statusEl.textContent = `✅ Berhasil import ${n} matkul.`; statusEl.style.color = '#10b981';
  } catch (err) {
    statusEl.textContent = '❌ ' + (err.message || 'Gagal import'); statusEl.style.color = '#ef4444';
  }
  e.target.value = '';
});

async function extractText(file) {
  const name = file.name.toLowerCase();
  if (name.endsWith('.pdf')) return await extractPdfText(file);
  if (name.endsWith('.docx')) {
    const buf = await file.arrayBuffer();
    const result = await mammoth.extractRawText({ arrayBuffer: buf });
    return result.value || '';
  }
  return await file.text();
}

async function extractExcel(file) {
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: 'array', cellDates: false });
  if (!wb.SheetNames || !wb.SheetNames.length) return '';
  let combined = '';
  wb.SheetNames.forEach(name => {
    const sheet = wb.Sheets[name];
    if (!sheet) return;
    const csv = XLSX.utils.sheet_to_csv(sheet, { blankrows: false, FS: ',' });
    if (csv && csv.trim()) combined += csv.trim() + '\n';
  });
  return combined;
}

async function extractPdfText(file) {
  const buf = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: buf }).promise;
  let full = '';
  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const content = await page.getTextContent();
    const items = content.items.filter(it => it.str && it.str.trim());
    const lineMap = new Map();
    for (const it of items) {
      const y = Math.round(it.transform[5]);
      if (!lineMap.has(y)) lineMap.set(y, []);
      lineMap.get(y).push({ x: it.transform[4], s: it.str });
    }
    const ys = [...lineMap.keys()].sort((a, b) => b - a);
    for (const y of ys) {
      const lineItems = lineMap.get(y).sort((a, b) => a.x - b.x);
      full += lineItems.map(i => i.s).join(' ') + '\n';
    }
    full += '\n';
  }
  return full;
}

// =====================================================
// 8. PARSER DATA
// =====================================================
function parseCSV(text) {
  const lines = text.split(/\r?\n/).filter(l => l.trim());
  if (!lines.length) return [];
  const first = lines[0];
  let delim = ','; if (first.includes('\t')) delim = '\t'; else if (first.includes(';')) delim = ';';
  
  const parseLine = (line) => {
    const out = []; let cur = ''; let inQ = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (inQ) {
        if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; }
        else if (c === '"') inQ = false; else cur += c;
      } else {
        if (c === '"') inQ = true; else if (c === delim) { out.push(cur.trim()); cur = ''; } else cur += c;
      }
    }
    out.push(cur.trim()); return out;
  };

  const rows = lines.map(parseLine);
  const isHeader = rows[0].some(cell => cell.toLowerCase().includes('nama') || cell.toLowerCase().includes('mata'));
  let idx = { nama: 0, hari: 1, mulai: 2, selesai: 3, kelas: 4, semester: 5 };
  let start = 0;

  if (isHeader) {
    start = 1;
    const header = rows[0].map(h => h.toLowerCase());
    const find = (arr) => header.findIndex(h => arr.some(k => h.includes(k)));
    idx = { nama: find(['nama','mata','matkul']), hari: find(['hari','day']), mulai: find(['mulai','jam']),
            selesai: find(['selesai','akhir']), kelas: find(['kelas','ruang']), semester: find(['semester','sem']) };
    if (idx.nama < 0) idx.nama = 0;
  }

  const hasil = [];
  for (let i = start; i < rows.length; i++) {
    const r = rows[i]; if (r.length === 0) continue;
    const nama = (idx.nama >= 0 && r[idx.nama]) ? r[idx.nama].trim() : '';
    if (!nama || /^(semester|total|rekap|kode)/i.test(nama)) continue;
    
    let hari = (idx.hari >= 0 && r[idx.hari]) ? capitalize(r[idx.hari]) : 'Belum diatur';
    if (hari && !HARI_SORT.includes(hari)) hari = 'Belum diatur';
    let semesterRaw = (idx.semester >= 0 && r[idx.semester]) ? r[idx.semester] : '';
    let semester = semesterRaw.replace(/\D/g, '');

    hasil.push({
      nama, hari,
      mulai: (idx.mulai >= 0 && r[idx.mulai]) ? normalizeTime(r[idx.mulai]) : '',
      selesai: (idx.selesai >= 0 && r[idx.selesai]) ? normalizeTime(r[idx.selesai]) : '',
      kelas: (idx.kelas >= 0 && r[idx.kelas]) ? r[idx.kelas].trim() : '-', semester
    });
  }
  return hasil;
}

function parseJSON(text) {
  const data = JSON.parse(text); if (!Array.isArray(data)) throw new Error('Format JSON salah.');
  return data.map(d => {
    let hari = capitalize(d.hari || d.day || '');
    if (hari && !HARI_SORT.includes(hari)) hari = 'Belum diatur';
    if (!hari) hari = 'Belum diatur';
    let sem = (d.semester != null ? String(d.semester) : '').replace(/\D/g, '');
    return {
      nama: d.nama || d.name || d.mata_kuliah || d.matkul || '', hari,
      mulai: normalizeTime(d.mulai || d.start || ''), selesai: normalizeTime(d.selesai || d.end || ''),
      kelas: d.kelas || d.room || d.class || d.ruang || '-', semester: sem
    };
  }).filter(e => e.nama);
}

function parseFreeText(text) {
  const lines = text.split(/\r?\n/).map(l => l.replace(/\s+/g, ' ').trim()).filter(Boolean);
  const dayRegex  = /\b(Senin|Selasa|Rabu|Kamis|Jumat|Sabtu|Minggu)\b/i;
  const timeRegex = /(\d{1,2})[:.](\d{2})\s*(?:-|–|~|s\/d|to)\s*(\d{1,2})[:.](\d{2})/i;
  const results = []; let lastName = null;

  for (const line of lines) {
    const dayMatch = line.match(dayRegex); const timeMatch = line.match(timeRegex);
    if (dayMatch && timeMatch) {
      const hari = capitalize(dayMatch[1]);
      const mulai = timeMatch[1].padStart(2, '0') + ':' + timeMatch[2];
      const selesai = timeMatch[3].padStart(2, '0') + ':' + timeMatch[4];
      let rest = line.replace(dayRegex, ' ').replace(timeRegex, ' ')
        .replace(/^[\s,;|:\-–—]+|[\s,;|:\-–—]+$/g, '').replace(/\s+/g, ' ').trim();
      
      let nama = '', kelas = '', semester = '';
      const sepParts = rest.split(/\s*[|;,]\s*/).map(s => s.trim()).filter(Boolean);
      
      if (sepParts.length >= 2) { nama = sepParts[0]; kelas = sepParts[1]; semester = sepParts[2] || ''; }
      else {
        let working = rest;
        const semMatch = working.match(/\s+(\d{1,2})$/);
        if (semMatch) { semester = semMatch[1]; working = working.slice(0, semMatch.index).trim(); }
        const clsMatch = working.match(/(?:^|\s)((?:lab(?:oratorium)?|ruang|kelas|gedung|room)\b.*)$/i);
        if (clsMatch) { kelas = clsMatch[1].trim(); nama = working.slice(0, clsMatch.index).trim(); }
        else nama = working;
      }
      if (!nama && lastName) { nama = lastName; lastName = null; }
      if (nama) results.push({ nama, hari, mulai, selesai, kelas, semester });
    } else if (!dayMatch && !timeMatch) {
      if (line.length >= 3 && line.length < 80 && /[A-Za-z]/.test(line)) lastName = line;
    }
  }
  return results;
}

// =====================================================
// 9. PENCARIAN
// =====================================================
document.getElementById('btn-cari').addEventListener('click', () => {
  const hari = document.getElementById('cari-hari').value;
  const jam = document.getElementById('cari-jam').value;
  const kelas = document.getElementById('cari-kelas').value.toLowerCase().trim();
  const semester = document.getElementById('cari-semester').value;

  const hasil = daftarMatkul.filter(m => {
    if (hari && m.hari !== hari) return false;
    if (semester && String(m.semester) !== String(semester)) return false;
    if (kelas && !(m.kelas || '').toLowerCase().includes(kelas)) return false;
    if (jam && (!m.mulai || !m.selesai || !(m.mulai <= jam && jam <= m.selesai))) return false;
    return true;
  });

  const el = document.getElementById('hasil-cari');
  if (hasil.length === 0) {
    el.innerHTML = '<p class="hint text-center">Tidak ada matkul cocok.</p>'; return;
  }
  
  el.innerHTML = `<p class="hint">Ditemukan ${hasil.length} matkul:</p>` + hasil.map(m => `
    <div style="background:var(--bg-input); padding:0.75rem; border-radius:8px; margin-bottom:0.5rem;">
      <strong style="display:block; font-size:0.9rem; color:white;">${escapeHtml(m.nama)}</strong>
      <span style="font-size:0.75rem; color:var(--text-muted);">${m.hari}, ${m.mulai}-${m.selesai} (Sem ${m.semester})</span>
    </div>
  `).join('');
});

document.getElementById('btn-reset').addEventListener('click', () => {
  ['cari-hari','cari-jam','cari-kelas','cari-semester'].forEach(id => document.getElementById(id).value = '');
  document.getElementById('hasil-cari').innerHTML = '';
});

// =====================================================
// 10. ALARM & BANNER (OTOMATIS)
// =====================================================
function cekJadwal() {
  const hari = hariIni(); const tgl = todayKey(); const nowMin = timeToMinutes(nowHHMM());

  // 1. 20 Menit Sebelum
  const akanMulai = daftarMatkul.find(m => {
    if (m.hari !== hari || !m.mulai) return false;
    const diff = timeToMinutes(m.mulai) - nowMin;
    // Cek jika selisih antara 1 - 20 menit
    return diff <= 20 && diff > 0 && !(m.konfirmasi && m.konfirmasi['warn_' + tgl]);
  });

  if (akanMulai) {
    if (!isRinging) {
      peringatanAktifId = akanMulai.id;
      tampilkanBannerPeringatan(akanMulai);
      startRinging(); 
      
      // Tembak Notifikasi OS (Browser)
      if ("Notification" in window && Notification.permission === "granted") {
        new Notification("⏰ Peringatan 20 Menit", {
          body: `Matkul ${akanMulai.nama} (${akanMulai.mulai}) akan segera dimulai!`,
        });
      }
    }
    return;
  }

  // 2. Sedang Berlangsung
  const aktif = daftarMatkul.find(m =>
    m.hari === hari && m.mulai && m.selesai && isNowBetween(m.mulai, m.selesai) && !(m.konfirmasi && m.konfirmasi[tgl])
  );

  if (aktif) {
    if (bannerAktifId !== aktif.id && !isRinging) {
      stopRinging(); tampilkanBanner(aktif); playSingleSound();
    }
  } else {
    if (!isRinging) sembunyikanBanner();
  }
}

function tampilkanBannerPeringatan(m) {
  document.getElementById('banner-title').textContent = '⏰ Peringatan Kuliah';
  document.getElementById('banner-text').innerHTML = `<b>20 Menit Lagi!</b> ${escapeHtml(m.nama)} (${m.mulai}, ${m.kelas}) segera dimulai.`;
  document.getElementById('banner').classList.remove('hidden');
  document.getElementById('banner-yes').classList.add('hidden');
  document.getElementById('banner-no').classList.add('hidden');
  document.getElementById('banner-stop').classList.remove('hidden');
}

function tampilkanBanner(m) {
  bannerAktifId = m.id;
  document.getElementById('banner-title').textContent = '⏰ Pengingat Kuliah';
  document.getElementById('banner-text').innerHTML = `${escapeHtml(m.nama)} (${m.mulai}–${m.selesai}) sedang berlangsung. Hadir?`;
  document.getElementById('banner').classList.remove('hidden');
  document.getElementById('banner-stop').classList.add('hidden');
  document.getElementById('banner-yes').classList.remove('hidden');
  document.getElementById('banner-no').classList.remove('hidden');
}

function sembunyikanBanner() {
  if (isRinging) return;
  bannerAktifId = null; peringatanAktifId = null;
  document.getElementById('banner').classList.add('hidden');
}

document.getElementById('banner-stop').addEventListener('click', () => {
  if (peringatanAktifId) {
    const m = daftarMatkul.find(x => x.id === peringatanAktifId);
    if (m) { if (!m.konfirmasi) m.konfirmasi = {}; m.konfirmasi['warn_' + todayKey()] = true; saveData(); }
  }
  stopRinging(); peringatanAktifId = null; sembunyikanBanner();
});

document.getElementById('banner-yes').addEventListener('click', () => konfirmasiBanner('hadir'));
document.getElementById('banner-no').addEventListener('click', () => konfirmasiBanner('tidak'));

function konfirmasiBanner(status) {
  if (!bannerAktifId) return;
  const m = daftarMatkul.find(x => x.id === bannerAktifId);
  if (!m) return;
  if (!m.konfirmasi) m.konfirmasi = {};
  m.konfirmasi[todayKey()] = status; saveData();
  
  document.getElementById('banner-text').textContent = status === 'hadir' ? '✅ Kehadiran dikonfirmasi.' : '❌ Dicatat tidak hadir.';
  document.getElementById('banner-yes').classList.add('hidden');
  document.getElementById('banner-no').classList.add('hidden');
  setTimeout(sembunyikanBanner, 1500);
}

// =====================================================
// FIX 3: TOMBOL IZINKAN NOTIFIKASI & SUARA
// =====================================================
document.getElementById('btn-aktif-suara').addEventListener('click', () => {
  // 1. Paksa hidupkan Audio Context
  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  if (audioCtx.state === 'suspended') audioCtx.resume();
  
  // 2. Bunyikan suara sekali sebagai penanda sukses
  playSingleSound();

  // 3. Minta izin Notifikasi OS (Browser)
  if ("Notification" in window) {
    Notification.requestPermission().then(permission => {
      if (permission === "granted") {
        alert("✅ Suara dan Notifikasi berhasil diaktifkan!");
      } else {
        alert("⚠️ Izin notifikasi ditolak. Pastikan untuk mengizinkannya di pengaturan browser.");
      }
    });
  } else {
    alert("✅ Suara diaktifkan! (Browser ini tidak mendukung notifikasi pop-up)");
  }
});

// =====================================================
// 11. INIT
// =====================================================
loadData();
renderSemuaMatkul();
cekJadwal();
setInterval(cekJadwal, 30 * 1000);
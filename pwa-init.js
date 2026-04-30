/**
 * ═══════════════════════════════════════════════════════════════
 *  STOCKVIZ — PWA Init
 *  À inclure dans stock.html ET auth.html (avant </body>)
 *
 *  Fonctionnalités :
 *  1. Enregistrement du Service Worker
 *  2. Bannière "Installer l'app"
 *  3. Gestion des Push Notifications
 *  4. Scanner de code-barres (caméra)
 * ═══════════════════════════════════════════════════════════════
 */

/* ════════════════════════════════════════════
   1. SERVICE WORKER
════════════════════════════════════════════ */
if ('serviceWorker' in navigator) {
  window.addEventListener('load', async () => {
    try {
      const reg = await navigator.serviceWorker.register('/StockViz/sw.js', {
        scope: '/StockViz/'
      });
      console.log('[PWA] SW enregistré :', reg.scope);
      window._swReg = reg; // exposé pour les notifications
    } catch (err) {
      console.warn('[PWA] SW échec :', err);
    }
  });
}

/* ════════════════════════════════════════════
   2. BANNIÈRE "INSTALLER L'APP"
   Capturée sur beforeinstallprompt, affichée
   quand l'utilisateur est connecté.
════════════════════════════════════════════ */
let _installPrompt = null;

window.addEventListener('beforeinstallprompt', e => {
  e.preventDefault();
  _installPrompt = e;
  // Affiche un bouton discret dans l'UI si on est sur stock.html
  showInstallBanner();
});

function showInstallBanner() {
  if (!_installPrompt) return;
  // Évite de l'afficher si déjà installée
  if (window.matchMedia('(display-mode: standalone)').matches) return;
  // Cherche un éventuel placeholder dans le DOM
  const placeholder = document.getElementById('pwa-install-btn');
  if (placeholder) {
    placeholder.style.display = 'flex';
    placeholder.onclick = triggerInstall;
  }
}

async function triggerInstall() {
  if (!_installPrompt) return;
  _installPrompt.prompt();
  const { outcome } = await _installPrompt.userChoice;
  console.log('[PWA] Install outcome:', outcome);
  _installPrompt = null;
  const btn = document.getElementById('pwa-install-btn');
  if (btn) btn.style.display = 'none';
}

/* ════════════════════════════════════════════
   3. PUSH NOTIFICATIONS
════════════════════════════════════════════ */

// Clé publique VAPID — génère la tienne sur :
// https://web-push-codelab.glitch.me/
// ou : npx web-push generate-vapid-keys
const VAPID_PUBLIC_KEY = 'REMPLACE_PAR_TA_CLE_VAPID_PUBLIQUE';

/**
 * Demande la permission et abonne l'utilisateur aux push.
 * Appelle cette fonction depuis le panneau Paramètres de l'app.
 * Retourne la subscription ou null.
 */
async function subscribeToPush() {
  if (!('PushManager' in window)) {
    console.warn('[Push] Non supporté sur ce navigateur');
    return null;
  }

  // Demande la permission
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') {
    console.warn('[Push] Permission refusée');
    return null;
  }

  const reg = window._swReg || await navigator.serviceWorker.ready;

  try {
    const subscription = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY)
    });

    console.log('[Push] Abonné :', JSON.stringify(subscription));

    // ──────────────────────────────────────────────────────────
    // TODO : envoyer `subscription` à ton backend / Supabase
    // pour stocker endpoint + keys par utilisateur.
    //
    // Exemple avec Supabase :
    // await sb.from('push_subscriptions').upsert({
    //   user_id: currentUser.id,
    //   endpoint: subscription.endpoint,
    //   p256dh: btoa(String.fromCharCode(...new Uint8Array(subscription.getKey('p256dh')))),
    //   auth:   btoa(String.fromCharCode(...new Uint8Array(subscription.getKey('auth'))))
    // });
    // ──────────────────────────────────────────────────────────

    return subscription;
  } catch (err) {
    console.error('[Push] Erreur abonnement :', err);
    return null;
  }
}

/**
 * Vérifie si l'utilisateur est déjà abonné.
 */
async function getPushSubscription() {
  if (!('PushManager' in window)) return null;
  const reg = window._swReg || await navigator.serviceWorker.ready;
  return reg.pushManager.getSubscription();
}

/**
 * Vérifie les stocks bas et envoie une notification locale
 * (sans backend — fonctionne même sans VAPID).
 * Appelle depuis la boucle principale de stock.html.
 */
function checkStockAlertsAndNotify(spaces) {
  if (Notification.permission !== 'granted') return;

  const lowStock = [];
  for (const space of spaces) {
    for (const p of space.products) {
      const pct = p.max > 0 ? Math.round((p.qty / p.max) * 100) : 0;
      if (pct <= (p.alert || 20)) {
        lowStock.push({ name: p.name, space: space.name, qty: p.qty, max: p.max, pct });
      }
    }
  }

  if (lowStock.length === 0) return;

  // Grouper en une seule notif pour ne pas spammer
  const title = lowStock.length === 1
    ? `⚠️ Stock bas — ${lowStock[0].name}`
    : `⚠️ ${lowStock.length} produits en stock bas`;

  const body = lowStock
    .slice(0, 3)
    .map(p => `${p.name} (${p.space}) : ${p.qty}/${p.max}`)
    .join('\n') + (lowStock.length > 3 ? `\n+${lowStock.length - 3} autres…` : '');

  // Notification locale (pas besoin de VAPID)
  new Notification(title, {
    body,
    icon: '/StockViz/icons/icon-192.png',
    tag: 'stockviz-low-stock', // remplace la précédente
    renotify: false
  });
}

/** Utilitaire : convertit la clé VAPID base64 en Uint8Array */
function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - base64String.length % 4) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = atob(base64);
  return new Uint8Array([...rawData].map(c => c.charCodeAt(0)));
}

/* ════════════════════════════════════════════
   4. SCANNER CODE-BARRES
   Utilise la caméra via BarcodeDetector API
   (natif Chrome/Android) avec fallback QuaGGA.
════════════════════════════════════════════ */

let _scannerActive = false;
let _scannerCallback = null;
let _scannerStream = null;

/**
 * Ouvre le scanner de code-barres.
 * @param {function} onScan - callback(code: string)
 *
 * Usage dans stock.html :
 *   openBarcodeScanner(code => {
 *     // Cherche un produit par son code-barres
 *     const product = findProductByBarcode(code);
 *     if (product) adjustQty(product.sIdx, product.pIdx, -1);
 *   });
 */
async function openBarcodeScanner(onScan) {
  if (_scannerActive) return;

  _scannerCallback = onScan;

  // Crée l'overlay scanner
  const overlay = document.createElement('div');
  overlay.id = 'barcode-scanner-overlay';
  overlay.innerHTML = `
    <div style="
      position:fixed;inset:0;z-index:9999;
      background:#000;
      display:flex;flex-direction:column;
      align-items:center;justify-content:center;
    ">
      <div style="position:relative;width:100%;max-width:400px;">
        <video id="barcode-video" autoplay playsinline muted
          style="width:100%;border-radius:12px;display:block;"></video>
        <!-- Viseur -->
        <div style="
          position:absolute;inset:20%;
          border:2px solid #1D9E75;
          border-radius:8px;
          box-shadow:0 0 0 9999px rgba(0,0,0,0.5);
        "></div>
        <div style="
          position:absolute;bottom:-48px;left:0;right:0;
          text-align:center;color:#fff;font-size:14px;opacity:0.7;
        ">Pointez vers un code-barres</div>
      </div>
      <button onclick="closeBarcodeScanner()" style="
        margin-top:72px;
        background:rgba(255,255,255,0.1);
        color:#fff;border:1px solid rgba(255,255,255,0.3);
        padding:10px 28px;border-radius:50px;
        font-size:15px;cursor:pointer;
      ">✕ Annuler</button>
    </div>
  `;
  document.body.appendChild(overlay);

  try {
    _scannerStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'environment' } // caméra arrière
    });
    const video = document.getElementById('barcode-video');
    video.srcObject = _scannerStream;
    _scannerActive = true;

    // Préférence : BarcodeDetector natif (Chrome Android, Safari 17+)
    if ('BarcodeDetector' in window) {
      _startNativeScanner(video);
    } else {
      // Fallback : charger QuaGGA dynamiquement
      _startQuaggaScanner(video);
    }
  } catch (err) {
    console.error('[Scanner] Caméra refusée :', err);
    closeBarcodeScanner();
    if (typeof toast === 'function') toast('⚠️ Accès caméra refusé', 'warn');
  }
}

function _startNativeScanner(video) {
  const detector = new BarcodeDetector({
    formats: ['ean_13', 'ean_8', 'qr_code', 'code_128', 'code_39', 'upc_a', 'upc_e']
  });

  async function scan() {
    if (!_scannerActive) return;
    try {
      const codes = await detector.detect(video);
      if (codes.length > 0) {
        const code = codes[0].rawValue;
        _onBarcodeDetected(code);
        return;
      }
    } catch (e) { /* frame pas encore dispo */ }
    requestAnimationFrame(scan);
  }

  video.addEventListener('play', () => requestAnimationFrame(scan));
}

function _startQuaggaScanner(video) {
  // Charge QuaGGA à la demande
  const script = document.createElement('script');
  script.src = 'https://cdnjs.cloudflare.com/ajax/libs/quagga/0.12.1/quagga.min.js';
  script.onload = () => {
    Quagga.init({
      inputStream: {
        type: 'LiveStream',
        target: video.parentElement,
        constraints: { facingMode: 'environment' }
      },
      decoder: { readers: ['ean_reader', 'ean_8_reader', 'code_128_reader', 'code_39_reader'] },
      locate: true
    }, err => {
      if (err) { console.error('[QuaGGA]', err); return; }
      Quagga.start();
    });
    Quagga.onDetected(result => {
      _onBarcodeDetected(result.codeResult.code);
    });
  };
  document.head.appendChild(script);
}

function _onBarcodeDetected(code) {
  closeBarcodeScanner();
  if (_scannerCallback) _scannerCallback(code);
  _scannerCallback = null;
}

function closeBarcodeScanner() {
  _scannerActive = false;
  if (_scannerStream) {
    _scannerStream.getTracks().forEach(t => t.stop());
    _scannerStream = null;
  }
  if (typeof Quagga !== 'undefined') { try { Quagga.stop(); } catch(e) {} }
  const overlay = document.getElementById('barcode-scanner-overlay');
  if (overlay) overlay.remove();
}

/* ════════════════════════════════════════════
   EXPORT — fonctions disponibles globalement
════════════════════════════════════════════ */
window.PWA = {
  triggerInstall,
  subscribeToPush,
  getPushSubscription,
  checkStockAlertsAndNotify,
  openBarcodeScanner,
  closeBarcodeScanner
};

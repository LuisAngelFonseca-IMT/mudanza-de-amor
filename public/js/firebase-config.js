// ============================================================
// Firebase config — se carga desde env.js (no versionado)
// ============================================================
if (typeof firebaseConfig === 'undefined') {
  console.error('Falta public/js/env.js con la config de Firebase. Copia env.example.js y llena los valores.');
}

firebase.initializeApp(firebaseConfig);

var auth = firebase.auth();
var dbInstance = firebase.firestore();

// Cache de data URLs para no leer el mismo blob dos veces
var _urlCache = {};

// Fotos guardadas como base64 en Firestore (colección "blobs") — sin Storage, sin costo
var assetsAdapter = {
  upload: function(blob, opts) {
    var id = Math.random().toString(36).slice(2) + Date.now().toString(36);
    return new Promise(function(resolve, reject) {
      var reader = new FileReader();
      reader.onload = function() {
        // reader.result es "data:image/jpeg;base64,..."
        _urlCache[id] = reader.result;
        dbInstance.collection('blobs').doc(id).set({
          data: reader.result,
          type: (opts && opts.type) || 'image/jpeg',
          ts: Date.now()
        }).then(function() {
          resolve({ id: id });
        }).catch(reject);
      };
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  },
  delete: function(id) {
    delete _urlCache[id];
    return dbInstance.collection('blobs').doc(id).delete().catch(function() {});
  }
};

// Carga un blob desde Firestore y lo cachea
function loadBlob(id) {
  if (_urlCache[id]) return Promise.resolve(_urlCache[id]);
  return dbInstance.collection('blobs').doc(id).get().then(function(snap) {
    if (snap.exists) {
      _urlCache[id] = snap.data().data;
      return snap.data().data;
    }
    return '';
  });
}

// Resuelve /_blob/ID → data URL desde Firestore
function resolveBlob(el) {
  var src = el.getAttribute('src') || '';
  var m = src.match(/^\/_blob\/(.+)$/);
  if (!m) return;
  var id = m[1];
  if (_urlCache[id]) { el.src = _urlCache[id]; return; }
  el.src = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
  loadBlob(id).then(function(dataUrl) {
    if (dataUrl) el.src = dataUrl;
    else el.alt = 'No se pudo cargar la imagen';
  });
}

// MutationObserver: resuelve automáticamente cualquier img con src="/_blob/..."
var _blobObserver = new MutationObserver(function(mutations) {
  mutations.forEach(function(mut) {
    mut.addedNodes.forEach(function(node) {
      if (node.nodeType !== 1) return;
      if (node.tagName === 'IMG') resolveBlob(node);
      var imgs = node.querySelectorAll ? node.querySelectorAll('img[src^="/_blob/"]') : [];
      imgs.forEach(resolveBlob);
    });
    if (mut.type === 'attributes' && mut.attributeName === 'src' && mut.target.tagName === 'IMG') {
      resolveBlob(mut.target);
    }
  });
});
_blobObserver.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['src'] });

// Interceptar fetch('/_blob/ID') para que blobDe() funcione
var _origFetch = window.fetch;
window.fetch = function(url, opts) {
  if (typeof url === 'string' && url.indexOf('/_blob/') === 0) {
    var id = url.replace('/_blob/', '');
    return loadBlob(id).then(function(dataUrl) {
      if (!dataUrl) return new Response('', { status: 404 });
      // Convertir data URL a blob para el Response
      var parts = dataUrl.split(',');
      var mime = parts[0].match(/:(.*?);/)[1];
      var raw = atob(parts[1]);
      var arr = new Uint8Array(raw.length);
      for (var i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
      return new Response(new Blob([arr], { type: mime }), { status: 200 });
    });
  }
  return _origFetch.apply(this, arguments);
};

// window.claude.use() — adaptador compatible con el código original
window.claude = {
  use: function(what) {
    if (what === 'db') {
      return auth.signInAnonymously().then(function() {
        return dbInstance;
      }).catch(function(err) {
        console.error('Auth error:', err);
        return null;
      });
    }
    if (what === 'assets') {
      return Promise.resolve(assetsAdapter);
    }
    if (what === 'sample') {
      return Promise.resolve(null);
    }
    return Promise.resolve(null);
  }
};

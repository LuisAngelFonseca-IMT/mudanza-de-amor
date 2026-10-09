// ============================================================
// Firebase config — reemplaza estos valores con los de tu proyecto
// Ve a https://console.firebase.google.com → tu proyecto → Configuración → General
// ============================================================
var firebaseConfig = {
  apiKey: "TU_API_KEY",
  authDomain: "TU_PROYECTO.firebaseapp.com",
  projectId: "TU_PROYECTO",
  storageBucket: "TU_PROYECTO.firebasestorage.app",
  messagingSenderId: "123456789",
  appId: "TU_APP_ID"
};

firebase.initializeApp(firebaseConfig);

// Auth — login anónimo para que funcione sin registro
var auth = firebase.auth();
var dbInstance = firebase.firestore();
var storageRef = firebase.storage().ref();

// Cache de URLs resueltas para no pedir la misma URL dos veces
var _urlCache = {};

// Adaptador de assets para que la app siga usando assets.upload / assets.delete
var assetsAdapter = {
  upload: function(blob, opts) {
    var id = Math.random().toString(36).slice(2) + Date.now().toString(36);
    var ref = storageRef.child('fotos/' + id);
    return ref.put(blob, { contentType: (opts && opts.type) || 'image/jpeg' }).then(function() {
      return { id: id };
    });
  },
  delete: function(id) {
    delete _urlCache[id];
    return storageRef.child('fotos/' + id).delete().catch(function() {});
  }
};

// Resuelve /_blob/ID → URL real de Firebase Storage
// Usa MutationObserver para que el código existente no necesite cambios
function resolveBlob(el) {
  var src = el.getAttribute('src') || '';
  var m = src.match(/^\/_blob\/(.+)$/);
  if (!m) return;
  var id = m[1];
  if (_urlCache[id]) { el.src = _urlCache[id]; return; }
  el.dataset.blobId = id;
  el.src = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'; // placeholder transparente
  storageRef.child('fotos/' + id).getDownloadURL().then(function(url) {
    _urlCache[id] = url;
    el.src = url;
  }).catch(function() {
    el.alt = 'No se pudo cargar la imagen';
  });
}

// Observa el DOM: cada vez que se inserta un <img> con src="/_blob/..." lo resuelve
var _blobObserver = new MutationObserver(function(mutations) {
  mutations.forEach(function(mut) {
    // Nodos nuevos
    mut.addedNodes.forEach(function(node) {
      if (node.nodeType !== 1) return;
      if (node.tagName === 'IMG') resolveBlob(node);
      var imgs = node.querySelectorAll ? node.querySelectorAll('img[src^="/_blob/"]') : [];
      imgs.forEach(resolveBlob);
    });
    // Atributo src cambiado
    if (mut.type === 'attributes' && mut.attributeName === 'src' && mut.target.tagName === 'IMG') {
      resolveBlob(mut.target);
    }
  });
});
_blobObserver.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['src'] });

// Interceptar fetch('/_blob/ID') para que blobDe() funcione con Storage
var _origFetch = window.fetch;
window.fetch = function(url, opts) {
  if (typeof url === 'string' && url.indexOf('/_blob/') === 0) {
    var id = url.replace('/_blob/', '');
    var cached = _urlCache[id];
    if (cached) return _origFetch(cached, opts);
    return storageRef.child('fotos/' + id).getDownloadURL().then(function(realUrl) {
      _urlCache[id] = realUrl;
      return _origFetch(realUrl, opts);
    });
  }
  return _origFetch.apply(this, arguments);
};

// Conectar — window.claude.use('db') ahora devuelve Firestore directo
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
      // AI features no disponibles sin backend — se puede agregar después
      return Promise.resolve(null);
    }
    return Promise.resolve(null);
  }
};

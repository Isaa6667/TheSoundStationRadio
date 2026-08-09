// Define o nome do cache (bump da versão invalida o layout antigo em cache)
const CACHE_NAME = 'web-radio-v4';

// Lista de arquivos a serem cacheados.
// Os caminhos são relativos ao service worker de propósito: assim o app
// funciona tanto na raiz do domínio (Docker, domínio próprio) quanto em um
// subdiretório, como o /RadioPlayer/ do GitHub Pages.
const urlsToCache = [
  './',
  './index.html',
  './config.js',
  './css/style.css',
  './js/script.js',
  './img/cover.png',
  './img/radiosnet.png',
  // Adicione outros recursos que deseja cache aqui
];

// Arquivos que mudam com a configuração do site (o Docker gera os dois na
// subida do container): sempre buscar da rede antes de usar o cache, senão
// trocar a rádio não surte efeito para quem já visitou a página.
const networkFirst = ['./config.js', './manifest.json'];

// Instala o Service Worker e adiciona os arquivos ao cache
self.addEventListener('install', function(event) {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(function(cache) {
        console.log('Cache aberto');
        // Cada arquivo é adicionado individualmente: com cache.addAll um único
        // arquivo ausente faz a instalação inteira falhar e o app fica sem
        // service worker nenhum.
        return Promise.all(urlsToCache.map(function(url) {
          return cache.add(url).catch(function(error) {
            console.warn('Não foi possível cachear ' + url, error);
          });
        }));
      })
  );
  self.skipWaiting();
});

// Remove caches de versões anteriores
self.addEventListener('activate', function(event) {
  event.waitUntil(
    caches.keys().then(function(keys) {
      return Promise.all(
        keys.filter(function(key) { return key !== CACHE_NAME; })
            .map(function(key) { return caches.delete(key); })
      );
    }).then(function() {
      return self.clients.claim();
    })
  );
});

// Busca na rede e, dando certo, atualiza o cache.
function fetchAndCache(request) {
  return fetch(request).then(function(response) {
    if (response && response.ok && response.type === 'basic') {
      const copy = response.clone();
      caches.open(CACHE_NAME).then(function(cache) {
        cache.put(request, copy);
      });
    }
    return response;
  });
}

// Intercepta as solicitações e serve os arquivos em cache se disponíveis
self.addEventListener('fetch', function(event) {
  const request = event.request;

  // Só cuidamos dos arquivos do próprio app. O stream de áudio, a API de
  // metadados e as capas vêm de outros domínios e devem passar direto para o
  // browser — interceptar o stream pode atrapalhar a reprodução.
  if (request.method !== 'GET') return;
  if (new URL(request.url).origin !== self.location.origin) return;

  const path = new URL(request.url).pathname;
  const isNetworkFirst = request.mode === 'navigate' || networkFirst.some(function(file) {
    return path.endsWith(file.replace('./', '/'));
  });

  if (isNetworkFirst) {
    // Rede primeiro, cache como plano B quando estiver offline.
    event.respondWith(
      fetchAndCache(request).catch(function() {
        return caches.match(request).then(function(cached) {
          return cached || caches.match('./index.html');
        });
      })
    );
    return;
  }

  // Demais arquivos: cache primeiro (rápido), atualizando em segundo plano.
  event.respondWith(
    caches.match(request).then(function(response) {
      if (response) {
        // Cache hit - retorna a resposta do cache e revalida por trás
        event.waitUntil(fetchAndCache(request).catch(function() {}));
        return response;
      }
      // Não encontrado no cache - busca na rede
      return fetchAndCache(request);
    })
  );
});

// 离线缓存 —— **手机上打开就能用,不管有没有信号。**
//
// ⚠️ **不维护「要缓存哪些文件」的清单。**
//    这种清单是「写了没接上」的温床:加个新 js 忘了加进清单,
//    线上没事(网络能拉到),离线才白屏,而你多半在没信号的时候才发现。
//    这里改成**用到什么缓存什么**:第一次打开就会把所有脚本走一遍,
//    等于自动缓存完。
//
// ⚠️ 更新策略两条,分开的:
//      index.html  —— 先走网络。不然改了代码你永远看不到新版。
//      其它文件    —— 先给缓存里的(快、离线可用),同时后台悄悄更新,
//                     下次打开就是新的。
//    **不用版本号。** 靠人手动 bump 版本的方案,漏一次就是「永远停在旧版」,
//    而那种故障没有任何提示。
//
// ⚠️ **缓存名必须带项目前缀,清理时也只能清自己的。**
//    这个文件是从菜谱工具复制过来的,原样用的话两边都叫 `mealplanner` ——
//    而 CacheStorage 是**按 origin 共享的**,不看 scope。
//    两个 PWA 都装在 escapecat.github.io 上的话,
//    谁后激活谁就把对方的缓存全删了(原来的 activate 会删掉所有别的名字),
//    表现是「另一个 app 突然离线打不开了」,而你根本想不到是这边干的。

var PREFIX = 'balance-';
var CACHE = PREFIX + 'v1';

self.addEventListener('install', function (e) {
  self.skipWaiting();          // 新的装好就顶上,不用等所有标签页关掉
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys().then(function (names) {
      return Promise.all(names.map(function (n) {
        // 只清自己的旧版本 —— 别人的一个都不许碰
        return (n.indexOf(PREFIX) === 0 && n !== CACHE) ? caches.delete(n) : null;
      }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return;

  // 页面本身:先网络,断网了再吃缓存
  if (req.mode === 'navigate' || (req.headers.get('accept') || '').indexOf('text/html') >= 0) {
    e.respondWith(
      fetch(req).then(function (res) {
        var copy = res.clone();
        caches.open(CACHE).then(function (c) { c.put(req, copy); });
        return res;
      }).catch(function () {
        return caches.match(req).then(function (hit) {
          return hit || caches.match('index.html');
        });
      })
    );
    return;
  }

  // 其它:先缓存(离线也能用),后台顺手更新
  e.respondWith(
    caches.match(req).then(function (hit) {
      var fresh = fetch(req).then(function (res) {
        if (res && res.status === 200) {
          var copy = res.clone();
          caches.open(CACHE).then(function (c) { c.put(req, copy); });
        }
        return res;
      }).catch(function () { return hit; });
      return hit || fresh;
    })
  );
});

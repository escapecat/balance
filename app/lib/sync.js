// 同步 —— **代码公开,数据私有。**
//
// 数据推到另一个 **private** 仓库(默认 escapecat/balance-data),
// 一次保存 = 一个 commit,于是版本历史免费得到:哪天改坏了,
// 去 GitHub 上翻那天的 commit 就能取回来。
//
// ⚠️ **token 只存 localStorage,绝不进仓库。** tools/check.sh 有守卫。
//    用 fine-grained PAT,只授权 balance-data 一个仓库的 contents 读写 ——
//    手机丢了爆炸半径就这一个仓库,撤销即可。
//
// ⚠️ **本地优先。** 先写 localStorage(离线照常用),再后台推。
//    推不上去就显示「未同步」,**不静默丢**。
//    反过来做(先推成功再写本地)的话,没网就等于不能用。
//
// ⚠️ **PUT 必须带当前 sha。** 对不上 GitHub 返回 409 ——
//    那说明另一台设备改过。这时候**如实说「先拉再存」,不静默覆盖** ——
//    静默覆盖的表现是「手机上录的那期在电脑上打开就没了」,
//    而且没有任何提示,你只会以为自己记错了。
//
// ⚠️ 这一层是**唯一碰网络的地方**。小程序里没有 fetch,
//    将来迁移只换这个文件。

var Sync = (function () {

  var API = 'https://api.github.com';

  function cfg() { return Store.get('sync', {}) || {}; }
  function saveCfg(patch) {
    var c = cfg();
    Object.keys(patch || {}).forEach(function (k) { c[k] = patch[k]; });
    Store.set('sync', c);
    return c;
  }

  /** 配全了没 —— 界面靠这个决定显示「去设置」还是「同步状态」。 */
  function ready() {
    var c = cfg();
    return !!(c.token && c.owner && c.repo);
  }

  function path() { return cfg().path || 'data.json'; }

  // ---------------- base64(UTF-8 安全) ----------------
  //
  // ⚠️ `btoa` 只吃 latin1,直接喂中文会抛 InvalidCharacterError ——
  //    而这份数据里全是中文类别名。必须先编码成字节再转。
  //
  // ⚠️ 分块处理:`String.fromCharCode.apply(null, bytes)` 在数组大到
  //    几万时会栈溢出。数据现在几 KB,几年后就不是了 ——
  //    而那时候的表现是「同步突然不工作了」,没人会想到是这一行。

  function toB64(str) {
    var bytes = new TextEncoder().encode(str);
    var bin = '', CHUNK = 0x8000;
    for (var i = 0; i < bytes.length; i += CHUNK) {
      bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
    }
    return btoa(bin);
  }

  function fromB64(b64) {
    // ⚠️ GitHub 返回的 base64 **带换行**,不去掉 atob 会抛错。
    var bin = atob(String(b64).replace(/\s/g, ''));
    var bytes = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new TextDecoder().decode(bytes);
  }

  // ---------------- HTTP ----------------

  function req(method, url, body) {
    var c = cfg();
    return fetch(API + url, {
      method: method,
      headers: {
        // ⚠️ token 走 header,**不进 URL** —— URL 会落进各种日志和 Referer。
        Authorization: 'Bearer ' + c.token,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
      body: body ? JSON.stringify(body) : undefined,
    }).then(function (r) {
      return r.text().then(function (t) {
        var j = null;
        try { j = t ? JSON.parse(t) : null; } catch (e) {}
        return { status: r.status, ok: r.ok, body: j, raw: t };
      });
    }).catch(function (e) {
      // 断网 / DNS / 被墙 —— fetch 直接 reject,不是 HTTP 错误
      return { status: 0, ok: false, body: null, why: e && e.message };
    });
  }

  /** 人话版的失败原因。**不吐原始 JSON** —— 那些话没人看得懂,
   *  而看不懂的错误消息等于没有错误消息。 */
  function explain(r) {
    if (r.status === 0) return '连不上网络(或者被挡了)';
    if (r.status === 401) return 'token 不对或者已经过期了 —— 重新生成一个';
    if (r.status === 403) return 'token 没有这个仓库的写权限';
    if (r.status === 404) return '找不到这个仓库 —— 名字打错了,或者 token 没授权它';
    if (r.status === 409) return '另一台设备改过了';
    if (r.status === 422) return 'GitHub 说这个请求不合法:' +
                                ((r.body && r.body.message) || '');
    return 'HTTP ' + r.status + ((r.body && r.body.message) ? ' · ' + r.body.message : '');
  }

  // ---------------- 读 ----------------

  /** 拉云端那份。
   *  @return {ok, data, sha} | {ok:false, why, empty:true 表示云端还没有}
   */
  function pull() {
    if (!ready()) return Promise.resolve({ ok: false, why: '还没配同步' });
    var c = cfg();
    return req('GET', '/repos/' + c.owner + '/' + c.repo + '/contents/' +
                      encodeURIComponent(path())).then(function (r) {
      // 404 分两种:仓库不存在 · 仓库在但还没这个文件。后者是正常的首次状态。
      if (r.status === 404) {
        return { ok: false, empty: true, why: '云端还没有数据' };
      }
      if (!r.ok) return { ok: false, why: explain(r) };
      var text;
      try { text = fromB64(r.body.content); }
      catch (e) { return { ok: false, why: '云端那份解不开(编码坏了)' }; }
      var data;
      try { data = JSON.parse(text); }
      catch (e) { return { ok: false, why: '云端那份不是合法 JSON' }; }
      // ⚠️ **过一遍导入校验**,和手动导入同一道关。
      //    云端的东西不比本地的可信 —— 它可能是另一个版本的 app 写的。
      var chk = Store.inspectImport(data);
      if (!chk.ok) return { ok: false, why: '云端那份用不了:' + chk.why };
      return { ok: true, data: data, sha: r.body.sha, summary: chk.summary };
    });
  }

  // ---------------- 写 ----------------

  /** 把本地这份推上去。
   *
   *  @param opts.force  true = 不带 sha 硬覆盖。**只有在用户明确选了
   *                     「用本地的覆盖云端」之后才允许**。
   *  @return {ok, sha} | {ok:false, why, conflict:true}
   */
  function push(opts) {
    if (!ready()) return Promise.resolve({ ok: false, why: '还没配同步' });
    var c = cfg();
    var payload = Store.exportAll();
    var text = JSON.stringify(payload, null, 1);

    // ⚠️ **本机一期都没有,绝不自动推。**
    //    这条防的是一个会当场毁数据的场景:在新设备(手机)上填完 token,
    //    保存配置本身就是一次 Store.set → 打脏标记 → 4 秒后自动推 ——
    //    而这时本机还是空的,于是云端那几年的历史被 0 期覆盖,
    //    **在你还没来得及点「立刻同步」之前**。
    //    空数据盖掉非空的云端,没有任何一种情况下是用户想要的。
    //    真要清空(比如就是想重来),那是 force 路径,得你亲手选。
    var snaps = (payload.data && payload.data.snapshots) || [];
    if (!snaps.length && !(opts || {}).force) {
      return Promise.resolve({ ok: false, empty: true,
                               why: '本机还没有数据 —— 不能拿空的去盖云端' });
    }

    // 先拿最新的 sha —— 本地记的那个可能已经过期(另一台设备推过)。
    // ⚠️ 这一步**不能省**。省了的话每次都用本地缓存的 sha,
    //    而它一旦过期,写入永远 409,同步从此静静地失败。
    return req('GET', '/repos/' + c.owner + '/' + c.repo + '/contents/' +
                      encodeURIComponent(path())).then(function (g) {
      var remoteSha = g.ok && g.body ? g.body.sha : null;

      // 云端有东西,而且**不是我们上次推的那份** → 别人改过
      if (remoteSha && c.sha && remoteSha !== c.sha && !(opts || {}).force) {
        return { ok: false, conflict: true,
                 why: '另一台设备改过了 —— 先拉下来看看,别直接盖' };
      }

      var body = {
        message: '数据 ' + stamp() + (c.device ? ' · ' + c.device : ''),
        content: toB64(text),
      };
      if (remoteSha) body.sha = remoteSha;

      return req('PUT', '/repos/' + c.owner + '/' + c.repo + '/contents/' +
                        encodeURIComponent(path()), body).then(function (r) {
        if (r.status === 409) {
          return { ok: false, conflict: true, why: '另一台设备刚好也在存' };
        }
        if (!r.ok) return { ok: false, why: explain(r) };
        saveCfg({ sha: r.body.content.sha, lastPush: new Date().toISOString() });
        return { ok: true, sha: r.body.content.sha };
      });
    });
  }

  // ---------------- 历史 ----------------

  /** 最近几次同步 —— 一次保存一个 commit,所以这就是版本列表。
   *  ⚠️ 这是「改坏了怎么办」的答案,不是花架子:
   *     手动导出要你记得做,而这个是自动的。 */
  function history(n) {
    if (!ready()) return Promise.resolve({ ok: false, why: '还没配同步' });
    var c = cfg();
    return req('GET', '/repos/' + c.owner + '/' + c.repo + '/commits?path=' +
                      encodeURIComponent(path()) + '&per_page=' + (n || 20))
      .then(function (r) {
        if (!r.ok) return { ok: false, why: explain(r) };
        return { ok: true, list: (r.body || []).map(function (x) {
          return { sha: x.sha, date: (x.commit.committer || {}).date,
                   message: x.commit.message };
        }) };
      });
  }

  /** 取某个历史版本的内容(不落地,只返回)。 */
  function at(sha) {
    if (!ready()) return Promise.resolve({ ok: false, why: '还没配同步' });
    var c = cfg();
    return req('GET', '/repos/' + c.owner + '/' + c.repo + '/contents/' +
                      encodeURIComponent(path()) + '?ref=' + encodeURIComponent(sha))
      .then(function (r) {
        if (!r.ok) return { ok: false, why: explain(r) };
        var data;
        try { data = JSON.parse(fromB64(r.body.content)); }
        catch (e) { return { ok: false, why: '那一版解不开' }; }
        var chk = Store.inspectImport(data);
        if (!chk.ok) return { ok: false, why: '那一版用不了:' + chk.why };
        return { ok: true, data: data, summary: chk.summary };
      });
  }

  // ---------------- 连通性自检 ----------------

  /** 配置完让用户点一下 —— **当场知道通不通**,
   *  而不是等到某天发现三个月没同步过。 */
  function check() {
    if (!ready()) return Promise.resolve({ ok: false, why: '还没填全' });
    var c = cfg();
    return req('GET', '/repos/' + c.owner + '/' + c.repo).then(function (r) {
      if (!r.ok) return { ok: false, why: explain(r) };
      // ⚠️ **仓库必须是 private。** 公开仓库里放余额和持仓
      //    等于把资产明细贴在网上,而且 git 历史删不干净。
      if (!r.body.private) {
        return { ok: false, why: '这个仓库是公开的 —— 数据不能往里放' };
      }
      if (!(r.body.permissions || {}).push) {
        return { ok: false, why: 'token 只读,写不进去' };
      }
      return { ok: true, repo: r.body.full_name };
    });
  }

  function stamp() {
    var d = new Date();
    function p(n) { return ('0' + n).slice(-2); }
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) +
           ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
  }

  /** 界面上那一行状态。 */
  function status() {
    var c = cfg();
    if (!ready()) return { state: 'off', text: '没开同步' };
    if (c.dirty) return { state: 'dirty', text: '有改动还没推上去' };
    if (c.lastPush) {
      return { state: 'ok', text: '上次同步 ' + c.lastPush.slice(0, 16).replace('T', ' ') };
    }
    return { state: 'idle', text: '还没推过' };
  }

  /** 开机自动拉 —— **只在绝对安全的时候拉,其余一律不动。**
   *
   *  安全的定义:本机没有任何未推送的改动(dirty 为假)。
   *  那意味着本机的每一笔都已经在云端了,所以云端只可能比本机新或一样新,
   *  拉下来不会丢东西。
   *
   *  ⚠️ **dirty 时绝不拉。** 那时候两边都有对方没有的东西,
   *     谁覆盖谁是个需要你看着数字决定的问题 —— 自动选一个就是赌,
   *     而赌输的表现是「我明明录过那一期」。这种情况留给「立刻同步」去问。
   *
   *  ⚠️ sha 相同就什么都不做,连解析都省了 —— 每次开 app 都整份导入一遍的话,
   *     Store 会被写一遍,又触发 markDirty,又推一次,循环起来了。
   *
   *  @return {pulled:true} 拉了 | {same:true} 云端没变 | {skipped:true} 有本地改动
   */
  function autoPull() {
    if (!ready()) return Promise.resolve({ skipped: true, why: '没开同步' });
    if (cfg().dirty) return Promise.resolve({ skipped: true, why: '本机还有没推上去的改动' });
    return pull().then(function (r) {
      if (r.empty) return { same: true, why: '云端还没有数据' };
      if (!r.ok) return { skipped: true, why: r.why };
      if (r.sha && r.sha === cfg().sha) return { same: true };

      var mine = Store.inspectImport(Store.exportAll());
      // ⚠️ 云端比本机**旧**的时候也别拉 —— 那说明本机的推送记录丢了
      //    (换过浏览器、清过 sync 配置),这时拉就是把新的换成旧的。
      if (mine.ok && mine.summary.last && r.summary.last &&
          mine.summary.last > r.summary.last) {
        return { skipped: true, why: '本机比云端新 —— 去「立刻同步」推上去' };
      }
      Store.saveRollback('开机从云端拉取之前');
      var imp = silently(function () { return Store.importAll(r.data); });
      if (!imp.ok) return { skipped: true, why: imp.why };
      saveCfg({ sha: r.sha, dirty: false });
      return { pulled: true, summary: r.summary };
    });
  }

  /** 数据变了 —— 打个记号,并**安排一次自动推送**(防抖 4 秒)。
   *
   *  ⚠️ 不立刻推:一次录入会连着写好几个 key(snapshots / todos / flows),
   *     每个都推一次就是七八个 commit,而且它们互相竞争 sha,
   *     后面几个必然 409 —— 表现是「同步老是失败」。
   *
   *  ⚠️ 自动推**失败不弹窗**。它发生在你正在操作的时候,
   *     弹窗会打断手上的事;而且断网是常态不是故障。
   *     失败只留着 dirty 标记,设置页和主界面会显示「有改动还没推上去」。
   *
   *  ⚠️ 自动推**永不 force**。冲突时宁可不推,也不能在你没看见的时候
   *     盖掉另一台设备的数据 —— 那种丢失查都没法查。
   */
  var timer = null;
  var quiet = false;      // 正在往本地灌云端数据 —— 这期间的写入不算「你改的」

  /** 期间的所有写入都不打脏标记。
   *
   *  ⚠️ 没有这一层的话会自噬:从云端拉一份 → Store.importAll 内部
   *     写六七个 key → 每个都 markDirty → 4 秒后把刚拉下来的原样推回去。
   *     一次开机就多一个毫无内容的 commit,而且每台设备开机都来一遍。
   */
  function silently(fn) {
    quiet = true;
    try { return fn(); } finally { quiet = false; }
  }

  function markDirty() {
    if (quiet) return;
    saveCfg({ dirty: true });
    if (!ready() || typeof setTimeout === 'undefined') return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(function () {
      timer = null;
      push({}).then(function (r) {
        if (r.ok) clearDirty();
        // 失败就留着 dirty —— 下次写入还会再试
      });
    }, 4000);
  }
  function clearDirty() { saveCfg({ dirty: false }); }

  /** 页面要关了 —— 还欠着就最后推一次。
   *  ⚠️ 防抖那 4 秒里关掉标签页的话,那一笔就只在本地了。 */
  function flush() {
    if (timer) { clearTimeout(timer); timer = null; }
    if (!ready() || !cfg().dirty) return Promise.resolve({ ok: true, skipped: true });
    return push({}).then(function (r) {
      if (r.ok) clearDirty();
      return r;
    });
  }

  return { cfg: cfg, saveCfg: saveCfg, ready: ready, check: check,
           pull: pull, push: push, history: history, at: at,
           status: status, markDirty: markDirty, clearDirty: clearDirty, flush: flush,
           autoPull: autoPull, silently: silently,
           toB64: toB64, fromB64: fromB64 };
})();

if (typeof module !== 'undefined') module.exports = Sync;

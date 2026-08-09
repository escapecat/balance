#!/bin/sh
# 提交前跑这个。**只用 tools/commit.sh 提交,不要手打 git commit。**
#
# ⚠️ 检查必须是独立的一步,而且失败要能真的挡住提交。
#    用管道(`check.sh | tail`)的话退出码是 tail 的,永远 0 —— 检查报了 FAIL
#    提交照样过去。这个坑在另一个项目里踩过两次,换了个壳而已。

cd "$(dirname "$0")/.." || exit 1
fail=0

# ---- 语法 ----
for f in app/*.js app/lib/*.js app/core/*.js app/ui/*.js app/data/*.js; do
  [ -e "$f" ] || continue
  if ! node --check "$f" 2>/dev/null; then
    echo "✗ 语法错误: $f"
    node --check "$f" 2>&1 | head -4
    fail=1
  fi
done

# ---- index.html 引用的文件都得真实存在 ----
# 少一个页面就白屏,而白屏在控制台之外没有任何提示。
if [ -e app/index.html ]; then
  for src in $(grep -o 'src="[^"]*\.js"' app/index.html | sed 's/src="//;s/"//'); do
    [ -e "app/$src" ] || { echo "✗ index.html 引用了不存在的 $src"; fail=1; }
  done
  for href in $(grep -o 'href="[^"]*\.\(png\|webmanifest\|css\)"' app/index.html \
                | sed 's/href="//;s/"//'); do
    [ -e "app/$href" ] || { echo "✗ index.html 引用了不存在的 $href"; fail=1; }
  done
fi

# ---- 回归测试 ----
# 只收「看代码看不出来、跑一遍才暴露」的那类:
#   blank    —— 留空当成 0,一次提交就能把整个组合抹平,而每个数字看着都合理
#   allocate —— 无限额的被按比例摊薄:今天能进场的钱躺着等瓶颈,
#               账面上却显示「已经合理分配了」。只有拿真数据跑才露馅
for t in tools/jstest/*.js; do
  [ -e "$t" ] || continue
  case "$t" in *_*) continue;; esac      # 下划线开头的是临时脚本
  if ! node "$t" >/dev/null 2>&1; then
    echo "✗ 回归测试没过: $t"
    node "$t" 2>&1 | grep -i "FAIL\|Error" | head -5
    fail=1
  fi
done

# ---- 守卫 ----
#
# ⚠️ 这四条都是把「静默出错」变成「提交不过去」。
#    金额类的错不会报错,只会变成一个看着合理的数字。

# 1. 钱和 token 不进仓库 —— 仓库是公开的,这条是底线
if git ls-files 2>/dev/null | grep -qE '\.db$|backup.*\.json$|token'; then
  echo "✗ 仓库里出现了不该进的东西(数据库/备份/token):"
  git ls-files | grep -E '\.db$|backup.*\.json$|token'
  fail=1
fi

# 2. 空 ≠ 0 —— 这种写法把空串/null/undefined/NaN 全变成 0,一行四种错
if grep -n '|| 0' app/core/ledger.js app/ui/entry.js 2>/dev/null | grep -v '^\S*: *[/*]' | grep -q .; then
  echo '✗ 出现了 "|| 0" —— 那是把「留空」变成 0 的唯一入口(见 jstest/blank.js):'
  grep -n '|| 0' app/core/ledger.js app/ui/entry.js 2>/dev/null | grep -v '^\S*: *[/*]'
  fail=1
fi

# 3. core/ 不许碰 DOM —— 那一层要能在 node 里直接跑,也要能换壳
if grep -n "document\.\|window\.\|localStorage" app/core/*.js 2>/dev/null \
   | grep -v '^\S*: *[/*]' | grep -q .; then
  echo "✗ core/ 里碰了 DOM/浏览器 API:"
  grep -n "document\.\|window\.\|localStorage" app/core/*.js | grep -v '^\S*: *[/*]'
  fail=1
fi

# 4. ui/ 不许写存储 —— 写存储就是业务,业务归 core/
if grep -n "Store\.set(" app/ui/*.js 2>/dev/null | grep -v '^\S*: *[/*]' | grep -q .; then
  echo "✗ ui/ 里直接写存储了 —— 业务归 core/:"
  grep -n "Store\.set(" app/ui/*.js | grep -v '^\S*: *[/*]'
  fail=1
fi

# 5. ★ 真实金额不许进仓库 —— **这个仓库是公开的。**
#
# 代码公开,钱不公开。而泄露的方式从来不是「不小心提交了数据库」——
# 那种一眼看得见,.gitignore 也拦得住。真正漏出去的是
# **注释和测试夹具里的例子**:「总额从 A 涨到 B」「这一期该买 C」——
# 看着像文档,实际是一份净资产画像,而且 push 出去之后
# 连 git 历史一起留在那儿,删也删不干净。
#
# 判据:连着两个以上千分位分隔的数字。
# 编夹具请写整数(1000000 / 60000)—— 不带逗号,量级明显是编的。
# 真需要真数的测试从 %TEMP%/pf/expected.json 读(见 tools/mkbaseline.js)。
if git ls-files | xargs grep -nE '[0-9]{1,3}(,[0-9]{3}){2,}' 2>/dev/null | grep -q .; then
  echo "✗ 出现了带千分位的大额数字 —— 仓库是公开的,那可能是真实金额:"
  git ls-files | xargs grep -nE '[0-9]{1,3}(,[0-9]{3}){2,}' 2>/dev/null
  echo "   夹具请用 1000000 这种写法;真实基线放 %TEMP%/pf/expected.json"
  fail=1
fi

if [ $fail -eq 0 ]; then
  echo "✓ 语法 · 引用 · 回归测试 · 守卫 全部通过"
else
  echo "✗ 有问题,别提交"
fi
exit $fail

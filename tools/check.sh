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
#
# ⚠️ 得**先剥掉 `?v=` 版本号**再查。资源带版本号是为了破缓存
#    (见 commit.sh),但版本号一加,原来那个按 `\.js"` 结尾的匹配
#    就一个都匹配不到了 —— 守卫不会报错,它只是从此什么都不检查。
#    这类「守卫静默失效」比守卫报错危险得多:每次提交照样打勾。
if [ -e app/index.html ]; then
  for src in $(grep -o 'src="[^"]*\.js\(?v=[0-9]*\)\?"' app/index.html \
               | sed 's/src="//;s/"//;s/?v=[0-9]*$//'); do
    [ -e "app/$src" ] || { echo "✗ index.html 引用了不存在的 $src"; fail=1; }
  done
  for href in $(grep -o 'href="[^"]*\.\(png\|webmanifest\|css\)\(?v=[0-9]*\)\?"' app/index.html \
                | sed 's/href="//;s/"//;s/?v=[0-9]*$//'); do
    [ -e "app/$href" ] || { echo "✗ index.html 引用了不存在的 $href"; fail=1; }
  done
  # 引用一个都没查到 = 上面的正则被 index.html 的写法绕过去了,当失败处理
  n=$(grep -c 'src="[^"]*\.js\(?v=[0-9]*\)\?"' app/index.html)
  [ "$n" -ge 5 ] || { echo "✗ 只匹配到 $n 个脚本引用 —— 正则和 index.html 对不上了"; fail=1; }
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
# **注释和测试夹具里的例子**:「这一期该买 4x,xxx」「总额涨了 7x,xxx」——
# 看着像文档,实际是从真实持仓算出来的,几条凑一起就能反推出整个配置。
# 而且 push 出去之后连 git 历史一起留在那儿,删也删不干净。
#
# ⚠️ 判据是**任何千分位写法**,不是「看起来够大的数」。   # check:money-ok
#    第一版只抓连着两个逗号的,于是五位数的那些全漏了 ——
#    它们单看不像净资产,凑一起就是一份配置画像。
#    界线画在「有没有逗号」上,因为那是唯一不需要判断的判据。
#
# 写夹具:用不带逗号的整数(1000000 / 60000),量级明显是编的。
# 写注释:用中文量词(「涨了 6 万」)。
# 真需要真数的测试从 %TEMP%/pf/expected.json 读(见 tools/mkbaseline.js)。
# 确实要写千分位字面量(比如测千分位解析),在那一行加 `check:money-ok`。
# ⚠️ CSS 的 rgba()/hsl() 要豁免:`rgba(255,255,255,.6)` 里的 `5,255`
#    完全符合「数字-逗号-三位数字」,但它是颜色不是钱。
#    不豁免的话每加一处半透明就得手动标一次 check:money-ok,
#    标记一多就没人看了 —— 守卫的可信度是被误报磨掉的。
if git ls-files | xargs grep -nE '[0-9],[0-9]{3}' 2>/dev/null \
   | grep -vE 'check:money-ok|rgba?\(|hsla?\(' | grep -q .; then
  echo "✗ 出现了带千分位的数字 —— 仓库是公开的,那可能是真实金额:"
  git ls-files | xargs grep -nE '[0-9],[0-9]{3}' 2>/dev/null \
    | grep -vE 'check:money-ok|rgba?\(|hsla?\('
  echo "   夹具写 1000000,注释写「6 万」;真要写千分位就在那行加 check:money-ok"
  fail=1
fi

# ---- 守卫 5b:token 的**内容**不进仓库 ----
#
# 上面那条只查文件名带不带 token —— 而真正会漏出去的是**粘进代码里的那一串**:
# 调同步接口时手快写死一个测试用的 token、注释里留一个示例值。
# 文件名完全正常,git ls-files 那条一个字都查不到。
#
# GitHub 的 fine-grained PAT 以 github_pat_ 开头,classic 的是 ghp_ / gho_ / ghs_。
# 真要写示例就写 github_pat_xxx(x 不算数字字母混排,下面的正则要求 20 位以上)。
if git ls-files 2>/dev/null | xargs grep -nE '(github_pat_|gh[pousr]_)[A-Za-z0-9_]{20,}' 2>/dev/null    | grep -q .; then
  echo "✗ 仓库里出现了真的 GitHub token —— 立刻去 GitHub 撤销它:"
  git ls-files | xargs grep -nE '(github_pat_|gh[pousr]_)[A-Za-z0-9_]{20,}' 2>/dev/null
  echo "   token 只存 localStorage。撤销地址:https://github.com/settings/tokens"
  fail=1
fi

# ---- 守卫 6:颜色只能来自令牌 ----
#
# style.css 开头就写着「组件里出现字面 #rrggbb 就是 bug」,
# 但那句话**只是注释,没有守卫** —— 于是 ui/stats.js 里长出了一个
# 写死八个 hex 的 HUES 数组,而且按索引取色:同一个类别
# 在饼图和柱图里是两个颜色,深色模式下那套低饱和色又几乎看不见。
# 规范没有守卫撑着的话,它迟早只是一段自我感觉良好的注释。
#
# 颜色的唯一出处:style.css 的 :root(长什么样)+ data/palette.js(谁用哪个)。
if git ls-files 'app/ui/*.js' 'app/core/*.js' \
   | xargs grep -nE '#[0-9a-fA-F]{3,6}\b' 2>/dev/null \
   | grep -v 'check:color-ok' | grep -q .; then
  echo "✗ 组件里出现了字面颜色 —— 深色模式跟不上,而且会和别处不一致:"
  git ls-files 'app/ui/*.js' 'app/core/*.js' \
    | xargs grep -nE '#[0-9a-fA-F]{3,6}\b' 2>/dev/null | grep -v 'check:color-ok'
  echo "   类别色用 Palette.color(类别);其它色在 style.css 的 :root 里加一个 --x"
  fail=1
fi

if [ $fail -eq 0 ]; then
  echo "✓ 语法 · 引用 · 回归测试 · 守卫 全部通过"
else
  echo "✗ 有问题,别提交"
fi
exit $fail

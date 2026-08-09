#!/bin/sh
# 提交入口。**只用这个提交,不要手打 git commit。**
#
# 2026-08-06 又踩了一次 check.sh 头上写着的那个坑:
#     bash tools/check.sh 2>&1 | tail -5 && git add -A && git commit ...
# 管道的退出码是 tail 的(永远 0),检查明明报了 FAIL,提交照样过去了。
# 和当初那次 `node --check` 被 && 链吞掉是同一个错误 —— 换了个壳而已。
#
# 教训升级:光把检查写成独立一步不够,**得让它没法被绕过**。
# 这里不加管道、不加 tail、不加 &&,失败直接 exit。
#
# ⚠️ 提交信息要落成临时文件,不能直接给 git 一个 /dev/stdin ——
#    Git Bash 下 git 会去读 /proc/self/fd/0,报 "could not read log file"。
#    第一版就是这么挂的,而且挂在「检查通过之后」,看起来像检查脚本坏了。

cd "$(dirname "$0")/.." || exit 1

sh tools/check.sh
if [ $? -ne 0 ]; then
  echo
  echo "✗ 检查没过,不提交。"
  exit 1
fi

MSGFILE=$(mktemp) || exit 1
if [ -n "$1" ]; then cat "$1" > "$MSGFILE"; else cat > "$MSGFILE"; fi

# 盖构建时间戳。⚠️ **自动盖,不靠人记得改。**
#    手动维护的版本号漏更一次就再也没人信它了,而它存在的全部意义
#    就是回答「手机上跑的到底是不是我刚推的那版」——
#    这个问题在「改了怎么没变化」的时候是唯一能问的问题。
STAMP=$(date +'%m-%d %H:%M')
sed -i "s|<meta name=\"build\" content=\"[^\"]*\">|<meta name=\"build\" content=\"$STAMP\">|" \
    app/index.html

git add -A || { rm -f "$MSGFILE"; exit 1; }
git commit -F "$MSGFILE"
rc=$?
rm -f "$MSGFILE"
exit $rc

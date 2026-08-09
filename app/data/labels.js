// 显示名 —— **存储里的 key 是给代码看的,不是给你看的。**
//
// ⚠️ 现金科目的 key(`instant_buffer`)是从旧库继承下来的,改不得:
//    改了历史快照就对不上。所以在**显示的时候**翻一次,存储层一个字不动。
//
// ⚠️ 查不到就原样返回,**不编、不留空**。将来自己加一个现金科目,
//    界面上会直接显示那个 key —— 难看,但看得见,比显示成空白强。

var Labels = (function () {

  var CASH = {
    cash: '现金账户',
    instant_buffer: '日日宝',
    moneymarket: '月月宝',
  };

  var KIND = {
    stock: '股票',
    property: '房产',
    other: '其它',
  };

  function cash(k) { return CASH[k] || k; }
  function kind(k) { return KIND[k] || k; }

  return { CASH: CASH, KIND: KIND, cash: cash, kind: kind };
})();

if (typeof module !== 'undefined') module.exports = Labels;

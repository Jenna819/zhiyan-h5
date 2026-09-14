// 核心逻辑模拟测试：jsc test_core.js 运行
// polyfill ----------
function _b64(str) {
  const K = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  let out = "";
  for (let i = 0; i < str.length; i += 3) {
    const c1 = str.charCodeAt(i), c2 = str.charCodeAt(i + 1), c3 = str.charCodeAt(i + 2);
    const has2 = i + 1 < str.length, has3 = i + 2 < str.length;
    const bits = (c1 << 16) | ((has2 ? c2 : 0) << 8) | (has3 ? c3 : 0);
    out += K[(bits >> 18) & 63] + K[(bits >> 12) & 63];
    out += has2 ? K[(bits >> 6) & 63] : "=";
    out += has3 ? K[bits & 63] : "=";
  }
  return out;
}
function _b64d(str) {
  const K = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  let out = "";
  const clean = str.replace(/=+$/, "");
  for (let i = 0; i < clean.length; i += 4) {
    const e1 = K.indexOf(clean[i]);
    const e2 = K.indexOf(clean[i + 1]);
    const e3 = i + 2 < clean.length ? K.indexOf(clean[i + 2]) : -1;
    const e4 = i + 3 < clean.length ? K.indexOf(clean[i + 3]) : -1;
    out += String.fromCharCode((e1 << 2) | (e2 >> 4));
    if (e3 >= 0) out += String.fromCharCode(((e2 & 15) << 4) | (e3 >> 2));
    if (e4 >= 0) out += String.fromCharCode(((e3 & 3) << 6) | e4);
  }
  return out;
}
globalThis.btoa = _b64; globalThis.atob = _b64d;
globalThis.window = globalThis;

// 加载内容与核心 ----------
load("data/words_cb.js"); load("data/words_th.js"); load("data/words_lc.js");
load("data/words_mt.js"); load("data/words_ac.js"); load("data/words_sc.js");
load("data/words_tc.js"); load("data/words_sd.js"); load("data/words_mc.js");
load("data/sentences.js"); load("data/themes.js"); load("core.js");

const E = Engine;
const content = { words: W, sents: S, themes: T, wordsByTheme: T_WORDS };
let pass = 0, fail = 0;
function assert(cond, msg) {
  if (cond) { pass++; } else { fail++; print("❌ " + msg); }
}

// ---- 数据完整性 ----
print(`词库 ${content.words.length} 词 / 句库 ${content.sents.length} 句`);
const ids = new Set();
content.words.forEach(w => {
  assert(!ids.has(w.id), "重复词id " + w.id); ids.add(w.id);
  assert(w.w && w.cn && w.id && w.ex, "词字段缺失 " + w.id);
  assert(Array.isArray(w.t) && w.t.length, "缺场景标签 " + w.id);
  w.t.forEach(t => assert(["mk","ds","dv","ex","pr"].includes(t), "非法标签 " + w.id + " " + t));
});
const sidSet = new Set();
content.sents.forEach(s => {
  assert(!sidSet.has(s.id), "重复句id " + s.id); sidSet.add(s.id);
  assert(s.en && s.cn && s.sc, "句字段缺失 " + s.id);
  assert(["mk","ds","dv","ex","pr"].includes(s.sc), "句场景非法 " + s.id);
  const low = s.en.toLowerCase();
  (s.notes || []).forEach(([t]) => assert(low.includes(t.toLowerCase()), "note词不在句中: " + s.id + " " + t));
});
// 句库场景覆盖
const scCount = {};
content.sents.forEach(s => scCount[s.sc] = (scCount[s.sc] || 0) + 1);
print("句子场景分布:", JSON.stringify(scCount));

// ---- 干扰项 ----
let rnd = E.mulberry32(42);
content.words.forEach(w => {
  const o1 = E.makeOptions(w, content, rnd), o2 = E.makeOptionsMeaning(w, content, rnd);
  assert(o1.length === 4 && o2.length === 4, "选项数 " + w.id);
  assert(o1.some(o => o.id === w.id) && o2.some(o => o.id === w.id), "正确项缺失 " + w.id);
  const set = new Set(o1.map(o => o.label));
  assert(set.size === 4, "选项label重复 " + w.id);
});

// ---- 跨天确定性 ----
const st1 = { uid: "u1", profile: { goalW: 10, goalS: 3 }, userWords: {}, uSents: {}, forceTomorrow: [], queue: { words: content.words.map(w => w.id), sents: content.sents.map(s => s.id) } };
const st2 = JSON.parse(JSON.stringify(st1));
const t1 = E.buildTask(st1, content, "2026-09-14");
const t2 = E.buildTask(st2, content, "2026-09-14");
assert(JSON.stringify(t1) === JSON.stringify(t2), "同种子任务生成不确定");

// ---- 模拟学习 5 天 ----
function freshState() {
  return { uid: "u1", profile: { goalW: 10, goalS: 3 }, userWords: {}, uSents: {}, forceTomorrow: [],
           queue: { words: E.shuffle(content.words.map(w => w.id), E.mulberry32(7)),
                    sents: E.shuffle(content.sents.map(s => s.id), E.mulberry32(8)) }, days: {}, streak: { count: 0, lastDone: null } };
}
const st = freshState();
let lastNewIds = null;
for (let day = 0; day < 5; day++) {
  const date = E.addDays("2026-09-14", day);
  const task = E.buildTask(st, content, date);
  const ans = [];
  let idx = 0;
  task.wordItems.forEach(it => {
    // 策略：Day0 全对；之后每第 3 题答错制造错题
    const ok = day === 0 ? true : (idx % 3 !== 0);
    const rec = E.applyAnswer(st.userWords, it.wid, it.q, ok, date);
    ans.push({ k: "w", wid: it.wid, q: it.q, ok, de: rec.de });
    idx++;
  });
  task.sentItems.forEach((it, i2) => {
    const rating = i2 % 3 === 2 ? "poor" : "good";
    E.applySent(st.uSents, it.sid, rating, date);
    ans.push({ k: "s", sid: it.sid, rating });
  });
  const rep = E.buildReport(task.wordItems.concat(task.sentItems), ans, st.userWords, st.uSents, content, date);
  st.forceTomorrow = E.forceTomorrowIds(st.userWords, date);
  if (day === 0) {
    assert(rep.acc === 100, "Day0 应全对");
    assert(task.newIds.length === 10, "Day0 新词应为10，实际 " + task.newIds.length);
    assert(task.reviewIds.length === 0, "Day0 无复习");
    assert(rep.sentPoor === 1, "Day0 自评poor应为1");
    lastNewIds = task.newIds.slice();
    // 全对：两题同词 ok>=2 → 升级 lv1，nr = date+2
    const rec = st.userWords[task.newIds[0]];
    assert(rec.lv === 1 && rec.nr === E.addDays(date, 2), "Day0 首词应升 Lv1 nr+2，实际 " + JSON.stringify(rec));
  }
  if (day === 2) {
    // Day0 全对的词 nr=+2 → Day2 应到期
    assert(task.reviewIds.some(id => lastNewIds.includes(id)), "Day2 应包含 Day0 的到期复习词");
  }
  print(`Day${day} ${date}: 新${task.newIds.length} 复习${task.reviewIds.length} 句${task.sentItems.length} · 正确率${rep.acc}% · 薄弱top:${rep.topTags.map(t => t.name).join(",") || "-"} · force${st.forceTomorrow.length}`);
}
const learned = Object.keys(st.userWords).length;
assert(learned === 50, "5天×10新词 应学50个，实际 " + learned);

// ---- 权重与衰减 ----
const w1 = { lv: 2, ok: 0, w: 4, lastErr: "2026-08-01", nr: "", de: 0, ded: "", lastQ: "" };
assert(Math.abs(E.effWeight(w1, "2026-09-14") - 2) < 1e-9, "30天无错应衰减一半");

// ---- 掌握度降级 ----
const st3 = freshState();
E.applyAnswer(st3.userWords, "CB01", "w2c", true, "2026-09-14");
E.applyAnswer(st3.userWords, "CB01", "c2w", true, "2026-09-14");
assert(st3.userWords.CB01.lv === 1, "对2次应升Lv1");
E.applyAnswer(st3.userWords, "CB01", "w2c", false, "2026-09-15");
assert(st3.userWords.CB01.lv === 0 && st3.userWords.CB01.nr === "2026-09-15", "答错降两级并当日重排");
assert(st3.userWords.CB01.w > 0, "答错权重增加");
E.applyAnswer(st3.userWords, "CB01", "c2w", false, "2026-09-15");
assert(Math.abs(st3.userWords.CB01.w - (1.0 + 1.5 * 1.5)) < 1e-9, "同日连错加权: 实际 " + st3.userWords.CB01.w);

// ---- 备份码往返 ----
const code = E.encodeBackup(st);
const back = E.decodeBackup(code);
assert(back.uid === st.uid && Object.keys(back.userWords).length === 50, "备份码往返");
try { E.decodeBackup("bad code"); assert(false, "坏码应抛错"); } catch (e) { assert(e.message.includes("前缀"), "坏码前缀报错"); }

// ---- 日期工具 ----
assert(E.addDays("2026-08-30", 5) === "2026-09-04", "跨月加天");
assert(E.diffDays("2026-09-01", "2026-09-14") === 13, "日期差");
assert(E.diffDays("2026-02-27", "2026-03-02") === 3, "跨月3天");

// ---- 新词耗尽边界 ----
const st4 = freshState();
st4.queue.words = [];
for (const w of content.words.slice(0, 20)) st4.userWords[w.id] = { lv: 3, ok: 0, w: 0, lastErr: "", nr: "2099-01-01", de: 0, ded: "", lastQ: "" };
const task4 = E.buildTask(st4, content, "2026-09-14");
assert(task4.newIds.length === 0 && task4.reviewIds.length === 0 && task4.sentItems.length === 3, "词库耗尽: 无新无复习，仍有句子");

// ---- 主题课包层 ----
print(`\n主题 ${content.themes.length} 个 / 映射词数 ${Object.values(content.wordsByTheme).reduce((a, v) => a + v.length, 0)}`);
{
  const seen = new Set(); let dup = 0;
  const wmap = {}; content.words.forEach(w => wmap[w.id] = w);
  content.themes.forEach(t => {
    const pack = content.wordsByTheme[t.id];
    assert(pack && pack.length > 0, "主题无词 " + t.id);
    assert(pack.length >= 14 && pack.length <= 16, "包大小越界 " + t.id + "=" + pack.length);
    pack.forEach(wid => { if (seen.has(wid)) dup++; seen.add(wid); assert(!!wmap[wid], "主题引用不存在词 " + wid); });
    const low = t.art.map(p => p[0]).join(" ").toLowerCase().replace(/[^a-z0-9.%-]+/g, " ");
    pack.forEach(wid => {
      const w = wmap[wid].w.toLowerCase();
      const ok = w.includes(" ") ? low.includes(w) : low.split(" ").some(tk => tk.startsWith(w)) || low.includes(w);
      assert(ok, "主题词未出现在文章 " + t.id + " " + wid);
    });
    t.art.forEach(p => assert(p[0] && p[1] && !/[一-鿿]/.test(p[0]), "文章句缺字段或中英混排 " + t.id));
  });
  assert(dup === 0, "词被多个主题重复归属 dup=" + dup);
  assert(seen.size === content.words.length, "主题未覆盖全部词 " + seen.size + "/" + content.words.length);
}
// 多日推进模拟：goalW=10 时第 2 天为文章日；goalW=15 的专题可能一天吃完
// 一日一篇推进模拟：每天吃完整包并朗读，12 天 = 12 个专题
{
  const st5 = freshState(); st5.theme = { i: 0, consumed: 0 };
  const tids = content.themes.map(t => t.id);
  let artDays = 0, day = 0;
  for (; day < 12; day++) {
    const d = E.addDays("2026-09-14", day);
    const plan = E.themePlan(st5, content, d);
    assert(plan.theme !== null, "第" + day + "天应有任务");
    assert(plan.articleDue === true, "每天都是文章日");
    const pack = content.wordsByTheme[tids[st5.theme.i]];
    assert(plan.newIds.length === pack.length, "每日新词=整包 day" + day);
    assert(plan.newIds.every(w => pack.includes(w)), "新词来自当前主题包 day" + day);
    artDays++;
    plan.newIds.forEach(w => { st5.userWords[w] = E.applyAnswer(st5.userWords, w, "w2c", true, d); });
    E.themeCommit(st5, content, plan.newIds);
    E.themeAdvance(st5, content);
  }
  assert(artDays === 12, "12 天 12 篇文章");
  assert(st5.theme.i === 12, "12 天应吃完 12 个专题，实际 i=" + st5.theme.i);
  const learned12 = tids.slice(0, 12).reduce((a, id) => a + content.wordsByTheme[id].length, 0);
  assert(Object.keys(st5.userWords).length === learned12, "12 天所学 = 前 12 包全部，实际 " + Object.keys(st5.userWords).length + "/" + learned12);
}
// 复习上限：forcedNew 模式下最多 8
{
  const st6 = freshState(); st6.theme = { i: 0, consumed: 0 };
  const plan = E.themePlan(st6, content, "2026-09-14");
  const packLen = content.wordsByTheme[plan.theme.id].length;
  assert(packLen >= 14 && packLen <= 16, "包 14~16 词");
  assert(plan.newIds.length === packLen && plan.articleDue === true, "整包+文章日");
  // 旧版半包进度迁移：consumed 中间值重置，已学词不再重复出现
  const st9 = freshState(); st9.theme = { i: 0, consumed: 5 };
  const p9 = content.wordsByTheme[content.themes[0].id];
  p9.slice(0, 3).forEach(w => { st9.userWords[w] = { lv: 1, ok: 0, w: 0, lastErr: "", nr: "2026-09-20", de: 0, ded: "", lastQ: "" }; });
  const plan9 = E.themePlan(st9, content, "2026-09-14");
  assert(st9.theme.consumed === 0 && plan9.newIds.length === p9.length - 3, "半包 consumed 迁移+已学过滤");
}
// themeQueue 顺序 = 主题序
{
  const st7 = freshState();
  const q = E.themeQueue(st7, content);
  assert(q.length === content.words.length, "队列含全部词");
  const first = content.wordsByTheme[content.themes[0].id];
  assert(q.slice(0, first.length).sort().join() === first.slice().sort().join(), "队首=第一包");
}
// 备份码含 theme
{
  const st8 = freshState(); st8.theme = { i: 3, consumed: 7 };
  const rt = E.decodeBackup(E.encodeBackup(st8));
  assert(rt.theme && rt.theme.i === 3 && rt.theme.consumed === 7, "备份码含主题进度");
}

print(`\n===== ${pass} 通过 / ${fail} 失败 =====`);
if (fail) throw new Error("tests failed");

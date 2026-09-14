// 核心算法层：纯函数，无 DOM/存储依赖。未来小程序直接复用。
(function (root) {
  "use strict";

  // ---------- 工具 ----------
  function hashStr(s) {
    let h = 1779033703 ^ s.length;
    for (let i = 0; i < s.length; i++) {
      h = Math.imul(h ^ s.charCodeAt(i), 3432918353);
      h = (h << 13) | (h >>> 19);
    }
    return h >>> 0;
  }
  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a |= 0; a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function shuffle(arr, rnd) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(rnd() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }
  function todayKey(d) {
    d = d || new Date();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${d.getFullYear()}-${m}-${day}`;
  }
  function addDays(key, n) {
    const [y, m, d] = key.split("-").map(Number);
    const dt = new Date(y, m - 1, d);
    dt.setDate(dt.getDate() + n);
    return todayKey(dt);
  }
  function diffDays(a, b) { // b - a in days
    const p = s => { const [y, m, d] = s.split("-").map(Number); return Date.UTC(y, m - 1, d); };
    return Math.round((p(b) - p(a)) / 86400000);
  }

  // ---------- 常量 ----------
  const CATS = { CB:"电芯与电池基础", TH:"发热与热行为", LC:"液冷与制冷系统", MT:"界面材料与热防护", AC:"风冷与结构件", SC:"传感与控制", TC:"测试与认证", SD:"仿真与开发流程", MC:"海外会议与技术表达" };
  const SCEN = { mk:"市场调研", ds:"方案设计", dv:"开发跟进", ex:"对外合作", pr:"海外方案讲解" };
  const LEVEL_INTERVAL = { 0: 0, 1: 2, 2: 4, 3: 7 }; // 天；答对升级到 Lv 后按 Lv 间隔排下次复习；L3 后续为 15 特判
  const QCOEF = { w2c: 1.0, c2w: 1.5 }; // 看词选义 / 看义选词
  const SENT_POOR_W = 1.2;

  function catOf(wordId) { return wordId.slice(0, 2); }

  // ---------- 每日任务生成 ----------
  // state: { profile:{goalW,goalS}, userWords:{}, uSents:{}, queue:{words:[],sents:[]}, forceTomorrow:[], dayMarks:{} }
  function buildTask(state, content, dateStr, forcedNew) {
    const { words, sents } = content;
    const rnd = mulberry32(hashStr(state.uid + ":" + dateStr));
    const uw = state.userWords;
    const due = [], newPick = [];

    // 1) 到期复习（含昨日强制强化词）
    const forced = new Set(state.forceTomorrow || []);
    for (const wid of Object.keys(uw)) {
      const rec = uw[wid];
      if (rec.lv === 0) continue;
      if (rec.nr <= dateStr || forced.has(wid)) due.push({ wid, forced: forced.has(wid) });
    }
    due.sort((a, b) => {
      const wa = effWeight(uw[b.wid], dateStr), wb = effWeight(uw[a.wid], dateStr);
      return (b.forced - a.forced) || (wa - wb) || (a.wid < b.wid ? -1 : 1);
    });
    const reviewN = forcedNew ? 8 : Math.max(3, state.profile.goalW);
    const reviewPicks = due.slice(0, reviewN).map(x => x.wid);
    const reviewSet = new Set(reviewPicks);

    // 2) 新词：外部给定（专题整包）或按队列顺序取
    const qWords = state.queue.words;
    if (forcedNew) {
      newPick.push(...forcedNew);
      for (const id of newPick) {
        const ix = qWords.indexOf(id);
        if (ix >= 0) qWords.splice(ix, 1);
      }
    } else {
      let needNew = state.profile.goalW;
      while (needNew > 0 && qWords.length) {
        const wid = qWords.shift();
        if (reviewSet.has(wid)) continue;
        newPick.push(wid); needNew--;
      }
    }

    // 3) 组装题目：复习词单题（交替方向），新词首看+双向两题；交错排列
    const items = [];
    for (const wid of newPick) {
      items.push({ k: "w", wid, q: "w2c", isNew: true });
      items.push({ k: "w", wid, q: "c2w", isNew: true });
    }
    for (const wid of reviewPicks) {
      const t = hashStr(wid + dateStr) % 2 ? "w2c" : "c2w";
      items.push({ k: "w", wid, q: t, isNew: false });
    }
    // 交错：新词题与复习题穿插（简单做法：按 复习-复习-新-新 循环合并）
    const news = [], rews = [];
    items.forEach(it => (it.isNew ? news : rews).push(it));
    const mixed = [];
    let ni = 0, ri = 0;
    while (ni < news.length || ri < rews.length) {
      if (ri < rews.length) { mixed.push(rews[ri++]); if (ri < rews.length) mixed.push(rews[ri++]); }
      if (ni < news.length) { mixed.push(news[ni++]); if (ni < news.length) mixed.push(news[ni++]); }
    }

    // 4) 句子：优先包含今日新词的句
    const newWordTexts = new Set(newPick.map(id => (wordMap(content)[id] || {}).w.toLowerCase()));
    const pickedSents = [];
    const pool = state.queue.sents;
    const prefer = pool.filter(sid => sentsById(content)[sid].en.toLowerCase().split(/[^a-z'-]+/).some(t => newWordTexts.has(t)));
    for (const sid of prefer) { if (pickedSents.length >= state.profile.goalS) break; pickedSents.push(sid); pool.splice(pool.indexOf(sid), 1); }
    while (pickedSents.length < state.profile.goalS && pool.length) pickedSents.push(pool.shift());

    return {
      date: dateStr,
      wordItems: mixed,
      sentItems: pickedSents.map(sid => ({ k: "s", sid })),
      newIds: newPick, reviewIds: reviewPicks,
      total: mixed.length + pickedSents.length
    };
  }

  // ---------- 干扰项 ----------
  function makeOptions(word, content, rnd) {
    const cat = catOf(word.id);
    let pool = content.words.filter(w => w.id !== word.id && catOf(w.id) === cat);
    if (pool.length < 3) pool = content.words.filter(w => w.id !== word.id && w.pos === word.pos);
    if (pool.length < 3) pool = content.words.filter(w => w.id !== word.id);
    const picked = shuffle(pool, rnd).slice(0, 3);
    const opts = shuffle([word].concat(picked), rnd);
    return opts.map(o => ({ id: o.id, label: o.w + (o.pos ? " " + o.pos : "") }));
  }
  function makeOptionsMeaning(word, content, rnd) {
    const cat = catOf(word.id);
    let pool = content.words.filter(w => w.id !== word.id && catOf(w.id) === cat);
    if (pool.length < 3) pool = content.words.filter(w => w.id !== word.id);
    const picked = shuffle(pool, rnd).slice(0, 3);
    const opts = shuffle([word].concat(picked), rnd);
    return opts.map(o => ({ id: o.id, label: (o.pos || "") + " " + o.cn }));
  }

  // ---------- 作答判定与掌握度 ----------
  function applyAnswer(uw, wid, qtype, correct, dateStr) {
    const rec = uw[wid] || (uw[wid] = { lv: 0, ok: 0, w: 0, lastErr: "", nr: "", de: 0, ded: "", lastQ: "" });
    rec.lastQ = qtype;
    if (correct) {
      rec.ok += 1;
      if (rec.ok >= 2 && rec.lv < 3) { rec.lv += 1; rec.ok = 0; }
      rec.nr = addDays(dateStr, rec.lv === 3 ? 15 : LEVEL_INTERVAL[rec.lv]);
      rec.de = 0;
    } else {
      if (rec.ded !== dateStr) { rec.de = 0; rec.ded = dateStr; }
      rec.de += 1;
      const streakMul = rec.de === 1 ? 1 : rec.de === 2 ? 1.5 : 2;
      rec.w += QCOEF[qtype] * streakMul;
      rec.lv = Math.max(0, rec.lv - 2); rec.ok = 0;
      rec.nr = dateStr; rec.lastErr = dateStr;
    }
    return rec;
  }
  function effWeight(rec, dateStr) {
    if (!rec || !rec.lastErr) return 0;
    const age = diffDays(rec.lastErr, dateStr);
    return age > 30 ? rec.w * 0.5 : rec.w;
  }
  function applySent(uS, sid, rating, dateStr) {
    const rec = uS[sid] || (uS[sid] = { times: 0, last: "", nr: "", poor: 0 });
    rec.times += 1; rec.last = rating;
    if (rating === "poor") { rec.poor += 1; rec.nr = dateStr; } // 明日队列由 forceTomorrow 句子→词 处理；句子自身次日重排
    else rec.nr = addDays(dateStr, rating === "ok" ? 4 : 7);
    return rec;
  }

  // ---------- 当日报告 ----------
  function buildReport(task, ans, uw, uS, content, dateStr) {
    let wordTotal = 0, wordCorrect = 0;
    const wrongWords = [];
    const byTag = {}; // scenario tag -> weight
    const byQ = { w2c: [0, 0], c2w: [0, 0] }; // [wrong, total]
    const sentRatings = {};
    let sentPoor = 0, sentN = 0;
    for (const a of ans) {
      if (a.k === "w") {
        wordTotal++; byQ[a.q][1]++;
        if (a.ok) wordCorrect++;
        else {
          byQ[a.q][0]++;
          const wd = wordMap(content)[a.wid];
          if (!wrongWords.find(x => x.id === a.wid)) wrongWords.push(wd);
          (wd.t || []).forEach(t => {
            byTag[t] = (byTag[t] || 0) + QCOEF[a.q] * (a.de >= 2 ? 1.5 : 1);
          });
        }
      } else {
        sentN++;
        if (a.rating === "poor") sentPoor++;
      }
    }
    // 薄弱点：历史累积权重（今天新错的已含在 uw.w）
    const histTag = {};
    for (const [wid, rec] of Object.entries(uw)) {
      const w = effWeight(rec, dateStr);
      if (w <= 0) continue;
      (wordMap(content)[wid].t || []).forEach(t => { histTag[t] = (histTag[t] || 0) + w; });
    }
    const topTags = Object.entries(histTag).sort((a, b) => b[1] - a[1]).slice(0, 2)
      .map(([t, w]) => ({ tag: t, name: SCEN[t], w: +w.toFixed(1) }));
    const dir = {};
    for (const k of ["w2c", "c2w"]) {
      const [wr, tot] = byQ[k];
      dir[k] = tot ? wr / tot : 0;
    }
    return {
      date: dateStr,
      wordTotal, wordCorrect,
      acc: wordTotal ? Math.round((wordCorrect / wordTotal) * 100) : 0,
      wrongWords, topTags,
      dir, sentPoor, sentN, sentRatings,
      suggestions: makeSuggestions(byQ, topTags, sentRatings, dateStr, uw, content)
    };
  }

  function makeSuggestions(byQ, topTags, sentRatings, dateStr, uw, content) {
    const out = [];
    const [w2r, w2t] = byQ.w2c, [cr, ct] = byQ.c2w;
    if (ct && cr / ct > 0.4 && (w2t ? cr / ct > w2r / w2t + 0.1 : true)) {
      out.push("“看中文选英文”错得明显更多 → 你的<b>输出（中→英）</b>弱于识别。读句子时试试先盖住英文、看中文自己说一遍，再对照。");
    } else if (w2t && w2r / w2t > 0.4) {
      out.push("“看英文选中文”错得多 → 专业词识别仍是短板，建议每天先过首看卡再做题，别急着跳过。");
    }
    const forceList = forceTomorrowIds(uw, dateStr);
    if (topTags.length && topTags[0].w >= 1.5) {
      out.push(`薄弱场景集中在<b>「${topTags[0].name}」</b>（错误权重 ${topTags[0].w}）。明天已把相关薄弱词排进强化队列。`);
    }
    const worstSc = Object.entries(sentRatings).sort((a, b) => b[1] - a[1])[0];
    if (worstSc && worstSc[1] >= 1.5) {
      out.push(`跟读自评最弱的是<b>「${SCEN[worstSc[0]]}」</b>场景 → 建议朗读该场景句子时放慢到 0.75x，重点看逐词 note 里的重音词。`);
    }
    if (!out.length) out.push("今日表现均衡 👍 保持节奏，薄弱点在积累前看不明显，连续学 3 天分析会更准。");
    return out;
  }
  function forceTomorrowIds(uw, dateStr) {
    return Object.entries(uw)
      .filter(([, r]) => r.lastErr === dateStr && effWeight(r, dateStr) >= 1.5)
      .map(([id]) => id).slice(0, 5);
  }

  // ---------- 主题课包 ----------
  // state.theme = {i: 当前主题下标, consumed: 该包已消费词数}
  function themeIds(content) { return content.themes.map(t => t.id); }
  function themePlan(state, content, dateStr) {
    const ids = themeIds(content);
    if (!state.theme) state.theme = { i: 0, consumed: 0 };
    // 防御对齐：若当前包其实已吃完，前进
    while (state.theme.i < ids.length && state.theme.consumed >= content.wordsByTheme[ids[state.theme.i]].length) {
      state.theme.i++; state.theme.consumed = 0;
    }
    if (state.theme.i >= ids.length) return { theme: null, newIds: [], articleDue: false };
    const t = content.themes[state.theme.i];
    const pack = content.wordsByTheme[t.id];
    // 旧版"多日一包"进度的迁移：半包 consumed 不再有意义，重置后按已学过滤
    if (state.theme.consumed > 0 && state.theme.consumed < pack.length) state.theme.consumed = 0;
    const newIds = pack.slice(state.theme.consumed).filter(w => !state.userWords[w]);
    return { theme: t, themeNo: state.theme.i + 1, total: ids.length, newIds, articleDue: true };
  }
  // 一次 session = 一整包：提交即吃完本包（含已会词跳过的情形，防卡死）
  function themeCommit(state, content, newIds) {
    if (!state.theme) return;
    const ids = themeIds(content);
    if (state.theme.i >= ids.length) return;
    const pack = content.wordsByTheme[ids[state.theme.i]];
    state.theme.consumed = pack.length;
  }
  function themeAdvance(state, content) {
    const ids = themeIds(content);
    if (!state.theme) return;
    const pack = content.wordsByTheme[ids[Math.min(state.theme.i, ids.length - 1)]];
    if (state.theme.consumed >= pack.length && state.theme.i < ids.length - 1) {
      state.theme.i++; state.theme.consumed = 0;
    }
  }
  function themeQueue(state, content) {
    const uw = state.userWords, mapped = new Set(), out = [];
    for (const t of content.themes)
      for (const wid of content.wordsByTheme[t.id]) { mapped.add(wid); if (!uw[wid]) out.push(wid); }
    for (const w of content.words) if (!mapped.has(w.id) && !uw[w.id]) out.push(w.id);
    return out;
  }

  // ---------- 备份码 ----------
  function encodeBackup(state) {
    const core = {
      v: 1, uid: state.uid, profile: state.profile, streak: state.streak,
      userWords: state.userWords, uSents: state.uSents, queue: state.queue,
      forceTomorrow: state.forceTomorrow, days: state.days, theme: state.theme
    };
    const s = "ZY1." + btoa(unescape(encodeURIComponent(JSON.stringify(core))));
    return s;
  }
  function decodeBackup(code) {
    if (!code.startsWith("ZY1.")) throw new Error("备份码前缀不对，可能复制不完整");
    const json = decodeURIComponent(escape(atob(code.slice(4))));
    const obj = JSON.parse(json);
    if (obj.v !== 1 || !obj.uid) throw new Error("备份码格式无法识别");
    return obj;
  }

  // ---------- 内容索引缓存 ----------
  let _wm = null, _sm = null, _smKey = 0;
  function wordMap(content) {
    if (!_wm || content.words !== _smKey) { _wm = {}; content.words.forEach(w => _wm[w.id] = w); _smKey = content.words; }
    return _wm;
  }
  function sentsById(content) {
    if (!_sm) { _sm = {}; content.sents.forEach(s => _sm[s.id] = s); }
    return _sm;
  }

  const Engine = {
    hashStr, mulberry32, shuffle, todayKey, addDays, diffDays,
    CATS, SCEN, LEVEL_INTERVAL, QCOEF, catOf,
    buildTask, makeOptions, makeOptionsMeaning, applyAnswer, effWeight, applySent,
    buildReport, makeSuggestions, forceTomorrowIds, encodeBackup, decodeBackup,
    themePlan, themeCommit, themeAdvance, themeQueue, themeIds,
    wordMap, sentsById
  };
  if (typeof module !== "undefined") module.exports = Engine;
  else root.Engine = Engine;
})(typeof window !== "undefined" ? window : this);

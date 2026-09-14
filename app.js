// 职言 H5 原型 UI 层
(function () {
  "use strict";
  const $ = id => document.getElementById(id);
  const content = { words: window.W, sents: window.S };
  const KEY = "zy_v1";
  let state = null;

  // ---------- 存储 ----------
  function load() {
    try { state = JSON.parse(localStorage.getItem(KEY)); } catch (e) { state = null; }
    if (!state) state = null;
  }
  function save() { localStorage.setItem(KEY, JSON.stringify(state)); }
  function defaultState() {
    const uid = "u" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
    return {
      uid, profile: { goalW: 10, goalS: 3, createdAt: E.todayKey() },
      streak: { count: 0, lastDone: null }, maxTs: Date.now(),
      userWords: {}, uSents: {}, forceTomorrow: [], days: {}, session: null,
      queue: null
    };
  }
  function topUpQueues() {
    if (!state.queue) state.queue = { words: [], sents: [] };
    const inQ = new Set(state.queue.words);
    const miss = content.words.map(w => w.id).filter(id => !state.userWords[id] && !inQ.has(id));
    if (!state.queue.words.length && miss.length)
      state.queue.words = E.shuffle(miss, E.mulberry32(E.hashStr(state.uid + "w")));
    const sq = new Set(state.queue.sents);
    const smiss = content.sents.map(s => s.id).filter(id => !state.uSents[id] && !sq.has(id));
    if (!state.queue.sents.length && smiss.length)
      state.queue.sents = E.shuffle(smiss, E.mulberry32(E.hashStr(state.uid + "s")));
  }

  // ---------- 视图切换 ----------
  function show(id) {
    document.querySelectorAll(".view").forEach(v => v.classList.remove("on"));
    $(id).classList.add("on");
    window.scrollTo(0, 0);
  }
  let toastTimer = 0;
  function toast(msg) {
    const t = $("toast"); t.textContent = msg; t.style.display = "block";
    clearTimeout(toastTimer); toastTimer = setTimeout(() => (t.style.display = "none"), 2200);
  }
  function openSheet(html) { $("sheet").innerHTML = html; $("mask").classList.add("on"); }
  $("mask").addEventListener("click", e => { if (e.target === $("mask")) $("mask").classList.remove("on"); });

  // ---------- 发音 ----------
  let voiceCache = null;
  function pickVoice() {
    const vs = speechSynthesis.getVoices().filter(v => v.lang && v.lang.startsWith("en"));
    return vs.find(v => /en[-_]US/i.test(v.lang)) || vs[0] || null;
  }
  if ("speechSynthesis" in window) {
    speechSynthesis.onvoiceschanged = () => { voiceCache = pickVoice(); };
    voiceCache = pickVoice();
  }
  function speak(text, rate, onB, onEnd) {
    if (!("speechSynthesis" in window)) { toast("该浏览器不支持发音，建议用 Chrome / Safari"); return; }
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = "en-US"; u.rate = rate || 0.95;
    const v = voiceCache || pickVoice(); if (v) u.voice = v;
    if (onB) u.onboundary = onB;
    if (onEnd) u.onend = onEnd;
    speechSynthesis.speak(u);
  }

  // ---------- 词查询 ----------
  const dictLower = {};
  content.words.forEach(w => { dictLower[w.w.toLowerCase()] = w; });
  const sentNotes = {};
  content.sents.forEach(s => { sentNotes[s.id] = {}; (s.notes || []).forEach(([t, m]) => { sentNotes[s.id][t.toLowerCase()] = m; }); });

  // ---------- 首页 ----------
  function renderHome() {
    const today = E.todayKey();
    $("h-date").textContent = today;
    const learned = Object.keys(state.userWords).length;
    const mastered = Object.values(state.userWords).filter(r => r.lv >= 2).length;
    $("h-stat").innerHTML = `词库 <b>${content.words.length}</b> 词 · 已学 <b>${learned}</b> · 已掌握 <b>${mastered}</b>`;
    $("h-flame").innerHTML = state.streak.count > 0
      ? `已连续学习 <span class="flame">${state.streak.count}</span> 天 🔥` : "今天开始你的第一个 1 天";
    const sess = state.session;
    const resuming = sess && !sess.done && sess.items;
    const doneToday = sess && sess.done && sess.date === today;
    $("btn-start").textContent = resuming ? "继续今天的学习" : (doneToday ? "今日已完成 ✓" : "开始学习");
    $("btn-start").disabled = !!doneToday;
    $("btn-start").className = doneToday ? "btn gray" : "btn";

    // 进度
    let progTxt = "", pct = 0;
    if (resuming) {
      progTxt = `已完成 ${sess.idx}/${sess.items.length} 题`; pct = sess.idx / sess.items.length * 100;
    } else if (doneToday) {
      progTxt = "全部完成，明早见 ☀️"; pct = 100;
    } else {
      const due = countDue(today);
      progTxt = `待学：新词 ${Math.min(state.profile.goalW, state.queue.words.length)} · 复习 ${due} · 句子 ${state.profile.goalS}`;
    }
    $("h-progress").textContent = progTxt;
    $("h-prog").style.width = pct + "%";

    // 昨日报告摘要
    const dates = Object.keys(state.days).sort();
    const last = dates[dates.length - 1];
    if (last && last !== today) {
      const d = state.days[last];
      $("h-report").innerHTML = `<h2>${last} 报告</h2><div class="sub">正确率 ${d.acc}% · 错 ${d.wrong} 词 · 已按薄弱点排入今日复习</div>`;
    } else if (!last) {
      $("h-report").innerHTML = `<h2>学习说明</h2><div class="sub" style="line-height:1.7">先<b>首看</b>新词，再双向做题（英→中、中→英），错与对都有<b>专业解析</b>；之后朗读场景句。<br>进度存本机，词库 450 词 / 句库 50 句，学完可继续扩。</div>`;
    } else {
      const d = state.days[last];
      $("h-report").innerHTML = `<h2>今日战报</h2><div class="sub">正确率 ${d.acc}% · 错 ${d.wrong} 词</div>`;
    }
    // 目标 chips
    renderChips("goal-w", [5, 10, 15], state.profile.goalW, v => {
      state.profile.goalW = v; save(); toast(sess && !sess.done ? "已保存，明日任务生效" : "已保存，明日任务生效"); renderHome();
    });
    renderChips("goal-s", [2, 3, 4], state.profile.goalS, v => { state.profile.goalS = v; save(); renderHome(); });
    $("h-goal").textContent = `每天 ${state.profile.goalW} 词 + ${state.profile.goalS} 句`;
  }
  function countDue(today) {
    let n = 0;
    const forced = new Set(state.forceTomorrow);
    for (const [wid, r] of Object.entries(state.userWords)) {
      if (r.lv > 0 && (r.nr <= today || forced.has(wid))) n++;
    }
    return n;
  }
  function renderChips(id, vals, cur, onSel) {
    const box = $(id); box.innerHTML = "";
    vals.forEach(v => {
      const b = document.createElement("button");
      b.className = "chip" + (v === cur ? " sel" : ""); b.textContent = v;
      b.onclick = () => onSel(v); box.appendChild(b);
    });
  }

  // ---------- 开始/恢复 session ----------
  function startSession() {
    const today = E.todayKey();
    if (state.session && !state.session.done && state.session.items) { /* 继续未完成任务（含昨日未做完的） */ }
    else {
      topUpQueues();
      const task = E.buildTask(state, content, today);
      const items = task.wordItems.concat(task.sentItems);
      if (!items.length) { toast("今日无任务：词库学习完毕 + 无到期复习，请等待新词库"); return; }
      state.session = { date: today, items, idx: 0, ans: [], firstShown: [], done: false };
      save();
    }
    renderStep(); show("v-word");
  }

  function curItem() { return state.session.items[state.session.idx]; }
  function stepPct() { return state.session.idx / state.session.items.length * 100; }
  function advance() {
    state.session.idx++; save();
    if (state.session.idx >= state.session.items.length) return finishSession();
    renderStep();
  }

  function renderStep() {
    const it = curItem();
    if (!it) return finishSession();
    if (it.k === "w") renderWord(it); else renderSent(it);
  }

  // ---------- 单词题 ----------
  function renderWord(it) {
    const sess = state.session;
    const wd = E.wordMap(content)[it.wid];
    if (it.isNew && !sess.firstShown.includes(it.wid)) {
      sess.firstShown.push(it.wid);
      $("v-word").className = "view on"; $("v-sent").className = "view";
      $("w-prog").style.width = stepPct() + "%";
      $("w-body").innerHTML = `
        <div class="card" style="text-align:center">
          <div class="sub">新词首看</div>
          <div class="bigword">${wd.w} <button class="speak" data-sp="${wd.w}">🔊</button></div>
          <div style="font-size:17px;margin:4px 0">${wd.pos || ""} ${wd.cn}</div>
          <div class="sub" style="margin-top:10px">${wd.ex}<br>${wd.exc}</div>
          <button class="btn" id="fl-go">记住了，开始测试</button>
        </div>`;
      bindSpeak($("w-body"));
      $("fl-go").onclick = renderStep0;
      return;
    }
    renderStep0();
  }
  function renderStep0() {
    const sess = state.session, it = curItem();
    const wd = E.wordMap(content)[it.wid];
    $("v-word").className = "view on"; $("v-sent").className = "view";
    $("w-prog").style.width = stepPct() + "%";
    const rnd = E.mulberry32(E.hashStr(sess.date + it.wid + it.q));
    const opts = it.q === "w2c" ? E.makeOptionsMeaning(wd, content, rnd) : E.makeOptions(wd, content, rnd);
    const prompt = it.q === "w2c"
      ? `<div class="bigword">${wd.w} <button class="speak" data-sp="${wd.w}">🔊</button></div><div class="sub">选它的专业含义（英→中）</div>`
      : `<div class="bigword">"${wd.cn}"</div><div class="sub">选对应的专业英文（中→英）</div>`;
    $("w-body").innerHTML = `
      <div class="card">${prompt}
        <div id="opts">${opts.map(o => `<button class="opt" data-id="${o.id}">${o.label}</button>`).join("")}</div>
        <div id="wp" style="display:none"></div>
      </div>`;
    bindSpeak($("w-body"));
    $("opts").querySelectorAll(".opt").forEach(btn => {
      btn.onclick = () => onAnswer(btn, opts, wd, it);
    });
  }
  function onAnswer(btn, opts, wd, it) {
    const sess = state.session;
    const selId = btn.dataset.id, ok = selId === wd.id;
    const rec = E.applyAnswer(state.userWords, wd.id, it.q, ok, sess.date);
    sess.ans.push({ k: "w", wid: wd.id, q: it.q, ok, de: ok ? 0 : rec.de });
    save();
    $("opts").querySelectorAll(".opt").forEach(b => { b.disabled = true; if (b.dataset.id === wd.id) b.classList.add("show-c"); });
    if (!ok) btn.classList.add("sel-w"); else btn.classList.add("sel-r");
    // 解析面板（对错都展开）
    const t = wd.t.map(x => `<span class="tag">${E.SCEN[x]}</span>`).join("");
    $("wp").innerHTML = `
      <div class="panel">
        <div class="verdict ${ok ? "g" : "b"}">${ok ? "✓ 回答正确" : "✗ 正确答案：" + wd.w}</div>
        <div><b>${wd.w}</b> ${wd.pos}　${wd.cn} ${t}</div>
        <button class="speak" data-sp="${wd.w}" style="margin:6px 0">🔊 读单词</button>
        <button class="speak" data-sp="${wd.ex}" style="margin:6px 0">🔊 读例句</button>
        <div class="kv">例：${wd.ex}<br>${wd.exc}</div>
        ${wd.col ? `<div><b>搭配</b> ${wd.col}</div>` : ""}
        ${wd.conf ? `<div><b>易混</b> ${wd.conf}</div>` : ""}
        ${wd.tip ? `<div><b>记忆</b> ${wd.tip}</div>` : ""}
        <button class="btn" id="w-next">下一题</button>
      </div>`;
    $("wp").style.display = "block";
    bindSpeak($("wp"));
    $("w-next").textContent = sess.idx === sess.items.length - 1 ? "完成，查看报告" : "下一题";
    $("w-next").onclick = advance;
    if (!ok) toast("已加入错题本，明日强化复习");
  }

  // ---------- 句子 ----------
  let sentTimer = null;
  function renderSent(it) {
    $("v-word").className = "view"; $("v-sent").className = "view on";
    $("s-prog").style.width = stepPct() + "%";
    const sd = E.sentsById(content)[it.sid];
    const toks = sd.en.split(" ");
    const noteMap = sentNotes[sd.id];
    let pos = 0;
    const spans = toks.map((tk, i) => {
      const start = pos; pos += tk.length + 1;
      const norm = tk.toLowerCase().replace(/[.,;:!?"()]/g, "");
      const note = noteMap[norm] || noteMap[norm.replace(/s$/, "")];
      const d = dictLower[norm];
      const cls = "tok" + ((note || d) ? " has-note" : "");
      return `<span class="${cls}" data-i="${i}" data-t="${tk.replace(/"/g, "&quot;")}">${tk}</span>`;
    }).join(" ");
    $("s-body").innerHTML = `
      <div class="card">
        <div class="sub">${E.SCEN[sd.sc]} · 朗读（看着读出声即可）</div>
        <div class="sentence" id="sent">${spans}</div>
        <div class="cn-line">${sd.cn}</div>
        <div style="margin-top:12px">
          <button class="speak" id="sp-1">▶ 整句 1.0x</button>
          <button class="speak" id="sp-075">▶ 0.75x</button>
        </div>
        ${sd.usage ? `<div class="usage"><b>句式</b> ${sd.usage}</div>` : ""}
        <div class="sub" style="margin-top:10px">点下划线单词看逐词解析 · 读完做自评</div>
        <div class="chips" style="margin-top:12px">
          <button class="chip" data-r="good">挺顺</button>
          <button class="chip" data-r="ok">一般</button>
          <button class="chip" data-r="poor">没说好</button>
        </div>
        <button class="btn gray" id="s-next2">跳过此句</button>
      </div>`;
    const tokEls = [...$("sent").querySelectorAll(".tok")];
    const starts = []; let acc = 0;
    toks.forEach(t => { starts.push(acc); acc += t.length + 1; });
    function highlight(idx) {
      tokEls.forEach(e => e.classList.remove("hl"));
      if (idx >= 0 && tokEls[idx]) tokEls[idx].classList.add("hl");
    }
    function play(rate) {
      clearInterval(sentTimer);
      let supported = false;
      speak(sd.en, rate, ev => {
        supported = true;
        const ci = ev.charIndex;
        let idx = 0; for (let i = 0; i < starts.length; i++) if (ci >= starts[i]) idx = i;
        highlight(idx);
      }, () => highlight(-1));
      // 不支持 boundary 的机型：按时长估算推进
      setTimeout(() => {
        if (supported) return;
        let i = 0;
        sentTimer = setInterval(() => { i++; highlight(i); if (i >= toks.length) { clearInterval(sentTimer); highlight(-1); } }, 500 / rate);
      }, 600);
    }
    $("sp-1").onclick = () => play(1.0);
    $("sp-075").onclick = () => play(0.75);
    tokEls.forEach(e => {
      e.onclick = () => {
        const tk = e.dataset.t, norm = tk.toLowerCase().replace(/[.,;:!?"()]/g, "");
        const note = noteMap[norm] || noteMap[norm.replace(/s$/, "")];
        const d = dictLower[norm];
        let html = `<h2>${tk} <button class="speak" data-sp="${norm}">🔊</button></h2>`;
        if (d) html += `<div style="line-height:1.8">${d.pos || ""} <b>${d.cn}</b>${d.col ? `<br><span class="kv">搭配</span> ${d.col}` : ""}${d.conf ? `<br><span class="kv">易混</span> ${d.conf}` : ""}</div>`;
        else if (note) html += `<div style="line-height:1.8">${note}</div>`;
        else html += `<div class="sub">这个词不在词条里，本句重点词都有黄色下划线。</div>`;
        if (note && d) html += `<div class="kv" style="margin-top:8px">本句中：${note}</div>`;
        openSheet(html); bindSpeak($("sheet"));
      };
    });
    const rate = (r) => {
      E.applySent(state.uSents, sd.id, r, state.session.date);
      state.session.ans.push({ k: "s", sid: sd.id, rating: r });
      if (r === "poor") toast("已标记，明天再读一遍");
      save(); advance();
    };
    $("s-body").querySelectorAll("[data-r]").forEach(b => (b.onclick = () => rate(b.dataset.r)));
    $("s-next2").onclick = () => rate("ok");
  }

  // ---------- 完成与报告 ----------
  function finishSession() {
    const sess = state.session, date = sess.date;
    const rep = E.buildReport(sess.items, sess.ans, state.userWords, state.uSents, content, date);
    if (state.streak.lastDone !== date) {
      state.streak.count = (state.streak.lastDone === E.addDays(date, -1)) ? state.streak.count + 1 : 1;
      state.streak.lastDone = date;
    }
    state.days[date] = { acc: rep.acc, wrong: rep.wrongWords.length, sentPoor: rep.sentPoor };
    state.forceTomorrow = E.forceTomorrowIds(state.userWords, date);
    sess.done = true; save();
    topUpQueues(); save();
    renderReport(rep); show("v-report");
  }
  function renderReport(rep) {
    const tagTxt = rep.topTags.length
      ? rep.topTags.map(t => `「${t.name}」权重 ${t.w}`).join("、") : "暂无明显薄弱（继续积累 3 天更准）";
    $("r-body").innerHTML = `
      <div class="card">
        <h1>🎉 今日任务完成</h1>
        <div class="stat" style="margin-top:14px">
          <div><div class="n">${rep.acc}%</div><div class="sub">正确率</div></div>
          <div><div class="n">${rep.wordCorrect}/${rep.wordTotal}</div><div class="sub">词题对/总</div></div>
          <div><div class="n">${rep.sentN - rep.sentPoor}/${rep.sentN}</div><div class="sub">句子自评定</div></div>
        </div>
        <div class="panel">
          <div class="verdict">薄弱点</div>
          <div>① ${tagTxt}</div>
          ${rep.dir.c2w > rep.dir.w2c && rep.dir.c2w > 0 ? `<div>② 中→英 错率 ${Math.round(rep.dir.c2w * 100)}% ＞ 英→中 ${Math.round(rep.dir.w2c * 100)}% → 输出偏弱</div>` : ""}
          ${rep.sentPoor ? `<div>③ ${rep.sentPoor} 个句子自评"没说好"，已排入明日</div>` : ""}
        </div>
        ${rep.wrongWords.length ? `
        <div class="panel">
          <div class="verdict b">今日错词（${rep.wrongWords.length}）</div>
          ${rep.wrongWords.map(w => `<div class="row"><span class="en">${w.w}</span><span class="sub">${w.pos} ${w.cn}</span></div>`).join("")}
        </div>` : ""}
        <div class="panel">
          <div class="verdict">攻克建议</div>
          ${rep.suggestions.map(s => `<div class="sug">· ${s}</div>`).join("")}
        </div>
        <button class="btn" id="r-home">完成</button>
      </div>`;
    $("r-home").onclick = () => { renderHome(); show("v-home"); };
  }

  // ---------- 词库 ----------
  let bkFilter = "all";
  function renderBook() {
    const kw = $("bk-search").value.trim().toLowerCase();
    const box = $("bk-list");
    const rows = content.words.filter(w => {
      const r = state.userWords[w.id];
      const lv = r ? r.lv : 0;
      if (bkFilter === "new" && lv > 0) return false;
      if (bkFilter === "w2" && !(lv >= 1 && lv <= 2)) return false;
      if (bkFilter === "m3" && lv !== 3) return false;
      if (kw && !(w.w.toLowerCase().includes(kw) || w.cn.includes(kw))) return false;
      return true;
    });
    const shown = rows.slice(0, 300);
    box.innerHTML = shown.map(w => {
      const r = state.userWords[w.id];
      const lv = r ? r.lv : 0;
      return `<div class="row" data-id="${w.id}"><span><span class="en">${w.w}</span> <span class="sub">${w.pos} ${w.cn}</span></span><span class="lv lv${lv}">${["未学", "学习中", "熟悉", "掌握"][lv]}</span></div>`;
    }).join("") || `<div class="empty">没有匹配的词</div>`;
    if (rows.length > 300) box.innerHTML += `<div class="sub" style="text-align:center">共 ${rows.length} 个，显示前 300，请用搜索缩小</div>`;
    box.querySelectorAll(".row").forEach(row => {
      row.onclick = () => {
        const w = E.wordMap(content)[row.dataset.id];
        openSheet(`<div style="text-align:center">
            <div class="bigword">${w.w} <button class="speak" data-sp="${w.w}">🔊</button></div>
            <div>${w.pos} ${w.cn}</div>
            <div class="sub" style="margin-top:8px">${w.ex}<br>${w.exc}</div>
            ${w.col ? `<div class="panel"><b>搭配</b> ${w.col}</div>` : ""}
            ${w.conf ? `<div class="panel"><b>易混</b> ${w.conf}</div>` : ""}
            ${w.tip ? `<div class="panel"><b>记忆</b> ${w.tip}</div>` : ""}
            <button class="btn ghost" id="bk-addq">加到明日复习</button>
          </div>`);
        bindSpeak($("sheet"));
        $("bk-addq").onclick = () => {
          const r = state.userWords[w.id];
          if (r) { r.nr = E.addDays(E.todayKey(), 1); }
          else { state.queue.words.unshift(w.id); }
          save(); toast("已加入明日任务"); $("mask").classList.remove("on");
        };
      };
    });
  }
  function initBook() {
    const filters = [["all", "全部"], ["new", "未学"], ["w2", "学习中"], ["m3", "已掌握"]];
    $("bk-filter").innerHTML = filters.map(([k, n]) => `<button class="chip${k === bkFilter ? " sel" : ""}" data-f="${k}">${n}</button>`).join("");
    $("bk-filter").querySelectorAll(".chip").forEach(c => c.onclick = () => { bkFilter = c.dataset.f; initBook(); renderBook(); });
    renderBook();
  }

  // ---------- 备份 ----------
  function exportBk() {
    const code = E.encodeBackup(state);
    $("bk-export").style.display = "block"; $("bk-export").value = code;
    $("bk-export").select();
    try { document.execCommand("copy"); toast("已复制，去备忘录粘贴保存"); } catch (e) { toast("已填入下方，长按全选复制"); }
  }
  function importBk() {
    openSheet(`<h2>恢复进度</h2><p class="sub">粘贴之前保存的备份码，当前进度将被替换。</p>
      <textarea class="bk" id="imp"></textarea><button class="btn" id="imp-go">恢复</button>`);
    $("imp-go").onclick = () => {
      try {
        const obj = E.decodeBackup($("imp").value.trim());
        state = Object.assign(defaultState(), obj, { session: null });
        topUpQueues(); save(); toast("恢复成功 ✓"); $("mask").classList.remove("on"); renderHome(); show("v-home");
      } catch (e) { toast("备份码无效：" + e.message); }
    };
  }

  // ---------- 首次进入 ----------
  function onboarding() {
    openSheet(`<h2>欢迎用「职言」练专业英语 🏭</h2>
      <p class="sub" style="line-height:1.8">面向电池热管理工程师：<b>450 个专业词 + 50 个海外会议场景句</b>。<br>每天流程：看词选义 → 看义选词 → 解析 → 朗读句子。错题自动加权进复习。<br>进度只存本机，可用"备份码"防丢。</p>
      <div class="panel"><b>每日新词</b>
        <div class="chips" id="on-w" style="margin-top:8px"></div>
        <b style="display:block;margin-top:12px">每日句子</b>
        <div class="chips" id="on-s" style="margin-top:8px"></div>
      </div>
      <button class="btn" id="on-go">开始今天的学习</button>`);
    renderChips("on-w", [5, 10, 15], state.profile.goalW, v => (state.profile.goalW = v, $("on-w").querySelectorAll(".chip").forEach((c, i) => c.classList.toggle("sel", [5, 10, 15][i] === v))));
    renderChips("on-s", [2, 3, 4], state.profile.goalS, v => (state.profile.goalS = v, $("on-s").querySelectorAll(".chip").forEach((c, i) => c.classList.toggle("sel", [2, 3, 4][i] === v))));
    $("on-go").onclick = () => { save(); $("mask").classList.remove("on"); renderHome(); show("v-home"); toast("今日任务已生成，开始吧"); };
  }

  // ---------- 时钟防护 ----------
  function clockGuard() {
    const now = Date.now();
    if (state.maxTs && now < state.maxTs - 2 * 3600e3) toast("检测到系统时间被回调，连续打卡暂不计新增");
    state.maxTs = Math.max(now, state.maxTs || 0);
  }

  function bindSpeak(scope) {
    scope.querySelectorAll(".speak").forEach(b => {
      if (b._bound) return; b._bound = true;
      b.onclick = e => { e.stopPropagation(); speak(b.dataset.sp, 0.95); };
    });
  }

  // ---------- 事件接线 ----------
  $("btn-start").onclick = () => { if (!state.session || state.session.done) { state.session = null; } startSession(); };
  $("btn-book").onclick = () => { initBook(); show("v-book"); };
  $("btn-back-home").onclick = () => renderHome() || show("v-home");
  $("bk-search").addEventListener("input", renderBook);
  $("btn-export").onclick = exportBk;
  $("btn-import").onclick = importBk;

  // ---------- 启动 ----------
  const E = window.Engine;
  load();
  if (!state) { state = defaultState(); topUpQueues(); save(); onboarding(); renderHome(); show("v-home"); }
  else {
    clockGuard(); topUpQueues(); save(); renderHome(); show("v-home");
    if (state.session && !state.session.done && state.session.items && state.session.date !== E.todayKey()) {
      toast("检测到未完成的学习任务，点开始继续");
    }
  }
})();

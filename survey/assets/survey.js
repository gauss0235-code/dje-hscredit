/* 학생용 설문 화면 */
(function () {
  "use strict";
  var J = window.JCS, api = J.api, cfg = J.cfg;
  var app = document.getElementById("app");
  var params = new URLSearchParams(location.search);
  var LABELS = { 5: "매우 그렇다", 4: "그렇다", 3: "보통이다", 2: "그렇지 않다", 1: "전혀 그렇지 않다" };
  var SVG = function (body, extra) {
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"' +
      (extra || "") + ">" + body + "</svg>";
  };
  var ICON = {
    search: SVG('<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>'),
    chev: SVG('<path d="m9 6 6 6-6 6"/>', ' class="chev"'),
    check: SVG('<path d="m5 12.5 4.5 4.5L19 7.5"/>', ' stroke-width="2.6"'),
    clock: SVG('<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>'),
    info: SVG('<circle cx="12" cy="12" r="9"/><path d="M12 8h.01M11 12h1v5h1"/>'),
    lock: SVG('<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>'),
    list: SVG('<path d="M9 6h11M9 12h11M9 18h11M4 6h.01M4 12h.01M4 18h.01"/>'),
    online: SVG('<rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/>'),
    offline: SVG('<path d="M3 21h18M5 21V8l7-4 7 4v13M9 21v-5h6v5M9 11h.01M15 11h.01"/>'),
    career: SVG('<circle cx="12" cy="12" r="9"/><path d="m15.5 8.5-2 5-5 2 2-5z"/>'),
    done: SVG('<path d="m5 12.5 4.5 4.5L19 7.5"/>', ' stroke-width="2.4"')
  };

  var state = {
    survey: null, courses: [], course: null, answers: {}, school: "", query: "", submitting: false
  };

  /* ---------- 유틸 ---------- */
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function toast(msg, isError) {
    var box = document.getElementById("toasts");
    var t = document.createElement("div");
    t.className = "toast" + (isError ? " error" : "");
    t.textContent = msg;
    box.appendChild(t);
    setTimeout(function () { t.remove(); }, 3200);
  }
  function norm(s) {
    return String(s || "").toLowerCase().replace(/\s+/g, "").replace(/대전/g, "")
      .replace(/여자고등학교|여자고/g, "여고").replace(/고등학교/g, "고");
  }
  function typeKey(t) { return t === "온라인" ? "online" : t === "진로선택형" ? "career" : "offline"; }
  function typeIcon(t, done) {
    var k = typeKey(t);
    return '<span class="c-ic ' + k + '">' + (done ? ICON.done : ICON[k]) + "</span>";
  }
  function fmtDate(iso) {
    if (!iso) return "";
    var d = new Date(iso);
    return (d.getMonth() + 1) + "월 " + d.getDate() + "일 " + ("0" + d.getHours()).slice(-2) + ":" + ("0" + d.getMinutes()).slice(-2);
  }
  function deviceToken() {
    var t = J.store.get("jcs_device", null);
    if (!t) { t = J.uid(); J.store.set("jcs_device", t); }
    return t;
  }
  function doneKey() { return "jcs_done_" + state.survey.id; }
  function doneList() { return J.store.get(doneKey(), []); }
  function markDone(id) {
    var l = doneList();
    if (l.indexOf(id) < 0) { l.push(id); J.store.set(doneKey(), l); }
  }
  var preventDup = function () { return !(state.survey.settings && state.survey.settings.preventDuplicate === false); };
  var showTeacher = function () { return !(state.survey.settings && state.survey.settings.showTeacher === false); };
  function draftKey(cid) { return "jcs_draft_" + state.survey.id + "_" + cid; }
  function loadDraft(cid) { try { return JSON.parse(sessionStorage.getItem(draftKey(cid)) || "{}"); } catch (e) { return {}; } }
  function saveDraft() { try { sessionStorage.setItem(draftKey(state.course.id), JSON.stringify(state.answers)); } catch (e) { /* 무시 */ } }
  function clearDraft(cid) { try { sessionStorage.removeItem(draftKey(cid)); } catch (e) { /* 무시 */ } }
  function questions() { return (state.survey.questions || []).filter(function (q) { return q && q.id && q.type !== "section"; }); }
  function isAnswered(q) {
    var v = state.answers[q.id];
    if (v == null) return false;
    if (typeof v === "string") return v.trim() !== "";
    if (Array.isArray(v)) return v.length > 0;
    return true;
  }
  function stepper(n) {
    var names = ["강좌 선택", "문항 응답", "제출 완료"];
    return '<div class="stepper" aria-label="진행 단계 ' + n + '/3">' + names.map(function (nm, i) {
      var k = i + 1, cls = k < n ? "done" : k === n ? "on" : "";
      return (i ? '<span class="bar' + (k <= n ? " done" : "") + '"></span>' : "") +
        '<span class="st ' + cls + '"><b>' + (k < n ? "✓" : k) + "</b>" + nm + "</span>";
    }).join("") + "</div>";
  }
  function centerState(icon, title, body, extra, step) {
    app.innerHTML = '<div class="panel center-state">' + (step ? stepper(step) : "") +
      '<div class="state-icon' + (icon === "check" ? " ok" : "") + '">' + ICON[icon] +
      "</div><h2>" + esc(title) + "</h2>" + (body ? "<p>" + body + "</p>" : "") + (extra || "") + "</div>";
  }
  function setHero(s) {
    var t = String(s.title || "만족도 조사"), m = t.match(/^(.*?학기)\s+(.+)$/);
    document.getElementById("survey-title").innerHTML = m ?
      '<span class="t-term">' + esc(m[1]) + '</span><span class="t-main">' + esc(m[2]) + "</span>" :
      '<span class="t-main">' + esc(t) + "</span>";
    var nq = questions().length;
    document.getElementById("hero-chips").innerHTML =
      '<span class="hero-chip">' + ICON.lock + "익명 응답</span>" +
      '<span class="hero-chip">' + ICON.clock + "약 2분</span>" +
      '<span class="hero-chip">' + ICON.list + nq + "문항</span>";
  }

  /* ---------- 초기화 ---------- */
  function init() {
    if (J.isDemo) document.getElementById("demo-banner").classList.remove("hidden");
    if (cfg.PROGRAM_NAME) document.getElementById("program-name").textContent = cfg.PROGRAM_NAME;
    if (cfg.ORG_NAME) document.getElementById("org-name").textContent = cfg.ORG_NAME;
    api.getSurvey(params.get("s")).then(function (s) {
      if (!s) { centerState("info", "설문을 찾을 수 없어요", "QR코드를 다시 확인하거나 선생님께 문의해 주세요."); return; }
      state.survey = s;
      setHero(s);
      document.title = s.title;
      var now = Date.now();
      var notYet = s.opens_at && now < Date.parse(s.opens_at);
      var ended = s.closes_at && now > Date.parse(s.closes_at);
      if (!s.is_open || notYet || ended) {
        var period = "";
        if (s.opens_at || s.closes_at) {
          period = "<br>설문 기간: " + esc(fmtDate(s.opens_at) || "-") + " ~ " + esc(fmtDate(s.closes_at) || "-");
        }
        // 기간이 지나 끝난 경우만 '마감', 관리자가 아직 열지 않은 경우는 '응답을 받지 않는 중'
        var title = notYet ? "아직 설문이 시작되지 않았어요" : ended ? "설문이 마감되었어요" : "지금은 응답을 받지 않고 있어요";
        var body = ended ? "참여해 주셔서 감사합니다." : "설문 기간에 다시 접속해 주세요.";
        centerState("clock", title, body + period);
        return;
      }
      return api.listPublicCourses(s.id).then(function (list) {
        state.courses = list || [];
        if (!state.courses.length) { centerState("info", "등록된 강좌가 없어요", "담당 선생님께 문의해 주세요."); return; }
        history.replaceState({ step: "course" }, "");
        renderCourseStep();
      });
    }).catch(function (e) {
      var info = J.errorInfo(e);
      centerState("info", "설문을 불러오지 못했어요", esc(info.message),
        '<div class="done-actions"><button class="btn primary lg" onclick="location.reload()">다시 시도</button></div>');
    });

    window.addEventListener("popstate", function () {
      if (!state.survey || !state.courses.length) return;
      renderCourseStep();
    });
    window.addEventListener("scroll", function () {
      var st = document.querySelector(".sticky");
      if (st) st.classList.toggle("scrolled", window.scrollY > 120);
    }, { passive: true });
  }

  /* ---------- 1단계: 강좌 선택 ---------- */
  function renderCourseStep() {
    state.course = null;
    var s = state.survey;
    var schools = [];
    state.courses.forEach(function (c) { if (schools.indexOf(c.school) < 0) schools.push(c.school); });
    schools.sort(function (a, b) { return a.localeCompare(b, "ko"); });
    var done = doneList();
    var remaining = state.courses.filter(function (c) { return done.indexOf(c.id) < 0; }).length;

    app.innerHTML =
      '<section class="panel">' + stepper(1) +
        '<div class="step-head"><h2>어떤 강좌에 응답할까요?</h2>' +
        "<p>" + esc(s.description || "수강한 공동교육과정 강좌를 찾아 선택해 주세요.") + "</p></div>" +
        '<div class="picker">' +
          '<label class="search">' + ICON.search + '<span class="sr-only">강좌 검색</span>' +
            '<input id="q" class="input" type="search" inputmode="search" autocomplete="off" placeholder="강좌명·학교·선생님 이름으로 검색" value="' + esc(state.query) + '"></label>' +
          '<label><span class="sr-only">거점학교</span><select id="school" class="input">' +
            '<option value="">거점학교 전체 (' + schools.length + "개교)</option>" +
            schools.map(function (sc) { return '<option value="' + esc(sc) + '"' + (sc === state.school ? " selected" : "") + ">" + esc(sc) + "</option>"; }).join("") +
          "</select></label>" +
        "</div>" +
        (done.length ? '<div class="done-note">' + ICON.done + (remaining ? "응답 완료 " + done.length + "개 강좌 · 다른 강좌도 이어서 응답할 수 있어요" : "모든 강좌에 응답했어요. 감사합니다!") + "</div>" : "") +
      "</section>" +
      '<div class="course-list" id="list" role="list"></div>';

    var qEl = document.getElementById("q"), sEl = document.getElementById("school");
    var timer = null;
    qEl.addEventListener("input", function () {
      clearTimeout(timer);
      timer = setTimeout(function () { state.query = qEl.value; renderList(); }, 120);
    });
    sEl.addEventListener("change", function () { state.school = sEl.value; renderList(); });
    document.getElementById("list").addEventListener("click", function (ev) {
      var b = ev.target.closest(".course");
      if (!b || b.classList.contains("done")) return;
      var c = state.courses.find(function (x) { return x.id === b.getAttribute("data-id"); });
      if (c) openForm(c);
    });
    renderList();
    window.scrollTo(0, 0);
  }

  function renderList() {
    var list = document.getElementById("list");
    if (!list) return;
    var q = norm(state.query), done = doneList(), teacherOn = showTeacher();
    var items = state.courses.filter(function (c) {
      if (state.school && c.school !== state.school) return false;
      if (!q) return true;
      return norm(c.name).indexOf(q) >= 0 || norm(c.school).indexOf(q) >= 0 || (teacherOn && norm(c.teacher).indexOf(q) >= 0);
    });
    items.sort(function (a, b) {
      return a.school.localeCompare(b.school, "ko") || (a.seq || 0) - (b.seq || 0) || a.name.localeCompare(b.name, "ko");
    });
    if (!items.length) {
      list.innerHTML = '<div class="empty">검색 결과가 없어요.<br>강좌명을 짧게 입력해 보세요.</div>';
      return;
    }
    var counts = {};
    items.forEach(function (c) { counts[c.school] = (counts[c.school] || 0) + 1; });
    var html = "", last = null;
    items.forEach(function (c) {
      if (!state.school && c.school !== last) {
        html += '<div class="group-label">' + esc(c.school) + "<small>" + counts[c.school] + "개 강좌</small></div>";
        last = c.school;
      }
      var isDone = done.indexOf(c.id) >= 0;
      var meta = [esc(c.course_type || "")];
      if (state.school || q) meta.push(esc(c.school));
      if (teacherOn && c.teacher) meta.push(esc(c.teacher) + " 선생님");
      if (isDone) meta = ["응답 완료"];
      html += '<button type="button" role="listitem" class="course' + (isDone ? " done" : "") + '" data-id="' + esc(c.id) + '"' +
        (isDone ? ' aria-disabled="true"' : "") + ">" + typeIcon(c.course_type, isDone) +
        '<span class="c-body"><span class="c-name">' + esc(c.name) + "</span>" +
        '<span class="c-meta">' + meta.filter(Boolean).join('<i class="sep"></i>') + "</span></span>" +
        (isDone ? "" : ICON.chev) + "</button>";
    });
    list.innerHTML = html;
  }

  /* ---------- 2단계: 문항 응답 ---------- */
  function openForm(c) {
    state.course = c;
    state.answers = loadDraft(c.id);
    history.pushState({ step: "form" }, "");
    renderForm();
    window.scrollTo(0, 0);
  }

  function renderForm() {
    var c = state.course, qs = questions(), html = "", lastSection = null, no = 0;
    qs.forEach(function (q) {
      if (q.section && q.section !== lastSection) {
        html += '<div class="section-head"><span>' + esc(q.section) + "</span></div>";
        lastSection = q.section;
      }
      no++;
      var req = q.required ? '<span class="req">필수 응답</span>' : '<span class="opt-note">(선택)</span>';
      var head = '<span class="q-no">Q' + no + '</span><span class="q-t">' + esc(q.text) + req + "</span>";
      var v = state.answers[q.id];
      var cls = "q" + (isAnswered(q) ? " answered" : "");
      if (q.type === "likert") {
        html += '<div class="' + cls + '" id="q-' + esc(q.id) + '" data-q="' + esc(q.id) + '"><fieldset><legend>' + head + "</legend>" +
          '<div class="likert">' + [5, 4, 3, 2, 1].map(function (n) {
            return '<label><input type="radio" name="' + esc(q.id) + '" value="' + n + '"' + (v === n ? " checked" : "") + ">" +
              '<span class="opt"><span class="score">' + n + '</span><span class="lab">' + LABELS[n] + "</span></span></label>";
          }).join("") + "</div></fieldset></div>";
      } else if (q.type === "single" || q.type === "multi") {
        var multi = q.type === "multi";
        html += '<div class="' + cls + '" id="q-' + esc(q.id) + '" data-q="' + esc(q.id) + '"><fieldset><legend>' + head +
          (multi ? '<span class="opt-note">(복수 선택)</span>' : "") + "</legend>" +
          '<div class="choice">' + (q.options || []).map(function (o) {
            var on = multi ? Array.isArray(v) && v.indexOf(o) >= 0 : v === o;
            return '<label class="' + (on ? "on" : "") + '"><input type="' + (multi ? "checkbox" : "radio") + '" name="' + esc(q.id) +
              '" value="' + esc(o) + '"' + (on ? " checked" : "") + "><span>" + esc(o) + "</span></label>";
          }).join("") + "</div></fieldset></div>";
      } else if (q.type === "text") {
        var max = q.maxLength || 1000;
        html += '<div class="' + cls + '" id="q-' + esc(q.id) + '" data-q="' + esc(q.id) + '"><label for="t-' + esc(q.id) + '" class="q-text">' + head + "</label>" +
          '<textarea class="input" id="t-' + esc(q.id) + '" name="' + esc(q.id) + '" maxlength="' + max + '" placeholder="' + esc(q.placeholder || "") + '">' +
          esc(typeof v === "string" ? v : "") + '</textarea><div class="counter"><span>' + (typeof v === "string" ? v.length : 0) + "</span> / " + max + "</div></div>";
      }
    });

    app.innerHTML =
      '<div class="sticky"><div class="chosen">' + typeIcon(c.course_type) + '<div class="c-body"><div class="c-name">' + esc(c.name) + "</div>" +
        '<div class="c-meta">' + esc(c.school) + (c.course_type ? " · " + esc(c.course_type) : "") +
        (showTeacher() && c.teacher ? " · " + esc(c.teacher) + " 선생님" : "") + "</div></div>" +
        '<button type="button" class="btn sm" id="change">변경</button></div>' +
        '<div class="progress"><div class="bar"><i id="pbar"></i></div><span id="ptext"></span></div></div>' +
      '<div class="form-intro">' + stepper(2) + "<h2>수업은 어땠나요?</h2><p>문항마다 가장 가까운 점수를 골라 주세요.</p></div>" +
      '<form id="form" novalidate>' + html +
        '<div class="submit-bar"><button type="submit" class="btn primary xl" id="submit">응답 제출하기</button>' +
        '<p class="submit-note">제출한 뒤에는 수정할 수 없어요.</p></div>' +
      "</form>";

    document.getElementById("change").addEventListener("click", function () { history.back(); });
    var form = document.getElementById("form");
    form.addEventListener("change", onChange);
    form.addEventListener("input", onInput);
    form.addEventListener("submit", function (ev) { ev.preventDefault(); submit(); });
    updateProgress();
  }

  function markAnswered(q) {
    var box = document.getElementById("q-" + q.id);
    if (!box) return;
    box.classList.toggle("answered", isAnswered(q));
    if (isAnswered(q)) box.classList.remove("missing");
  }
  function onChange(ev) {
    var t = ev.target, qid = t.name;
    var q = questions().find(function (x) { return x.id === qid; });
    if (!q) return;
    if (q.type === "likert") state.answers[qid] = Number(t.value);
    else if (q.type === "single") state.answers[qid] = t.value;
    else if (q.type === "multi") {
      var arr = Array.prototype.map.call(document.querySelectorAll('input[name="' + CSS.escape(qid) + '"]:checked'), function (i) { return i.value; });
      state.answers[qid] = arr;
    } else return;
    if (q.type === "single" || q.type === "multi") {
      Array.prototype.forEach.call(document.querySelectorAll('input[name="' + CSS.escape(qid) + '"]'), function (i) {
        i.parentNode.classList.toggle("on", i.checked);
      });
    }
    markAnswered(q);
    saveDraft();
    updateProgress();
    if (q.type === "likert") autoAdvance(qid);
  }
  function onInput(ev) {
    var t = ev.target;
    if (t.tagName !== "TEXTAREA") return;
    state.answers[t.name] = t.value;
    var cnt = t.parentNode.querySelector(".counter span");
    if (cnt) cnt.textContent = t.value.length;
    var q = questions().find(function (x) { return x.id === t.name; });
    if (q) markAnswered(q);
    saveDraft();
    updateProgress();
  }
  function autoAdvance(qid) {
    var qs = questions(), i = qs.findIndex(function (q) { return q.id === qid; });
    var next = qs[i + 1];
    if (!next || next.type !== "likert" || isAnswered(next)) return;
    var el = document.getElementById("q-" + next.id);
    if (!el) return;
    setTimeout(function () {
      var r = el.getBoundingClientRect();
      if (r.top > window.innerHeight * 0.55) el.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 160);
  }
  function updateProgress() {
    var req = questions().filter(function (q) { return q.required; });
    var n = req.filter(isAnswered).length;
    var pct = req.length ? Math.round(n / req.length * 100) : 100;
    var bar = document.getElementById("pbar"), txt = document.getElementById("ptext");
    if (bar) bar.style.width = pct + "%";
    if (txt) txt.textContent = n + " / " + req.length;
    var sb = document.querySelector(".submit-bar");
    if (sb) sb.classList.toggle("ready", n === req.length);
  }

  function submit() {
    if (state.submitting) return;
    var qs = questions();
    var missing = qs.filter(function (q) { return q.required && !isAnswered(q); });
    Array.prototype.forEach.call(document.querySelectorAll(".q.missing"), function (e) { e.classList.remove("missing"); });
    if (missing.length) {
      var nums = missing.map(function (q) { return qs.indexOf(q) + 1; });
      missing.forEach(function (q) { var e = document.getElementById("q-" + q.id); if (e) e.classList.add("missing"); });
      toast("응답하지 않은 문항이 " + nums.length + "개 있어요 (Q" + nums.slice(0, 4).join(", Q") + (nums.length > 4 ? " …" : "") + ")", true);
      var first = document.getElementById("q-" + missing[0].id);
      if (first) first.scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }
    var payload = {};
    qs.forEach(function (q) {
      var v = state.answers[q.id];
      if (!isAnswered(q)) return;
      payload[q.id] = typeof v === "string" ? v.trim() : v;
    });
    var btn = document.getElementById("submit");
    state.submitting = true;
    btn.disabled = true;
    btn.textContent = "제출 중…";
    var c = state.course;
    api.submit(state.survey.id, c.id, payload, preventDup() ? deviceToken() : null).then(function () {
      if (preventDup()) markDone(c.id);
      clearDraft(c.id);
      renderDone(false);
    }).catch(function (e) {
      var info = J.errorInfo(e);
      if (info.code === "DUPLICATE") {
        markDone(c.id);
        clearDraft(c.id);
        renderDone(true);
        return;
      }
      toast(info.message, true);
      btn.disabled = false;
      btn.textContent = "응답 제출하기";
    }).then(function () { state.submitting = false; });
  }

  /* ---------- 3단계: 완료 ---------- */
  function renderDone(dup) {
    history.replaceState({ step: "done" }, "");
    var done = doneList();
    var doneCourses = state.courses.filter(function (c) { return done.indexOf(c.id) >= 0; });
    var remaining = state.courses.length - doneCourses.length;
    centerState("check", dup ? "이미 응답한 강좌예요" : "응답이 제출되었어요",
      dup ? "이 기기에서 이 강좌에 이미 응답했어요." : "소중한 의견 감사합니다.<br>다음 학기 공동교육과정 운영에 반영할게요.",
      (doneCourses.length ? '<ul class="done-list">' + doneCourses.map(function (c) {
        return "<li>" + ICON.done + "<span><b>" + esc(c.name) + "</b> · " + esc(c.school) + "</span></li>";
      }).join("") + "</ul>" : "") +
      '<div class="done-actions">' +
        (remaining > 0 ? '<button class="btn primary xl" id="more">다른 강좌도 응답하기</button>' : "") +
        '<p class="submit-note">공동교육과정을 2개 이상 수강했다면 강좌마다 응답해 주세요.<br>다 마쳤다면 창을 닫아도 됩니다.</p>' +
      "</div>", 3);
    var more = document.getElementById("more");
    if (more) more.addEventListener("click", function () { state.query = ""; renderCourseStep(); });
    window.scrollTo(0, 0);
  }

  init();
})();

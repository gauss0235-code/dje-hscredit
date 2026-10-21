/* =====================================================================
 *  데이터 계층 — Supabase(실서비스) / Demo(가상 데이터, ?demo) 두 가지 백엔드
 *  학생 화면은 supabase-js 없이 REST(fetch)만 사용해 가볍게 동작합니다.
 *  로그인 세션은 워크스페이스(login.html)와 같은 Supabase 기본 저장 키를 공유합니다.
 * ===================================================================== */
(function () {
  "use strict";
  var cfg = window.JCS_CONFIG || {};
  var params = new URLSearchParams(location.search);
  var notConfigured = !cfg.SUPABASE_URL || /YOUR-PROJECT/.test(cfg.SUPABASE_URL) ||
    !cfg.SUPABASE_ANON_KEY || /YOUR-ANON-KEY/.test(cfg.SUPABASE_ANON_KEY);
  // 데모(가상 데이터)는 내 컴퓨터(localhost·127.0.0.1·파일로 열기)에서만 허용 — 운영 사이트에서는 ?demo 무시
  var isLocal = location.protocol === "file:" || location.hostname === "localhost" || location.hostname === "127.0.0.1";
  var isDemo = isLocal && (params.has("demo") || notConfigured);
  // ?demo=admin|support|school (값이 없거나 그 외면 admin)
  var demoRole = null;
  if (isDemo) {
    demoRole = String(params.get("demo") || "").toLowerCase();
    if (["admin", "support", "school"].indexOf(demoRole) < 0) demoRole = "admin";
  }
  // 운영 사이트인데 설정이 비어 있으면 데모로 바꾸지 않고 오류 안내(admin.js가 #gate-view에 표시)
  var configError = notConfigured && !isLocal;

  /* ---------------- 공통 유틸 ---------------- */
  var ERRORS = {
    DUPLICATE: "이 기기에서 이미 이 강좌에 응답했어요.",
    SURVEY_CLOSED: "지금은 설문 기간이 아니에요.",
    SURVEY_NOT_FOUND: "설문을 찾을 수 없어요. QR코드를 다시 확인해 주세요.",
    COURSE_INVALID: "선택한 강좌를 찾을 수 없어요. 강좌를 다시 선택해 주세요.",
    REQUIRED_MISSING: "응답하지 않은 필수 문항이 있어요.",
    VALUE_INVALID: "응답 값이 올바르지 않아요.",
    ANSWERS_TOO_LARGE: "서술형 응답이 너무 길어요.",
    FORBIDDEN: "권한이 없어요. 관리자에게 문의하세요.",
    USER_NOT_FOUND: "해당 이메일의 계정이 없어요. Supabase Auth에서 먼저 사용자를 만들어 주세요.",
    ROLE_INVALID: "권한 값이 올바르지 않아요.",
    DEVICE_REQUIRED: "이 브라우저에서는 응답을 저장할 수 없어요. 다른 브라우저(크롬·삼성 인터넷)로 열어 주세요.",
    DEVICE_INVALID: "기기 정보가 올바르지 않아요. 페이지를 새로고침해 주세요.",
    CONFIG_MISSING: "결과 화면 설정(config.js)이 비어 있어요. 관리자에게 문의하세요."
  };
  function errorInfo(e) {
    var m = "";
    if (e) m = e.message || e.error_description || e.msg || e.error || String(e);
    var code = (m.match(/[A-Z_]{5,}/) || [])[0] || "";
    if (ERRORS[code]) return { code: code, message: ERRORS[code], raw: m };
    if (/Failed to fetch|NetworkError|Load failed|network/i.test(m)) {
      return { code: "NETWORK", message: "인터넷 연결을 확인한 뒤 다시 시도해 주세요.", raw: m };
    }
    if (/Invalid login credentials/i.test(m)) {
      return { code: "LOGIN", message: "이메일 또는 비밀번호가 올바르지 않아요.", raw: m };
    }
    return { code: code || "UNKNOWN", message: m || "알 수 없는 오류가 발생했어요.", raw: m };
  }
  function uid() {
    var a = new Uint8Array(12);
    (window.crypto || window.msCrypto).getRandomValues(a);
    return Array.prototype.map.call(a, function (b) { return ("0" + b.toString(16)).slice(-2); }).join("");
  }
  var store = {
    get: function (k, d) {
      try { var v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; }
    },
    set: function (k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* 저장 불가 환경 */ } }
  };
  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  // 인터넷 끊김·서버 일시 오류처럼 "다시 시도하면 될 수 있는" 인증 오류인지 (로그인 필요와 구분)
  function isTemporaryAuthError(e) {
    if (!e) return false;
    if (e.name === "AuthRetryableFetchError") return true;
    if (typeof e.status === "number" && (e.status === 0 || e.status === 429 || e.status >= 500)) return true;
    return /Failed to fetch|NetworkError|Load failed/i.test(e.message || "");
  }

  /* =====================================================================
   *  Supabase 백엔드
   * ===================================================================== */
  function SupabaseBackend() {
    var base = cfg.SUPABASE_URL.replace(/\/+$/, "");
    var key = cfg.SUPABASE_ANON_KEY;
    var sb = null;
    function client() {
      if (!sb) {
        if (!window.supabase || !window.supabase.createClient) throw new Error("supabase-js를 불러오지 못했어요.");
        // storageKey를 따로 지정하지 않아야 워크스페이스 로그인 세션을 그대로 씁니다.
        sb = window.supabase.createClient(base, key, { auth: { persistSession: true } });
      }
      return sb;
    }
    function rest(path, opts) {
      opts = opts || {};
      var headers = { apikey: key, Authorization: "Bearer " + key };
      if (opts.body) headers["Content-Type"] = "application/json";
      return fetch(base + "/rest/v1/" + path, {
        method: opts.method || "GET", headers: headers,
        body: opts.body ? JSON.stringify(opts.body) : undefined
      }).then(function (res) {
        return res.text().then(function (t) {
          var data = null;
          try { data = t ? JSON.parse(t) : null; } catch (e) { data = t; }
          if (!res.ok) throw new Error((data && data.message) || ("HTTP " + res.status));
          return data;
        });
      });
    }
    function must(r) { if (r.error) throw r.error; return r.data; }

    var api = {
      mode: "supabase",
      /* ----- 학생용 ----- */
      getSurvey: function (slug) {
        if (slug) {
          return rest("jcs_surveys?select=*&slug=eq." + encodeURIComponent(slug)).then(function (rows) {
            return rows && rows[0] || null;
          });
        }
        return rest("jcs_surveys?select=*&is_open=eq.true&order=created_at.desc&limit=1").then(function (rows) {
          if (rows && rows[0]) return rows[0];
          return rest("jcs_surveys?select=*&order=created_at.desc&limit=1").then(function (r2) { return r2 && r2[0] || null; });
        });
      },
      listPublicCourses: function (surveyId) {
        return rest("rpc/jcs_public_courses", { method: "POST", body: { p_survey: surveyId } });
      },
      submit: function (surveyId, courseId, answers, device) {
        return rest("rpc/jcs_submit_response", {
          method: "POST",
          body: { p_survey: surveyId, p_course: courseId, p_answers: answers, p_device: device || null }
        });
      },

      /* ----- 관리자용 ----- */
      getSession: function () {
        return client().auth.getSession().then(function (r) { return r.data && r.data.session || null; });
      },
      signIn: function (email, password) {
        return client().auth.signInWithPassword({ email: email, password: password }).then(must);
      },
      signOut: function () { return client().auth.signOut(); },
      /* 로그인 사용자 + 워크스페이스 profiles 행.
       * - 로그인 안 됨/세션 만료 → null (화면이 로그인 페이지로 보냄)
       * - 인터넷·서버 오류 → 예외 (화면이 오류 안내 + 다시 시도)
       * - profile이 null이면 워크스페이스 계정 정보가 없는 사용자 */
      getMe: function () {
        return client().auth.getUser().then(function (r) {
          if (r.error && isTemporaryAuthError(r.error)) throw r.error;
          var user = !r.error && r.data && r.data.user;
          if (!user) return null;
          return client().from("profiles").select("display_name, role, school_id, schools(name, code)")
            .eq("id", user.id).maybeSingle().then(function (p) {
              if (p.error) throw p.error;
              return { user: user, profile: p.data || null };
            });
        });
      },
      // 비밀번호 변경 직전 다시 확인하는 현재 사용자(이메일 포함). 못 가져오면 null
      currentUser: function () {
        return client().auth.getUser().then(function (r) {
          return !r.error && r.data && r.data.user || null;
        });
      },
      // 현재 비밀번호 확인: 별도 요청으로 검증해 지금 로그인 세션에는 영향을 주지 않음 (워크스페이스 dashboard.html과 같은 방식)
      verifyPassword: function (email, password) {
        return fetch(base + "/auth/v1/token?grant_type=password", {
          method: "POST",
          headers: { apikey: key, "Content-Type": "application/json" },
          body: JSON.stringify({ email: email, password: password })
        }).then(function (res) { return res.ok; });
      },
      changePassword: function (pw) { return client().auth.updateUser({ password: pw }).then(must); },
      listSurveys: function () {
        return client().from("jcs_surveys").select("*").order("created_at", { ascending: false }).then(must);
      },
      saveSurvey: function (s) {
        var row = {
          slug: s.slug, title: s.title, description: s.description || "", year: s.year || null,
          semester: s.semester || null, questions: s.questions || [], settings: s.settings || {},
          is_open: !!s.is_open, opens_at: s.opens_at || null, closes_at: s.closes_at || null
        };
        var q = s.id ? client().from("jcs_surveys").update(row).eq("id", s.id) : client().from("jcs_surveys").insert(row);
        return q.select().single().then(must);
      },
      // 응답 받기 시작·마감만 바꿈. 문항 등 다른 칸은 보내지 않아, 오래 열어 둔 화면이 바뀐 문항을 예전 것으로 덮어쓰지 않음
      setSurveyOpen: function (id, open) {
        return client().from("jcs_surveys").update({ is_open: !!open }).eq("id", id).select().single().then(must);
      },
      deleteSurvey: function (id) { return client().from("jcs_surveys").delete().eq("id", id).then(must); },
      listCourses: function (surveyId) {
        return client().from("jcs_courses").select("*").eq("survey_id", surveyId)
          .order("seq", { ascending: true, nullsFirst: false }).order("name").range(0, 4999).then(must);
      },
      saveCourse: function (c) {
        var row = {
          survey_id: c.survey_id, seq: c.seq == null || c.seq === "" ? null : Number(c.seq), school: c.school,
          course_type: c.course_type || "", name: c.name, grade: c.grade || "", credits: c.credits || "",
          category: c.category || "", teacher: c.teacher || "",
          enrolled: c.enrolled === "" || c.enrolled == null ? null : Number(c.enrolled),
          note: c.note || "", is_active: c.is_active !== false
        };
        var q = c.id ? client().from("jcs_courses").update(row).eq("id", c.id) : client().from("jcs_courses").insert(row);
        return q.select().single().then(must);
      },
      insertCourses: function (list) {
        var chunks = [];
        for (var i = 0; i < list.length; i += 300) chunks.push(list.slice(i, i + 300));
        return chunks.reduce(function (p, ch) {
          return p.then(function () { return client().from("jcs_courses").insert(ch).then(must); });
        }, Promise.resolve());
      },
      deleteCourse: function (id) { return client().from("jcs_courses").delete().eq("id", id).then(must); },
      deleteCourses: function (ids) {
        var chunks = [];
        for (var i = 0; i < ids.length; i += 200) chunks.push(ids.slice(i, i + 200));
        return chunks.reduce(function (p, ch) {
          return p.then(function () { return client().from("jcs_courses").delete().in("id", ch).then(must); });
        }, Promise.resolve());
      },
      deleteAllCourses: function (surveyId) {
        return client().from("jcs_courses").delete().eq("survey_id", surveyId).then(must);
      },
      fetchResponses: function (surveyId, onProgress) {
        // 서버의 최대 행 수 설정과 관계없이 빈 페이지가 나올 때까지 이어서 받음
        var all = [], size = 1000;
        function page(from) {
          return client().from("jcs_responses").select("id,course_id,answers,created_at")
            .eq("survey_id", surveyId).order("id").range(from, from + size - 1).then(function (r) {
              if (r.error) throw r.error;
              var rows = r.data || [];
              all = all.concat(rows);
              if (onProgress) onProgress(all.length);
              if (!rows.length) return all;
              return page(from + rows.length);
            });
        }
        return page(0);
      },
      deleteResponse: function (id) { return client().from("jcs_responses").delete().eq("id", id).then(must); },
      listMembers: function () { return client().from("jcs_members").select("*").order("created_at").then(must); },
      upsertMember: function (email, role, school) {
        return client().rpc("jcs_upsert_member", { p_email: email, p_role: role, p_school: school || null }).then(must);
      },
      deleteMember: function (userId) { return client().from("jcs_members").delete().eq("user_id", userId).then(must); },
      listAiReports: function (surveyId) {
        return client().from("jcs_ai_reports").select("*").eq("survey_id", surveyId)
          .order("created_at", { ascending: false }).limit(200).then(must);
      },
      deleteAiReport: function (id) { return client().from("jcs_ai_reports").delete().eq("id", id).then(must); },
      generateAiReport: function (body) {
        return client().functions.invoke(cfg.AI_FUNCTION_NAME || "jcs-ai-summary", { body: body }).then(function (r) {
          if (!r.error) return r.data;
          var ctx = r.error.context;
          if (ctx && typeof ctx.json === "function") {
            return ctx.json().then(function (j) { throw new Error(j && j.error || r.error.message); },
              function () { throw r.error; });
          }
          throw r.error;
        });
      }
    };
    return api;
  }

  /* =====================================================================
   *  설정 없음 백엔드 — 운영 사이트에서 config.js가 비어 있을 때. 모든 호출이 CONFIG_MISSING 오류.
   * ===================================================================== */
  function UnconfiguredBackend() {
    var names = ["getSurvey", "listPublicCourses", "submit", "getSession", "signIn", "signOut", "getMe", "currentUser",
      "verifyPassword", "changePassword", "listSurveys", "saveSurvey", "setSurveyOpen", "deleteSurvey", "listCourses", "saveCourse",
      "insertCourses", "deleteCourse", "deleteCourses", "deleteAllCourses", "fetchResponses", "deleteResponse",
      "listMembers", "upsertMember", "deleteMember", "listAiReports", "deleteAiReport", "generateAiReport"];
    var api = { mode: "unconfigured" };
    names.forEach(function (n) {
      api[n] = function () { return Promise.reject(new Error("CONFIG_MISSING")); };
    });
    return api;
  }

  /* =====================================================================
   *  Demo 백엔드 — 가상 학교·강좌·응답으로 화면을 미리 볼 수 있습니다.
   *  role: "admin" | "support" | "school" — school이면 DB 권한(RLS)처럼 그 학교 강좌만 돌려줍니다.
   * ===================================================================== */
  function DemoBackend(role) {
    role = role || "admin";
    var seed = 20261021;
    function rnd() { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; }
    function pick(a) { return a[Math.floor(rnd() * a.length)]; }
    function gauss() { var u = rnd() || 1e-9, v = rnd(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); }

    var schools = ["가온고", "나래고", "다솜고", "라온고", "마루고", "바름고", "새봄고", "아라고", "자람고", "하늬고", "한결고", "해밀여고"];
    var subjects = [
      ["고급 미적분", "진로선택"], ["이산 수학", "진로선택"], ["인공지능 수학", "진로선택"], ["경제 수학", "진로선택"],
      ["물리학 실험", "융합선택"], ["화학 실험", "융합선택"], ["생명과학 실험", "융합선택"], ["고급 물리학", "진로선택"],
      ["국제 관계의 이해", "진로선택"], ["심리학", "진로선택"], ["교육의 이해", "진로선택"], ["인간과 철학", "진로선택"],
      ["문학과 영상", "진로선택"], ["음악 공연 실습", "진로선택"], ["미술 창작", "진로선택"], ["스포츠 생활", "진로선택"],
      ["프로그래밍", "진로선택"], ["데이터 과학", "융합선택"], ["창의공학설계", "융합선택"], ["사회문제 탐구", "융합선택"],
      ["한문 고전 읽기", "진로선택"], ["중국어 회화", "진로선택"], ["일본어 회화", "진로선택"], ["과학과제 연구", "진로선택"]
    ];
    var careerTypes = ["의학 진로 탐색 프로젝트", "공학 진로 체험", "미디어 콘텐츠 제작 체험", "법과 정치 진로 탐색"];
    var family = "김이박최정강조윤장임한오서신권황안송류홍";

    var surveyId = "demo-survey-2026-2";
    var survey = {
      id: surveyId, slug: "2026-2", title: "2026학년도 2학기 공동교육과정 만족도 조사",
      description: "수강한 공동교육과정 강좌에 대한 만족도 조사입니다. 응답은 익명으로 처리되며, 다음 학기 운영 개선에 활용됩니다.",
      year: 2026, semester: 2, questions: JSON.parse(JSON.stringify(window.JCS_DEFAULT_QUESTIONS || [])),
      settings: { preventDuplicate: true, showTeacher: true }, is_open: true, opens_at: null, closes_at: null,
      created_at: new Date(Date.now() - 20 * 864e5).toISOString()
    };

    var courses = [], seq = 0;
    schools.forEach(function (sc) {
      var n = 2 + Math.floor(rnd() * 4);
      var used = {};
      for (var i = 0; i < n; i++) {
        var s = pick(subjects); if (used[s[0]]) continue; used[s[0]] = 1;
        seq++;
        courses.push({
          id: "c" + seq, survey_id: surveyId, seq: seq, school: sc, course_type: rnd() < 0.15 ? "온라인" : "오프라인",
          name: s[0], grade: pick(["2", "1·2", "2"]), credits: pick(["2", "3", "3"]), category: s[1],
          teacher: family.charAt(Math.floor(rnd() * family.length)) + "○○", enrolled: 7 + Math.floor(rnd() * 14),
          note: "", is_active: true
        });
      }
    });
    careerTypes.forEach(function (nm) {
      seq++;
      courses.push({
        id: "c" + seq, survey_id: surveyId, seq: seq, school: pick(schools), course_type: "진로선택형", name: nm,
        grade: "1·2", credits: "24시수", category: "해당없음", teacher: family.charAt(Math.floor(rnd() * family.length)) + "○○",
        enrolled: 12 + Math.floor(rnd() * 10), note: "", is_active: true
      });
    });

    var goodPool = [
      "실험을 직접 해 볼 수 있어서 개념이 훨씬 잘 이해됐어요.", "학교에 없는 과목을 들을 수 있어서 좋았습니다.",
      "선생님께서 질문에 친절하게 답해 주셔서 편하게 물어볼 수 있었어요.", "다른 학교 친구들과 토론하면서 생각이 넓어졌어요.",
      "진로와 관련된 내용을 깊이 배울 수 있었습니다.", "수업 자료가 체계적이라 복습하기 좋았어요.",
      "프로젝트 활동이 재미있었고 결과물을 만들어서 뿌듯했어요.", "소수 인원이라 집중이 잘 됐어요.",
      "대학 전공 공부를 미리 맛볼 수 있어서 유익했어요.", "선생님 설명이 쉽고 예시가 많아서 좋았어요.",
      "온라인이라 이동 부담 없이 들을 수 있었어요.", "평가 기준을 처음에 자세히 알려 주셔서 준비하기 편했어요."
    ];
    var improvePool = [
      "수업이 늦게 끝나서 귀가 시간이 너무 늦어요.", "거점학교까지 이동 시간이 길어서 힘들었어요.",
      "수업 시간이 조금 더 길었으면 좋겠어요.", "평가 일정을 더 미리 알려 주시면 좋겠어요.",
      "온라인 수업 때 접속이 자주 끊겼어요.", "실습 기자재가 부족해서 기다리는 시간이 있었어요.",
      "과제 양이 학교 시험 기간과 겹쳐서 부담됐어요.", "교실이 좁고 더웠어요.",
      "출결 안내가 늦게 와서 헷갈렸어요.", "다음에는 심화 내용도 다뤄 주시면 좋겠어요.",
      "저녁 시간에 간식이나 쉬는 시간이 있으면 좋겠어요.", "수업 진도가 조금 빨랐어요."
    ];

    var responses = [], rid = 0, now = Date.now();
    var itemBias = { q1: 0, q2: 0.05, q3: 0.1, q4: 0, q5: 0.15, q6: -0.35, q7: -0.2, q8: 0.25, q9: 0, q10: -0.05 };
    courses.forEach(function (c) {
      var quality = 4.25 + gauss() * 0.4;
      if (rnd() < 0.08) quality -= 1.0;
      var rate = 0.35 + rnd() * 0.65;
      var n = Math.round(c.enrolled * rate);
      for (var i = 0; i < n; i++) {
        var person = gauss() * 0.45, a = {};
        Object.keys(itemBias).forEach(function (q) {
          var bias = itemBias[q] + (c.course_type === "온라인" && q === "q6" ? 0.25 : 0);
          var v = Math.round(quality + person + bias + gauss() * 0.45);
          a[q] = Math.max(1, Math.min(5, v));
        });
        // 서술형은 한 문항(opinion, 필수)에 좋았던 점과 개선할 점을 함께 씀
        var parts = [];
        if (rnd() < 0.7) parts.push(pick(goodPool));
        if (!parts.length || rnd() < (quality < 3.8 ? 0.6 : 0.3)) parts.push((parts.length ? "다만 " : "") + pick(improvePool));
        a.opinion = parts.join(" ");
        rid++;
        var day = Math.floor(Math.pow(rnd(), 1.6) * 10);
        responses.push({
          id: rid, course_id: c.id, answers: a,
          created_at: new Date(now - day * 864e5 - Math.floor(rnd() * 8) * 36e5).toISOString()
        });
      }
    });

    // 학교 담당자 데모: 강좌가 가장 많은 학교를 "우리 학교"로 삼음
    var demoSchool = null;
    if (role === "school") {
      var cnt = {};
      courses.forEach(function (c) { cnt[c.school] = (cnt[c.school] || 0) + 1; });
      schools.forEach(function (sc) { if (cnt[sc] && (!demoSchool || cnt[sc] > cnt[demoSchool])) demoSchool = sc; });
    }
    var DEMO_PROFILES = {
      admin: { display_name: "데모 관리자", role: "admin", school_id: null, schools: null },
      support: { display_name: "데모 지원단", role: "support", school_id: null, schools: null },
      school: { display_name: "데모 담당자", role: "school", school_id: 9001, schools: { name: demoSchool, code: "DEMO01" } }
    };
    var demoUser = { id: "demo-" + role, email: "demo-" + role + "@example.kr" };
    // DB 권한(RLS) 흉내: 학교 담당자는 우리 학교 강좌·응답·AI 분석만
    function canSeeCourse(c) { return role !== "school" || (c && c.school === demoSchool); }
    function visibleCourseIds(sid) {
      var ids = {};
      courses.forEach(function (c) { if (c.survey_id === sid && canSeeCourse(c)) ids[c.id] = 1; });
      return ids;
    }
    function canSeeReport(r, ids) {
      if (role !== "school") return true;
      if (r.scope === "course") return !!ids[r.course_id];
      if (r.scope === "school") return r.school === demoSchool;
      return false;
    }

    var aiReports = [];
    var members = [{ user_id: demoUser.id, email: demoUser.email, role: role, school: demoSchool, created_at: survey.created_at }];
    var surveys = [survey];
    function clone(x) { return JSON.parse(JSON.stringify(x)); }
    function later(v, ms) { return sleep(ms == null ? 120 : ms).then(function () { return clone(v); }); }

    function demoAi(body) {
      var cs = courses.filter(function (c) {
        if (body.scope === "course") return c.id === body.course_id;
        if (body.scope === "school") return c.school === body.school;
        return true;
      });
      var ids = {}; cs.forEach(function (c) { ids[c.id] = 1; });
      var rs = responses.filter(function (r) { return ids[r.course_id]; });
      function tally(pool) {
        return pool.map(function (t) {
          return { t: t, n: rs.filter(function (r) { return String(r.answers.opinion || "").indexOf(t) >= 0; }).length };
        }).filter(function (x) { return x.n; }).sort(function (a, b) { return b.n - a.n; });
      }
      var g = tally(goodPool), im = tally(improvePool);
      var content = {
        overview: "(데모 예시) 학생들은 소속 학교에 없는 과목을 수강하고 실험·프로젝트 중심으로 배우는 점을 가장 높게 평가했습니다. " +
          "반면 늦은 종료 시각과 이동 부담, 수업 환경(공간·기자재)에 대한 개선 요구가 반복적으로 나타났습니다.",
        strengths: g.slice(0, 4).map(function (x) { return { point: x.t.replace(/[.!]$/, ""), count: x.n }; }),
        improvements: im.slice(0, 4).map(function (x) { return { point: x.t.replace(/[.!]$/, ""), count: x.n }; }),
        suggestions: [
          "오프라인 강좌의 종료 시각과 귀가 안전 대책을 학기 초에 안내하고, 늦게 끝나는 강좌는 시간표 조정을 검토",
          "실습 강좌의 기자재 확보 현황을 개강 전에 점검",
          "평가 일정·출결 기준을 첫 시간에 문서로 안내"
        ],
        report_opinions: g.slice(0, 3).map(function (x) { return x.t; }),
        report_requests: im.slice(0, 3).map(function (x) { return x.t; }),
        attention: body.scope === "course" ? [] : [{ target: cs[0] ? cs[0].school + " " + cs[0].name : "-", reason: "(데모) 수업 환경 관련 의견이 많음" }]
      };
      var rep = {
        id: aiReports.length + 1, survey_id: surveyId, scope: body.scope, school: body.school || null,
        course_id: body.course_id || null, response_count: rs.length, model: "demo", content: content,
        created_at: new Date().toISOString()
      };
      aiReports.unshift(rep);
      return rep;
    }

    return {
      mode: "demo",
      getSurvey: function () { return later(surveys[0]); },
      listPublicCourses: function (sid) {
        return later(courses.filter(function (c) { return c.survey_id === sid && c.is_active; }));
      },
      submit: function (sid, cid, answers) {
        rid++;
        responses.push({ id: rid, course_id: cid, answers: clone(answers), created_at: new Date().toISOString() });
        return later({ ok: true, id: rid }, 400);
      },
      getSession: function () { return later({ demo: true }); },
      signIn: function () { return later({ demo: true }); },
      signOut: function () { return later(null); },
      getMe: function () { return later({ user: demoUser, profile: DEMO_PROFILES[role] || DEMO_PROFILES.admin }); },
      currentUser: function () { return later(demoUser); },
      verifyPassword: function () { return later(true, 300); },
      changePassword: function () { return later(null); },
      listSurveys: function () { return later(surveys); },
      saveSurvey: function (s) {
        if (s.id) {
          var i = surveys.findIndex(function (x) { return x.id === s.id; });
          surveys[i] = Object.assign({}, surveys[i], clone(s));
          return later(surveys[i]);
        }
        var n = Object.assign({ id: "demo-" + uid(), created_at: new Date().toISOString() }, clone(s));
        surveys.unshift(n);
        return later(n);
      },
      setSurveyOpen: function (id, open) {
        var i = surveys.findIndex(function (x) { return x.id === id; });
        surveys[i] = Object.assign({}, surveys[i], { is_open: !!open });
        return later(surveys[i]);
      },
      deleteSurvey: function (id) { surveys = surveys.filter(function (x) { return x.id !== id; }); return later(null); },
      listCourses: function (sid) { return later(courses.filter(function (c) { return c.survey_id === sid && canSeeCourse(c); })); },
      saveCourse: function (c) {
        if (c.id) {
          var i = courses.findIndex(function (x) { return x.id === c.id; });
          courses[i] = Object.assign({}, courses[i], clone(c));
          return later(courses[i]);
        }
        var n = Object.assign({ id: "c" + uid() }, clone(c));
        courses.push(n);
        return later(n);
      },
      insertCourses: function (list) {
        list.forEach(function (c) { courses.push(Object.assign({ id: "c" + uid(), is_active: true }, clone(c))); });
        return later(null);
      },
      deleteCourse: function (id) {
        courses = courses.filter(function (c) { return c.id !== id; });
        responses = responses.filter(function (r) { return r.course_id !== id; });
        return later(null);
      },
      deleteCourses: function (list) {
        var ids = {};
        list.forEach(function (id) { ids[id] = 1; });
        courses = courses.filter(function (c) { return !ids[c.id]; });
        responses = responses.filter(function (r) { return !ids[r.course_id]; });
        return later(null);
      },
      deleteAllCourses: function (sid) {
        var ids = {};
        courses.forEach(function (c) { if (c.survey_id === sid) ids[c.id] = 1; });
        courses = courses.filter(function (c) { return !ids[c.id]; });
        responses = responses.filter(function (r) { return !ids[r.course_id]; });
        return later(null);
      },
      fetchResponses: function (sid) {
        var ids = visibleCourseIds(sid);
        return later(responses.filter(function (r) { return ids[r.course_id]; }), 300);
      },
      deleteResponse: function (id) { responses = responses.filter(function (r) { return r.id !== id; }); return later(null); },
      listMembers: function () { return later(members); },
      upsertMember: function (email, role, school) {
        var m = members.find(function (x) { return x.email === email; });
        if (m) { m.role = role; m.school = school || null; } else {
          members.push({ user_id: "u" + uid(), email: email, role: role, school: school || null, created_at: new Date().toISOString() });
        }
        return later({ ok: true });
      },
      deleteMember: function (id) { members = members.filter(function (m) { return m.user_id !== id; }); return later(null); },
      listAiReports: function (sid) {
        var ids = visibleCourseIds(sid);
        return later(aiReports.filter(function (r) { return r.survey_id === sid && canSeeReport(r, ids); }));
      },
      deleteAiReport: function (id) { aiReports = aiReports.filter(function (r) { return r.id !== id; }); return later(null); },
      generateAiReport: function (body) { return later(demoAi(body), 1500); }
    };
  }

  window.JCS = {
    cfg: cfg,
    isDemo: isDemo,
    demoRole: demoRole,
    isLocal: isLocal,
    notConfigured: notConfigured,
    configError: configError,
    api: configError ? UnconfiguredBackend() : isDemo ? DemoBackend(demoRole) : SupabaseBackend(),
    errorInfo: errorInfo,
    uid: uid,
    store: store
  };
})();

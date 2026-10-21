#!/usr/bin/env python3
"""설문별 공유 페이지 만들기 — 카카오톡 등 링크 미리보기에 설문 제목이 뜨게 함

링크 미리보기 봇은 자바스크립트를 실행하지 않고 HTML의 <title>·og:title만 읽는다.
그래서 survey/index.html을 틀로 삼아 Supabase에 있는 설문마다
survey/<주소용 코드>/index.html 을 만들고, 그 안의 제목·og 태그를 설문 제목으로 바꿔 둔다.
화면과 동작은 survey/index.html과 같고, 설문 코드는 window.JCS_SLUG로 넘긴다.

- 이 스크립트가 만든 페이지(맨 위 MARK 표시)만 고치거나 지운다. 지워진 설문의 페이지는 지움.
- GitHub Actions(.github/workflows/survey-share-pages.yml)가 정기적으로 실행해 바뀐 것만 커밋한다.
- 내 컴퓨터에서 실행:  python tools/survey_share_pages.py
  (학교망처럼 파이썬이 HTTPS 인증서를 못 믿는 곳에서는 설문 목록을 따로 받아 넘김:
   python tools/survey_share_pages.py --json 설문목록.json   ← [{"slug": "...", "title": "..."}, ...])
"""
import html
import json
import os
import re
import shutil
import sys
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SURVEY_DIR = os.path.join(ROOT, "survey")
MARK = "<!-- 자동 생성: tools/survey_share_pages.py 가 만든 설문별 공유 페이지입니다. 직접 고치지 말고 survey/index.html을 고치세요. -->"
SLUG_RE = re.compile(r"^[a-z0-9-]{2,40}$")
OG_RE = re.compile(r"<!-- og:start.*?<!-- og:end -->", re.S)
DESC = "대전광역시교육청 공동교육과정 수강 학생 만족도 조사입니다. 익명으로 약 2분이면 참여할 수 있어요."
IMAGE = "assets/img/og-survey.png?v=2"   # 카카오 권장 2:1(1200x600). 그림을 바꾸면 v를 올려 미리보기 캐시를 피함


def read(path):
    with open(path, encoding="utf-8") as f:
        return f.read()


def config():
    """학생 설문 화면 설정(survey/assets/config.js)에서 Supabase 주소·공개 키·설문 주소를 읽음"""
    js = read(os.path.join(SURVEY_DIR, "assets", "config.js"))

    def get(name):
        m = re.search(name + r'\s*:\s*"([^"]+)"', js)
        if not m:
            sys.exit("config.js에서 %s 값을 찾지 못했어요." % name)
        return m.group(1)

    base_url = get("SURVEY_BASE_URL")
    if not base_url.endswith("/"):
        base_url += "/"
    return get("SUPABASE_URL").rstrip("/"), get("SUPABASE_ANON_KEY"), base_url


def fetch_surveys(api_base, key):
    req = urllib.request.Request(
        api_base + "/rest/v1/jcs_surveys?select=slug,title&order=created_at.asc",
        # 새 publishable 키는 apikey 헤더로만 보냄(Supabase 문서). 설문 목록은 로그인 없이 읽을 수 있는 공개 정보
        headers={"apikey": key, "Accept": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=30) as res:
        data = json.load(res)
    if not isinstance(data, list):
        sys.exit("설문 목록 형식이 이상해요: %r" % (data,))
    return data


def og_block(title, page_url, base_url):
    e = lambda s: html.escape(s, quote=True)
    return "\n  ".join([
        "<!-- og:start  설문별 공유 페이지 -->",
        '<meta name="description" content="%s">' % e(DESC),
        '<meta property="og:type" content="website">',
        '<meta property="og:site_name" content="대전광역시교육청 공동교육과정">',
        '<meta property="og:locale" content="ko_KR">',
        '<meta property="og:title" content="%s">' % e(title),
        '<meta property="og:description" content="%s">' % e(DESC),
        '<meta property="og:url" content="%s">' % e(page_url),
        '<meta property="og:image" content="%s">' % e(base_url + IMAGE),
        '<meta property="og:image:width" content="1200">',
        '<meta property="og:image:height" content="600">',
        '<meta property="og:image:alt" content="%s">' % e(title),
        '<meta name="twitter:card" content="summary_large_image">',
        "<!-- og:end -->",
    ])


def build_page(tpl, slug, title, base_url):
    """survey/index.html(틀)에서 설문 하나의 공유 페이지를 만듦. 틀 모양이 바뀌어 못 바꾸면 멈춤"""
    out, steps = tpl, []

    def sub(pattern, repl, flags=0):
        nonlocal out
        new, n = re.subn(pattern, lambda m: repl, out, count=1, flags=flags)
        steps.append(n)
        out = new

    # 이 페이지는 /survey/<코드>/에 있으므로, assets/… 같은 상대 주소를 /survey/ 기준으로 풀게 함
    sub(r'(<meta charset="utf-8">)', '<meta charset="utf-8">\n  <base href="/survey/">')
    sub(r"<title>.*?</title>", "<title>%s</title>" % html.escape(title), re.S)
    sub(OG_RE.pattern, og_block(title, base_url + slug + "/", base_url), re.S)
    sub(r'(<script src="assets/config\.js)', '<script>window.JCS_SLUG = %s;</script>\n  <script src="assets/config.js'
        % json.dumps(slug))
    sub(r"(<!doctype html>)", "<!doctype html>\n" + MARK, re.I)
    if not all(steps):
        sys.exit("survey/index.html의 모양이 예상과 달라 공유 페이지를 만들지 못했어요. (바꾼 곳 %s)" % steps)
    return out


def is_generated(folder):
    try:
        return MARK in read(os.path.join(folder, "index.html"))[:1000]
    except OSError:
        return False


def main():
    api_base, key, base_url = config()
    tpl = read(os.path.join(SURVEY_DIR, "index.html"))
    if "JCS_SLUG" not in read(os.path.join(SURVEY_DIR, "assets", "survey.js")):
        sys.exit("survey.js가 window.JCS_SLUG를 읽지 않아요. 공유 페이지가 설문을 못 찾으니 멈춥니다.")
    if len(sys.argv) == 3 and sys.argv[1] == "--json":
        with open(sys.argv[2], encoding="utf-8-sig") as f:
            surveys = json.load(f)
        if not isinstance(surveys, list):
            sys.exit("--json 파일은 설문 목록(배열)이어야 해요.")
    else:
        surveys = fetch_surveys(api_base, key)

    pages = {}
    for s in surveys:
        slug = str(s.get("slug") or "")
        title = " ".join(str(s.get("title") or "").split()) or "공동교육과정 만족도 조사"
        folder = os.path.join(SURVEY_DIR, slug)
        if not SLUG_RE.match(slug):
            print("건너뜀(주소용 코드 형식이 아님):", slug)
            continue
        if os.path.exists(folder) and not is_generated(folder):
            print("건너뜀(같은 이름의 폴더가 이미 있음, 예: assets):", slug)
            continue
        pages[slug] = build_page(tpl, slug, title, base_url)

    changed = 0
    for slug, page in pages.items():
        path = os.path.join(SURVEY_DIR, slug, "index.html")
        if os.path.exists(path) and read(path) == page:
            continue
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "w", encoding="utf-8", newline="\n") as f:
            f.write(page)
        changed += 1
        print("만듦·고침:", slug)

    # 없어진 설문의 페이지 지우기. 설문 목록이 비어 오면(권한 문제 등) 아무것도 지우지 않음
    if surveys:
        for name in sorted(os.listdir(SURVEY_DIR)):
            folder = os.path.join(SURVEY_DIR, name)
            if name in pages or not os.path.isdir(folder) or not is_generated(folder):
                continue
            shutil.rmtree(folder)
            changed += 1
            print("지움(없어진 설문):", name)
    else:
        print("설문 목록이 비어 있어 기존 페이지는 그대로 둡니다.")

    print("설문 %d개 · 바뀐 페이지 %d개" % (len(pages), changed))


if __name__ == "__main__":
    main()

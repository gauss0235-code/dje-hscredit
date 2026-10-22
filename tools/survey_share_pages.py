#!/usr/bin/env python3
"""설문별 공유 페이지·미리보기 이미지 만들기 — 카카오톡 등 링크 미리보기에 설문 제목이 뜨게 함

링크 미리보기 봇은 자바스크립트를 실행하지 않고 HTML의 <title>·og 태그만 읽는다.
그래서 survey/index.html을 틀로 삼아 Supabase에 있는 설문마다
survey/<주소용 코드>/index.html 을 만들고, 그 안의 제목·og 태그를 설문 제목으로 바꿔 둔다.
화면과 동작은 survey/index.html과 같고, 설문 코드는 window.JCS_SLUG로 넘긴다.

- 미리보기 이미지: tools/og_card.html 틀에 '2026학년도 2학기'(작게)·'공동교육과정 만족도 조사'(크게)를 넣어
  헤드리스 브라우저(크롬·엣지)로 찍어 survey/<코드>/og-<글자 해시>.png 로 저장. 글자가 같으면 다시 찍지 않음.
  브라우저가 없거나 실패하면 공용 이미지(survey/assets/img/og-survey.png)를 씀.
- 기본 주소(survey/index.html, …/survey/?s=코드)의 og 태그·<title>·머리 제목은 학생 화면이 기본으로 여는 설문
  (응답 받는 중인 최신 설문, 없으면 최신 설문)의 것으로 바꿔 둔다.
- 머리 제목·칩(<!-- hero:start --> … <!-- hero:end -->)을 미리 채워, 화면이 열리자마자 '2026학년도 2학기 /
  공동교육과정 만족도 조사'가 보이게 함(설문 정보를 받아 오기 전 임시 글자가 깜빡이지 않게).
- survey/assets/share-stamp.txt: 만든 결과의 지문. GitHub Actions가 실제 사이트의 것과 비교해 배포를 확인함.
- 이 스크립트가 만든 페이지(맨 위 MARK 표시)만 고치거나 지운다. 지워진 설문의 페이지는 지움.
- GitHub Actions(.github/workflows/survey-share-pages.yml)가 정기적으로 실행해 바뀐 것만 커밋한다.
- 내 컴퓨터에서 실행:  python tools/survey_share_pages.py
  (학교망처럼 파이썬이 HTTPS 인증서를 못 믿는 곳에서는 설문 목록을 따로 받아 넘김:
   python tools/survey_share_pages.py --json 설문목록.json
   ← [{"slug", "title", "year", "semester", "is_open", "created_at", "questions"}, ...] created_at 오름차순)
- 공용 이미지 다시 그리기:  python tools/survey_share_pages.py --generic-image
"""
import base64
import hashlib
import html
import json
import os
import re
import shutil
import struct
import subprocess
import sys
import tempfile
import urllib.request
from pathlib import Path

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SURVEY_DIR = os.path.join(ROOT, "survey")
CARD_TPL = os.path.join(ROOT, "tools", "og_card.html")
FONT_DIR = os.path.join(SURVEY_DIR, "assets", "fonts")
MARK = "<!-- 자동 생성: tools/survey_share_pages.py 가 만든 설문별 공유 페이지입니다. 직접 고치지 말고 survey/index.html을 고치세요. -->"
SLUG_RE = re.compile(r"^[a-z0-9-]{2,40}$")
OG_RE = re.compile(r"<!-- og:start.*?<!-- og:end -->", re.S)
HERO_RE = re.compile(r"<!-- hero:start.*?<!-- hero:end -->", re.S)
OG_FILE_RE = re.compile(r"^og-[0-9a-f]{10}\.png$")
RESERVED = {"assets"}   # survey/ 안에 이미 있는 폴더 이름. 관리자 화면도 이 코드는 막음
_RENDER_BROKEN = False  # 이번 실행에서 한 번 찍기에 실패하면 나머지는 바로 공용 이미지(작업 시간 초과 방지)
# 학생 화면 머리의 칩(survey.js setHero와 같은 모양) — 페이지에 미리 넣어 두면 화면이 열리자마자 보임
_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">%s</svg>'
CHIP_ICON = {
    "lock": _SVG % '<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
    "clock": _SVG % '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    "list": _SVG % '<path d="M9 6h11M9 12h11M9 18h11M4 6h.01M4 12h.01M4 18h.01"/>',
}
DEFAULT_TITLE = "공동교육과정 만족도 조사"
DESC = "대전광역시교육청 공동교육과정 수강 학생 만족도 조사입니다. 익명으로 약 2분이면 참여할 수 있어요."
GENERIC_IMAGE = "assets/img/og-survey.png?v=3"   # 공용 이미지(1200x600, 카카오 권장 2:1). 그림을 바꾸면 v를 올림
CARD_VERSION = "1"   # og_card.html 디자인을 바꾸면 올림 → 모든 설문 이미지를 다시 찍음
CARD_SIZE = (1200, 600)


def read(path):
    with open(path, encoding="utf-8") as f:
        return f.read()


def write(path, text):
    with open(path, "w", encoding="utf-8", newline="\n") as f:
        f.write(text)


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
        api_base + "/rest/v1/jcs_surveys?select=slug,title,year,semester,is_open,created_at,questions&order=created_at.asc",
        # 새 publishable 키는 apikey 헤더로만 보냄(Supabase 문서). 설문 목록은 로그인 없이 읽을 수 있는 공개 정보
        headers={"apikey": key, "Accept": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=30) as res:
        data = json.load(res)
    if not isinstance(data, list):
        sys.exit("설문 목록 형식이 이상해요: %r" % (data,))
    return data


def clean_title(s):
    return " ".join(str(s.get("title") or "").split()) or DEFAULT_TITLE


def split_title(s):
    """'2026학년도 2학기 공동교육과정 만족도 조사' → ('2026학년도 2학기', '공동교육과정 만족도 조사')"""
    title = clean_title(s)
    m = re.match(r"^(.*?학기)\s+(.+)$", title)
    if m:
        return m.group(1), m.group(2)
    if s.get("year") and s.get("semester"):
        return "%s학년도 %s학기" % (s["year"], s["semester"]), title
    return "", title


def hero_block(s):
    """학생 화면 머리의 제목·칩을 survey.js setHero와 똑같이 미리 만듦(설문 정보가 오기 전 '깜빡임' 방지)"""
    e = html.escape
    if s is None:
        title_html = '<span class="t-main">%s</span>' % e(DEFAULT_TITLE)
        chips = ""
    else:
        t = str(s.get("title") or "만족도 조사")
        m = re.match(r"^(.*?학기)\s+(.+)$", t, re.S)
        title_html = ('<span class="t-term">%s</span><span class="t-main">%s</span>' % (e(m.group(1)), e(m.group(2)))
                      if m else '<span class="t-main">%s</span>' % e(t))
        qs = s.get("questions") if isinstance(s.get("questions"), list) else None
        chips = ('<span class="hero-chip">%s익명 응답</span><span class="hero-chip">%s약 2분</span>' % (CHIP_ICON["lock"], CHIP_ICON["clock"]))
        if qs is not None:
            n = sum(1 for q in qs if isinstance(q, dict) and q.get("id") and q.get("type") != "section")
            chips += '<span class="hero-chip">%s%d문항</span>' % (CHIP_ICON["list"], n)
        else:
            chips = ""   # 문항 수를 모르면 칩은 화면에서 채우게 비워 둠
    return "\n      ".join([
        "<!-- hero:start  설문 제목·칩. tools/survey_share_pages.py가 설문 정보로 미리 채움(화면이 열리자마자 제목이 보이게) -->",
        '<h1 class="hero-title" id="survey-title">%s</h1>' % title_html,
        '<div class="hero-chips" id="hero-chips">%s</div>' % chips,
        "<!-- hero:end -->",
    ])


def current_survey(surveys):
    """학생 화면이 ?s= 없이 열 때와 같은 설문: 응답 받는 중인 최신 설문, 없으면 최신 설문 (api.js getSurvey)"""
    newest = sorted(surveys, key=lambda s: str(s.get("created_at") or ""), reverse=True)
    for s in newest:
        if s.get("is_open"):
            return s
    return newest[0] if newest else None


# ---------- 미리보기 이미지 ----------
def find_browser():
    cands = [os.environ.get("CHROME_PATH", "")]
    cands += [shutil.which(n) or "" for n in ("google-chrome", "google-chrome-stable", "chromium", "chromium-browser", "msedge")]
    cands += [
        r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
        r"C:\Program Files\Microsoft\Edge\Application\msedge.exe",
        r"C:\Program Files\Google\Chrome\Application\chrome.exe",
    ]
    return next((c for c in cands if c and os.path.isfile(c)), None)


def png_size(path):
    try:
        with open(path, "rb") as f:
            head = f.read(24)
        if head[:8] != b"\x89PNG\r\n\x1a\n":
            return None
        return struct.unpack(">II", head[16:24])
    except OSError:
        return None


def font_css():
    rules = []
    for weight, name in ((600, "Paperlogy-6SemiBold"), (700, "Paperlogy-7Bold"), (800, "Paperlogy-8ExtraBold")):
        with open(os.path.join(FONT_DIR, name + ".woff2"), "rb") as f:
            data = base64.b64encode(f.read()).decode("ascii")
        rules.append('@font-face { font-family: "Paperlogy"; src: url(data:font/woff2;base64,%s) format("woff2"); font-weight: %d; }'
                     % (data, weight))
    return "\n  ".join(rules)


def render_card(term, main, out_png):
    """og_card.html에 글자를 넣어 1200x600 PNG로 찍음. 성공하면 True.
    한 번 실패하면 이번 실행의 나머지 설문은 바로 공용 이미지를 씀(다음 실행에서 다시 시도)"""
    global _RENDER_BROKEN
    if _RENDER_BROKEN:
        return False
    browser = find_browser()
    if not browser:
        print("  (브라우저가 없어 미리보기 이미지를 못 만들었어요 → 공용 이미지 사용)")
        _RENDER_BROKEN = True
        return False
    page = read(CARD_TPL).replace("__FONTS__", font_css()) \
        .replace("__TERM__", html.escape(term)).replace("__MAIN__", html.escape(main))
    with tempfile.TemporaryDirectory(ignore_cleanup_errors=True) as tmp:
        src, shot = os.path.join(tmp, "card.html"), os.path.join(tmp, "card.png")
        write(src, page)
        cmd = [browser, "--headless=new", "--disable-gpu", "--no-sandbox", "--hide-scrollbars", "--no-first-run",
               "--force-device-scale-factor=1", "--window-size=%d,%d" % CARD_SIZE, "--virtual-time-budget=6000",
               "--user-data-dir=" + os.path.join(tmp, "profile"), "--screenshot=" + shot, Path(src).as_uri()]
        try:
            subprocess.run(cmd, timeout=60, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        except (OSError, subprocess.SubprocessError) as e:
            print("  (미리보기 이미지 찍기 실패: %s → 공용 이미지 사용)" % e)
            _RENDER_BROKEN = True
            return False
        size = png_size(shot)
        if size != CARD_SIZE:
            print("  (미리보기 이미지 크기가 %s라 쓰지 않아요 → 공용 이미지 사용)" % (size,))
            _RENDER_BROKEN = True
            return False
        # 다 찍은 뒤에만 폴더를 만들고, 임시 이름으로 복사한 다음 바꿔 반쯤 쓰인 그림이 남지 않게 함
        os.makedirs(os.path.dirname(out_png), exist_ok=True)
        shutil.copyfile(shot, out_png + ".tmp")
        os.replace(out_png + ".tmp", out_png)
    return True


def survey_image(s, folder):
    """설문 미리보기 이미지를 (없으면 만들어) (survey/ 기준 상대 경로, 파일 이름, 새로 찍었는지)로 돌려줌.
    찍지 못하면 공용 이미지"""
    term, main = split_title(s)
    key = hashlib.sha1(("%s|%s|%s" % (CARD_VERSION, term, main)).encode("utf-8")).hexdigest()[:10]
    name = "og-%s.png" % key
    path = os.path.join(folder, name)
    slug = os.path.basename(folder)
    if png_size(path) == CARD_SIZE:
        return slug + "/" + name, name, False
    print("미리보기 이미지 만드는 중:", slug, "·", term, "/", main)
    if not render_card(term, main, path):
        return GENERIC_IMAGE, None, False
    return slug + "/" + name, name, True


# ---------- 페이지 ----------
def og_block(title, page_url, image_url):
    e = lambda s: html.escape(s, quote=True)
    return "\n  ".join([
        "<!-- og:start  링크 미리보기. 기본 주소·설문별 공유 페이지 모두 tools/survey_share_pages.py가 설문 제목으로 채움 -->",
        '<meta name="description" content="%s">' % e(DESC),
        '<meta property="og:type" content="website">',
        '<meta property="og:site_name" content="대전광역시교육청 공동교육과정">',
        '<meta property="og:locale" content="ko_KR">',
        '<meta property="og:title" content="%s">' % e(title),
        '<meta property="og:description" content="%s">' % e(DESC),
        '<meta property="og:url" content="%s">' % e(page_url),
        '<meta property="og:image" content="%s">' % e(image_url),
        '<meta property="og:image:width" content="%d">' % CARD_SIZE[0],
        '<meta property="og:image:height" content="%d">' % CARD_SIZE[1],
        '<meta property="og:image:alt" content="%s">' % e(title),
        '<meta name="twitter:card" content="summary_large_image">',
        "<!-- og:end -->",
    ])


def build_page(tpl, s, base_url, image_rel):
    """survey/index.html(틀)에서 설문 하나의 공유 페이지를 만듦. 틀 모양이 바뀌어 못 바꾸면 멈춤"""
    slug, title = str(s["slug"]), clean_title(s)
    out, steps = tpl, []

    def sub(pattern, repl, flags=0):
        nonlocal out
        new, n = re.subn(pattern, lambda m: repl, out, count=1, flags=flags)
        steps.append(n)
        out = new

    # 이 페이지는 /survey/<코드>/에 있으므로, assets/… 같은 상대 주소를 /survey/ 기준으로 풀게 함
    sub(r'(<meta charset="utf-8">)', '<meta charset="utf-8">\n  <base href="/survey/">')
    sub(r"<title>.*?</title>", "<title>%s</title>" % html.escape(title), re.S)
    sub(OG_RE.pattern, og_block(title, base_url + slug + "/", base_url + image_rel), re.S)
    sub(HERO_RE.pattern, hero_block(s), re.S)
    sub(r'(<script src="assets/config\.js)', '<script>window.JCS_SLUG = %s;</script>\n  <script src="assets/config.js'
        % json.dumps(slug))
    sub(r"(<!doctype html>)", "<!doctype html>\n" + MARK, re.I)
    if not all(steps):
        sys.exit("survey/index.html의 모양이 예상과 달라 공유 페이지를 만들지 못했어요. (바꾼 곳 %s)" % steps)
    return out


def is_generated(folder):
    """이 스크립트가 만든 폴더인지: MARK가 있는 index.html, 또는 (중간에 멈춰) 비었거나 미리보기 이미지만 있는 폴더"""
    if os.path.basename(folder) in RESERVED:
        return False
    try:
        return MARK in read(os.path.join(folder, "index.html"))[:1000]
    except OSError:
        try:
            names = os.listdir(folder)
        except OSError:
            return False
        return all(OG_FILE_RE.match(n) or n.endswith(".png.tmp") for n in names)


def main():
    if sys.argv[1:] == ["--generic-image"]:
        out = os.path.join(SURVEY_DIR, "assets", "img", "og-survey.png")
        ok = render_card("대전광역시교육청", DEFAULT_TITLE, out)
        sys.exit(0 if ok else "공용 이미지를 만들지 못했어요.")

    api_base, key, base_url = config()
    tpl_path = os.path.join(SURVEY_DIR, "index.html")
    tpl = read(tpl_path)
    if not OG_RE.search(tpl) or not HERO_RE.search(tpl):
        sys.exit("survey/index.html에 <!-- og:start/og:end --> 또는 <!-- hero:start/hero:end --> 표시가 없어요.")
    if "JCS_SLUG" not in read(os.path.join(SURVEY_DIR, "assets", "survey.js")):
        sys.exit("survey.js가 window.JCS_SLUG를 읽지 않아요. 공유 페이지가 설문을 못 찾으니 멈춥니다.")
    if len(sys.argv) == 3 and sys.argv[1] == "--json":
        with open(sys.argv[2], encoding="utf-8-sig") as f:
            surveys = json.load(f)
        if not isinstance(surveys, list):
            sys.exit("--json 파일은 설문 목록(배열)이어야 해요.")
    else:
        surveys = fetch_surveys(api_base, key)

    changed = 0
    pages, images = {}, {}
    for s in surveys:
        slug = str(s.get("slug") or "")
        folder = os.path.join(SURVEY_DIR, slug)
        if not SLUG_RE.match(slug):
            print("건너뜀(주소용 코드 형식이 아님):", slug)
            continue
        if slug in RESERVED or (os.path.exists(folder) and not is_generated(folder)):
            print("건너뜀(같은 이름의 폴더가 이미 있음, 예: assets):", slug)
            continue
        image_rel, image_name, rendered = survey_image(s, folder)
        changed += rendered
        images[slug] = image_rel
        pages[slug] = build_page(tpl, s, base_url, image_rel)
        # 글자가 바뀌어 새로 찍은 경우 예전 이미지 지우기
        if os.path.isdir(folder):
            for f in os.listdir(folder):
                if OG_FILE_RE.match(f) and f != image_name:
                    os.remove(os.path.join(folder, f))
                    changed += 1

    for slug, page in pages.items():
        path = os.path.join(SURVEY_DIR, slug, "index.html")
        if os.path.exists(path) and read(path) == page:
            continue
        os.makedirs(os.path.dirname(path), exist_ok=True)
        write(path, page)
        changed += 1
        print("만듦·고침:", slug)

    # 기본 주소(survey/index.html)의 제목·미리보기·머리: 학생 화면이 기본으로 여는 설문(api.js getSurvey와 같은 기준)
    cur = current_survey(surveys)
    cur_title = clean_title(cur) if cur else DEFAULT_TITLE
    image_url = base_url + (images.get(str(cur.get("slug") or ""), GENERIC_IMAGE) if cur else GENERIC_IMAGE)
    new_tpl = OG_RE.sub(lambda m: og_block(cur_title, base_url, image_url), tpl, count=1)
    new_tpl = HERO_RE.sub(lambda m: hero_block(cur), new_tpl, count=1)
    new_tpl = re.sub(r"<title>.*?</title>", lambda m: "<title>%s</title>" % html.escape(cur_title), new_tpl, count=1, flags=re.S)
    if new_tpl != tpl:
        write(tpl_path, new_tpl)
        changed += 1
        print("기본 주소 제목·미리보기:", cur_title)

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

    # 배포 확인용 지문: 만든 결과가 실제 사이트에 올라갔는지 GitHub Actions가 이 파일을 사이트의 것과 비교함
    h = hashlib.sha1(read(tpl_path).encode("utf-8"))
    for name in sorted(os.listdir(SURVEY_DIR)):
        folder = os.path.join(SURVEY_DIR, name)
        if os.path.isdir(folder) and is_generated(folder):
            h.update(name.encode("utf-8"))
            h.update(read(os.path.join(folder, "index.html")).encode("utf-8"))
    stamp = h.hexdigest() + "\n"
    stamp_path = os.path.join(SURVEY_DIR, "assets", "share-stamp.txt")
    if not os.path.exists(stamp_path) or read(stamp_path) != stamp:
        write(stamp_path, stamp)
        changed += 1

    print("설문 %d개 · 바뀐 파일 %d개" % (len(pages), changed))


if __name__ == "__main__":
    main()
